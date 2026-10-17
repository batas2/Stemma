using System.Text;
using System.Text.Json;
using FluentAssertions;
using Stemma.Engine.Operations;
using Stemma.Engine.Workspace;
using Xunit;

namespace Stemma.Engine.Tests;

/// <summary>
/// comments.stemma.json on disk, written through the engine (B-018): a change lands on the file as
/// it is now; a file that cannot be read is left alone rather than replaced by the one comment being
/// added; and a comment someone else writes is announced, while the echo of the engine's own write
/// is not.
/// </summary>
public sealed class CommentsWriteTests
{
    private const string Source = """
        using Stemma.Model;

        namespace Scratch;

        public static class Architecture
        {
            public static Model Build()
            {
                var ctx = new BoundedContext("ctx_001", "Ordering");
                return Model.Of(ctx);
            }
        }
        """;

    private const string Comments = """
        {
          "version": 1,
          "comments": [
            {
              "id": "cmt_1",
              "targetKind": "element",
              "targetId": "ctx_001",
              "author": "ada",
              "createdAt": "2026-10-01T09:00:00Z",
              "body": "Does ordering own the basket?",
              "resolved": false,
              "thread": []
            }
          ]
        }

        """;

    private static readonly byte[] Bom = [0xEF, 0xBB, 0xBF];

    private static async Task<string> CreateAsync(byte[]? comments)
    {
        var root = Path.Combine(Path.GetTempPath(), $"stemma-comments-{Guid.NewGuid():N}");
        Directory.CreateDirectory(Path.Combine(root, "Architecture"));
        await File.WriteAllTextAsync(Path.Combine(root, "Architecture", "Architecture.cs"), Source);
        if (comments is not null) await File.WriteAllBytesAsync(CommentsSidecar.PathFor(root), comments);
        return root;
    }

    private static readonly CommentChange Second = new CommentChange.Add(JsonDocument.Parse("""
        {"id":"cmt_2","targetKind":"element","targetId":"ctx_001","author":"sam","createdAt":"2026-10-17T12:00:00Z","body":"It should.","resolved":false,"thread":[]}
        """).RootElement.Clone());

    private static async Task<bool> EventuallyAsync(Func<bool> condition)
    {
        var deadline = DateTime.UtcNow + TimeSpan.FromSeconds(10);
        while (DateTime.UtcNow < deadline)
        {
            if (condition()) return true;
            await Task.Delay(100);
        }
        return false;
    }

    [Fact]
    public async Task A_change_lands_on_the_file_and_keeps_its_byte_order_mark()
    {
        var root = await CreateAsync([.. Bom, .. Encoding.UTF8.GetBytes(Comments)]);
        try
        {
            await using var engine = await StemmaEngine.OpenAsync(root);
            var result = await engine.PatchCommentsAsync("op", [new CommentChange.SetResolved("cmt_1", true)]);

            result.Should().BeOfType<OperationApplied>();
            (await File.ReadAllBytesAsync(CommentsSidecar.PathFor(root))).Should()
                .Equal([.. Bom, .. Encoding.UTF8.GetBytes(Comments.Replace("\"resolved\": false", "\"resolved\": true"))]);
        }
        finally { Directory.Delete(root, recursive: true); }
    }

    [Fact]
    public async Task A_workspace_without_comments_gets_a_file_holding_the_first()
    {
        var root = await CreateAsync(null);
        try
        {
            await using var engine = await StemmaEngine.OpenAsync(root);
            (await engine.PatchCommentsAsync("op", [Second])).Should().BeOfType<OperationApplied>();

            (await File.ReadAllTextAsync(CommentsSidecar.PathFor(root))).Should().Be("""
                {
                  "version": 1,
                  "comments": [
                    {
                      "id": "cmt_2",
                      "targetKind": "element",
                      "targetId": "ctx_001",
                      "author": "sam",
                      "createdAt": "2026-10-17T12:00:00Z",
                      "body": "It should.",
                      "resolved": false,
                      "thread": []
                    }
                  ]
                }

                """);
        }
        finally { Directory.Delete(root, recursive: true); }
    }

    [Fact]
    public async Task A_change_that_changes_nothing_writes_nothing()
    {
        var root = await CreateAsync(null);
        try
        {
            await using var engine = await StemmaEngine.OpenAsync(root);
            (await engine.PatchCommentsAsync("op", [new CommentChange.Remove("cmt_gone")])).Should().BeOfType<OperationApplied>();

            File.Exists(CommentsSidecar.PathFor(root)).Should().BeFalse("removing nothing is no reason to create a file");
        }
        finally { Directory.Delete(root, recursive: true); }
    }

    [Fact]
    public async Task Comments_that_cannot_be_read_are_refused_and_left_as_they_are()
    {
        // A merge left its markers in. Until now this read as no comments at all, and the next one
        // added was written over both sides of the conflict.
        var conflicted = Comments.Replace("  \"version\": 1,\n", "<<<<<<< HEAD\n  \"version\": 1,\n=======\n  \"version\": 2,\n>>>>>>> theirs\n");
        var root = await CreateAsync(Encoding.UTF8.GetBytes(conflicted));
        try
        {
            await using var engine = await StemmaEngine.OpenAsync(root);
            var result = await engine.PatchCommentsAsync("op", [Second]);

            result.Should().BeOfType<OperationFailed>().Which.Reason.Should().Be("UnreadableSidecar");
            (await File.ReadAllTextAsync(CommentsSidecar.PathFor(root))).Should().Be(conflicted);
        }
        finally { Directory.Delete(root, recursive: true); }
    }

    [Fact]
    public async Task An_outside_change_is_announced_and_the_engines_own_write_is_not()
    {
        var root = await CreateAsync(Encoding.UTF8.GetBytes(Comments));
        try
        {
            await using var engine = await StemmaEngine.OpenAsync(root);
            engine.StartWatching();
            var announced = 0;
            var layoutAnnounced = 0;
            engine.CommentsChanged += () => Interlocked.Increment(ref announced);
            engine.SidecarChanged += () => Interlocked.Increment(ref layoutAnnounced);
            await Task.Delay(TimeSpan.FromSeconds(1));

            await engine.PatchCommentsAsync("op", [Second]);
            await Task.Delay(TimeSpan.FromSeconds(3)); // several watcher polls
            announced.Should().Be(0, "the engine's own write is not news");

            var outside = (await File.ReadAllTextAsync(CommentsSidecar.PathFor(root))).Replace("Does ordering own", "Should ordering own");
            await File.WriteAllTextAsync(CommentsSidecar.PathFor(root), outside);
            (await EventuallyAsync(() => announced > 0)).Should().BeTrue("a pull or a teammate's comment is");
            await Task.Delay(TimeSpan.FromSeconds(3));
            announced.Should().Be(1, "once per change");
            layoutAnnounced.Should().Be(0, "and it is the comments that changed, not the layout");
        }
        finally { Directory.Delete(root, recursive: true); }
    }
}
