using FluentAssertions;
using Verso.Engine.Workspace;
using Xunit;

namespace Verso.Engine.Tests;

public class CommentsSidecarTests
{
    [Fact]
    public void Read_returns_empty_when_file_missing()
    {
        var dir = Path.Combine(Path.GetTempPath(), $"verso-comments-{Guid.NewGuid():N}");
        Directory.CreateDirectory(dir);
        try
        {
            var s = CommentsSidecar.Read(dir);
            s.Comments.Should().BeEmpty();
            s.Version.Should().Be(1);
        }
        finally { Directory.Delete(dir, recursive: true); }
    }

    [Fact]
    public void Round_trip_preserves_thread_and_resolved_flag()
    {
        var dir = Path.Combine(Path.GetTempPath(), $"verso-comments-{Guid.NewGuid():N}");
        Directory.CreateDirectory(dir);
        try
        {
            var sidecar = new CommentsSidecar(1, new[]
            {
                new CommentEntry(
                    Id: "cmt_1",
                    TargetKind: "element",
                    TargetId: "ctx_001",
                    Author: "b",
                    CreatedAt: new DateTime(2026, 5, 12, 10, 0, 0, DateTimeKind.Utc),
                    Body: "should this BC own SubmitBatch?",
                    Resolved: false,
                    Thread: new[]
                    {
                        new CommentReply(
                            Author: "alice",
                            CreatedAt: new DateTime(2026, 5, 12, 11, 0, 0, DateTimeKind.Utc),
                            Body: "yes."),
                    }),
            });
            sidecar.Write(dir);
            var reload = CommentsSidecar.Read(dir);
            reload.Comments.Should().HaveCount(1);
            reload.Comments[0].Body.Should().Contain("SubmitBatch");
            reload.Comments[0].Resolved.Should().BeFalse();
            reload.Comments[0].Thread.Should().HaveCount(1);
            reload.Comments[0].Thread[0].Author.Should().Be("alice");
        }
        finally { Directory.Delete(dir, recursive: true); }
    }

    [Fact]
    public void Read_returns_empty_when_file_is_garbage()
    {
        var dir = Path.Combine(Path.GetTempPath(), $"verso-comments-{Guid.NewGuid():N}");
        Directory.CreateDirectory(dir);
        try
        {
            File.WriteAllText(Path.Combine(dir, CommentsSidecar.FileName), "{ not valid }");
            var s = CommentsSidecar.Read(dir);
            s.Comments.Should().BeEmpty();
        }
        finally { Directory.Delete(dir, recursive: true); }
    }
}
