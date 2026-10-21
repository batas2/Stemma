using System.Text.Json;
using FluentAssertions;
using Stemma.Engine.Workspace;
using Xunit;

namespace Stemma.Web.Tests;

/// <summary>
/// The recent list is the person's own record of what they work on. It lost entries for good: a
/// folder that was missing when the list was read — a drive not plugged in, a checkout moved for a
/// minute — was dropped from what was read, and the next open saved that. On Linux it also took two
/// folders whose names differ only in case for one, and it was written in place, so a reader could
/// catch it half written.
/// </summary>
public sealed class RecentWorkspacesTests : IDisposable
{
    private readonly string _dir = Directory.CreateDirectory(
        Path.Combine(Path.GetTempPath(), $"stemma-recents-{Guid.NewGuid():N}")).FullName;

    public void Dispose() => Directory.Delete(_dir, recursive: true);

    private string File_ => Path.Combine(_dir, "state", "recent.json");

    private string Folder(string name) => Directory.CreateDirectory(Path.Combine(_dir, name)).FullName;

    [Fact]
    public async Task A_folder_that_is_missing_for_now_stays_on_the_list()
    {
        var recents = new RecentWorkspaces(File_);
        var unplugged = Folder("on-a-usb-drive");
        await recents.TouchAsync(unplugged);
        Directory.Delete(unplugged);

        await recents.TouchAsync(Folder("another"));

        recents.Load().Select(e => e.RootPath).Should().Contain(unplugged);
    }

    [Fact]
    public async Task Folders_are_told_apart_as_the_file_system_tells_them_apart()
    {
        var recents = new RecentWorkspaces(File_);
        var upper = Path.Combine(_dir, "Model");
        var lower = Path.Combine(_dir, "model");

        await recents.TouchAsync(upper);
        await recents.TouchAsync(lower);

        var caseSensitive = !OperatingSystem.IsWindows() && !OperatingSystem.IsMacOS();
        recents.Load().Should().HaveCount(caseSensitive ? 2 : 1);
    }

    [Fact]
    public async Task A_reader_never_sees_the_list_half_written()
    {
        var recents = new RecentWorkspaces(File_);
        var folders = Enumerable.Range(0, 12).Select(i => Folder($"m{i}")).ToList();
        await recents.TouchAsync(folders[0]);
        var torn = 0;
        using var stop = new CancellationTokenSource();
        var reader = Task.Run(async () =>
        {
            while (!stop.IsCancellationRequested)
            {
                try { JsonDocument.Parse(await File.ReadAllTextAsync(File_)).Dispose(); }
                catch (JsonException) { torn++; }
                catch (IOException) { /* replaced between open and read: not a torn read */ }
            }
        });

        for (var i = 0; i < 300; i++) await recents.TouchAsync(folders[i % folders.Count]);
        await stop.CancelAsync();
        await reader;

        torn.Should().Be(0);
        Directory.GetFiles(Path.GetDirectoryName(File_)!, "*.tmp").Should().BeEmpty();
    }

    [Fact]
    public async Task The_start_screen_is_told_which_folders_are_missing_and_can_take_one_off()
    {
        var kept = Folder("kept");
        var gone = Folder("gone");
        var recents = new RecentWorkspaces(File_);
        await recents.TouchAsync(gone);
        await recents.TouchAsync(kept);
        Directory.Delete(gone);
        var app = StemmaWebHost.Build(["--urls", StemmaWebHost.DynamicLoopbackUrl, "--log-level", "none", "--recents", File_]);
        await app.StartAsync();
        try
        {
            using var http = new HttpClient { BaseAddress = new Uri(StemmaWebHost.BoundUrl(app)) };

            using (var listed = JsonDocument.Parse(await http.GetStringAsync("/api/workspace/recents")))
            {
                listed.RootElement.EnumerateArray()
                    .Select(e => (e.GetProperty("rootPath").GetString(), e.GetProperty("missing").GetBoolean()))
                    .Should().Equal((kept, false), (gone, true));
            }

            (await http.DeleteAsync($"/api/workspace/recents?rootPath={Uri.EscapeDataString(gone)}")).EnsureSuccessStatusCode();
            recents.Load().Select(e => e.RootPath).Should().Equal(kept);
        }
        finally
        {
            await app.StopAsync();
            await app.DisposeAsync();
        }
    }
}
