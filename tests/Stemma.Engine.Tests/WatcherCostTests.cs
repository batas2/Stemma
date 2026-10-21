using FluentAssertions;
using Stemma.Engine.Workspace;
using Xunit;

namespace Stemma.Engine.Tests;

/// <summary>
/// The watcher's fallback poll runs every second for as long as a workspace is open, so what it costs
/// is paid all day. It walked every folder under the root — node_modules, bin, obj, .git — asked about
/// every file found there, and, once a poll took longer than a second, the next one started on top of
/// it. At 3,000 files it kept almost half a core busy with nothing happening.
/// </summary>
public sealed class WatcherCostTests
{
    private static string CreateTree()
    {
        var root = Path.Combine(Path.GetTempPath(), $"stemma-watch-{Guid.NewGuid():N}");
        foreach (var dir in new[] { "Architecture", "node_modules/pkg/src", "bin/Debug", "obj", ".git/objects", "Views" })
        {
            Directory.CreateDirectory(Path.Combine(root, dir));
            File.WriteAllText(Path.Combine(root, dir, "File.cs"), "class C { }\n");
        }
        return root;
    }

    [Fact]
    public async Task The_poll_never_goes_into_a_folder_that_is_never_part_of_the_model()
    {
        var root = CreateTree();
        var asked = new System.Collections.Concurrent.ConcurrentBag<string>();
        try
        {
            await using (new ExternalWatcher(root, path => { asked.Add(path); return true; }))
                await Task.Delay(TimeSpan.FromSeconds(1.5)); // the seeding walk and at least one poll

            var relative = asked.Select(p => Path.GetRelativePath(root, p).Replace('\\', '/')).Distinct().ToList();
            relative.Should().Contain(["Architecture/File.cs", "Views/File.cs"]);
            relative.Should().NotContain(p => p.StartsWith("node_modules/") || p.StartsWith("bin/") || p.StartsWith("obj/") || p.StartsWith(".git/"));
        }
        finally { Directory.Delete(root, recursive: true); }
    }

    [Fact]
    public async Task A_slow_poll_is_never_joined_by_the_next_one()
    {
        var root = CreateTree();
        var inside = 0;
        var most = 0;
        var slow = false;
        try
        {
            await using (new ExternalWatcher(root, _ =>
            {
                var now = Interlocked.Increment(ref inside);
                InterlockedMax(ref most, now);
                if (Volatile.Read(ref slow)) Thread.Sleep(TimeSpan.FromSeconds(1.5));
                Interlocked.Decrement(ref inside);
                return true;
            }))
            {
                Volatile.Write(ref slow, true);
                await Task.Delay(TimeSpan.FromSeconds(4.5));
                Volatile.Write(ref slow, false);
            }

            most.Should().Be(1, "a poll that takes longer than a second is still the only one running");
        }
        finally { Directory.Delete(root, recursive: true); }
    }

    private static void InterlockedMax(ref int target, int value)
    {
        int seen;
        do { seen = Volatile.Read(ref target); }
        while (value > seen && Interlocked.CompareExchange(ref target, value, seen) != seen);
    }
}
