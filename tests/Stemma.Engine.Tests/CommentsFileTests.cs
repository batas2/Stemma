using System.Text;
using FluentAssertions;
using Stemma.Engine.Operations;
using Stemma.Engine.Workspace;
using Xunit;

namespace Stemma.Engine.Tests;

/// <summary>
/// The comments file as the command line reads and changes it (F-027): through the app's writer, onto
/// the file as it is, and never over a file it cannot read (B-018).
/// </summary>
public sealed class CommentsFileTests : IDisposable
{
    private readonly string _root = Path.Combine(Path.GetTempPath(), $"stemma-comments-{Guid.NewGuid():N}");
    private string FilePath => CommentsSidecar.PathFor(_root);

    // Written by hand: CRLF, a key Stemma does not know, a comment with no thread and one without an id.
    private const string Hand =
        "{\r\n  \"version\": 1,\r\n  \"reviewRound\": 2,\r\n  \"comments\": [\r\n" +
        "    { \"id\": \"c1\", \"targetKind\": \"element\", \"targetId\": \"mod_pay\", \"author\": \"aria\", \"createdAt\": \"2026-11-01T10:00:00Z\", \"body\": \"Should this be async?\", \"resolved\": false },\r\n" +
        "    { \"targetId\": \"mod_x\", \"body\": \"no id\" },\r\n" +
        "    { \"id\": \"c2\", \"targetKind\": \"view\", \"targetId\": \"view_buy\", \"author\": \"aria\", \"createdAt\": \"2026-11-01T10:05:00Z\", \"body\": \"Too busy\", \"resolved\": true, \"thread\": [ { \"author\": \"theo\", \"createdAt\": \"2026-11-01T11:00:00Z\", \"body\": \"Split it\" } ] }\r\n" +
        "  ]\r\n}\r\n";

    public CommentsFileTests() => Directory.CreateDirectory(_root);
    public void Dispose() => Directory.Delete(_root, recursive: true);

    [Fact]
    public void Reads_the_comments_the_app_reads_and_skips_what_is_not_one()
    {
        CommentsFile.Read(_root).Should().BeEmpty("there is no file yet");
        File.WriteAllText(FilePath, Hand);

        var comments = CommentsFile.Read(_root);

        comments.Select(c => c.Id).Should().Equal("c1", "c2");
        comments[0].Should().BeEquivalentTo(new { TargetKind = "element", TargetId = "mod_pay", Author = "aria", Resolved = false, Thread = Array.Empty<CommentsFile.Reply>() });
        comments[1].Thread.Should().ContainSingle().Which.Should().Be(new CommentsFile.Reply("theo", "2026-11-01T11:00:00Z", "Split it"));
    }

    [Fact]
    public async Task A_reply_is_that_reply_and_every_other_byte_stays()
    {
        File.WriteAllText(FilePath, Hand);
        var reply = CommentsFile.ToJson(new CommentsFile.Reply("Claude", "2026-11-07T12:00:00Z", "Made it a queue."));

        (await CommentsFile.PatchAsync(_root, [new CommentChange.AddReply("c1", reply), new CommentChange.SetResolved("c1", true)]))
            .Should().BeOfType<OperationApplied>();

        var after = File.ReadAllText(FilePath);
        after.Should().Be(CommentsPatch.Apply(Hand, [new CommentChange.AddReply("c1", reply), new CommentChange.SetResolved("c1", true)]));
        after.Should().Contain("\"reviewRound\": 2").And.Contain("\r\n").And.Contain("\"body\": \"no id\"");
        CommentsFile.Read(_root).Single(c => c.Id == "c1").Should().BeEquivalentTo(new { Resolved = true, Thread = new[] { new { Author = "Claude", Body = "Made it a queue." } } });
    }

    [Fact]
    public async Task A_first_comment_creates_the_file_as_the_app_creates_it()
    {
        var comment = new CommentsFile.Comment(CommentsFile.NewId(), "element", "mod_pay", "Claude", "2026-11-07T12:00:00Z", "Who owns this?", false, []);
        (await CommentsFile.PatchAsync(_root, [new CommentChange.Add(CommentsFile.ToJson(comment))])).Should().BeOfType<OperationApplied>();

        CommentsFile.Read(_root).Should().ContainSingle().Which.Body.Should().Be("Who owns this?");
        comment.Id.Should().MatchRegex("^cmt_[0-9a-z]+_[0-9a-f]{4}$");
    }

    [Fact]
    public async Task A_file_that_does_not_parse_is_refused_and_left_as_it_is()
    {
        var merged = Hand.Replace("  \"comments\": [", "<<<<<<< HEAD\r\n  \"comments\": [");
        File.WriteAllText(FilePath, merged);

        var act = () => CommentsFile.Read(_root);
        act.Should().Throw<SidecarPatchRefusedException>().Which.Reason.Should().Be("UnreadableSidecar");
        (await CommentsFile.PatchAsync(_root, [new CommentChange.SetResolved("c1", true)])).Should().BeOfType<OperationFailed>()
            .Which.Reason.Should().Be("UnreadableSidecar");
        File.ReadAllBytes(FilePath).Should().Equal(Encoding.UTF8.GetBytes(merged));
    }

    [Fact]
    public async Task A_reply_to_a_comment_that_is_not_there_is_refused()
    {
        File.WriteAllText(FilePath, Hand);
        var reply = CommentsFile.ToJson(new CommentsFile.Reply("Claude", "2026-11-07T12:00:00Z", "?"));
        (await CommentsFile.PatchAsync(_root, [new CommentChange.AddReply("c9", reply)])).Should().BeOfType<OperationFailed>()
            .Which.Reason.Should().Be("NoSuchComment");
        File.ReadAllText(FilePath).Should().Be(Hand);
    }
}
