using System.Diagnostics;
using FluentAssertions;
using Stemma.Web.Services;
using Xunit;

namespace Stemma.Web.Tests;

/// <summary>
/// F-017, ADR-0024. What the model was is read from Git and kept nowhere: a past revision is parsed by
/// the engine's reader, its sidecar comes back as it was written, and nothing a request carries can
/// become a git option.
/// </summary>
public sealed class GitHistoryTests : IDisposable
{
    private readonly string _root = Directory.CreateDirectory(
        Path.Combine(Path.GetTempPath(), $"stemma-history-{Guid.NewGuid():N}")).FullName;

    public void Dispose()
    {
        try { Directory.Delete(_root, recursive: true); } catch (IOException) { } catch (UnauthorizedAccessException) { }
    }

    private const string Model = """
        using Stemma.Model;

        namespace Sample;

        public static class Architecture
        {
            public static Model Build()
            {
                var ctx = new BoundedContext("ctx_pay", "Payments");
                var auth = new Module("mod_auth", "Authorise", "ctx_pay");
                var settle = new Module("mod_settle", "Settle", "ctx_pay");
                var flow = new DataFlow("df_1", "mod_auth", "mod_settle", "Authorised");
                return Model.Of(ctx, auth, settle, flow);
            }
        }
        """;

    private static bool GitAvailable()
    {
        try
        {
            using var p = Process.Start(new ProcessStartInfo("git", "--version") { RedirectStandardOutput = true, UseShellExecute = false });
            p!.WaitForExit();
            return p.ExitCode == 0;
        }
        catch { return false; }
    }

    private void Git(params string[] args)
    {
        var psi = new ProcessStartInfo("git") { WorkingDirectory = _root, RedirectStandardOutput = true, RedirectStandardError = true, UseShellExecute = false };
        foreach (var a in args) psi.ArgumentList.Add(a);
        // Whatever the machine has configured must not decide whether a commit can be made.
        psi.Environment["GIT_CONFIG_GLOBAL"] = Path.Combine(_root, ".no-global-config");
        psi.Environment["GIT_CONFIG_NOSYSTEM"] = "1";
        psi.Environment["GIT_AUTHOR_NAME"] = "Ada";
        psi.Environment["GIT_AUTHOR_EMAIL"] = "ada@example.com";
        psi.Environment["GIT_COMMITTER_NAME"] = "Ada";
        psi.Environment["GIT_COMMITTER_EMAIL"] = "ada@example.com";
        using var p = Process.Start(psi)!;
        p.WaitForExit();
        p.ExitCode.Should().Be(0, $"git {string.Join(' ', args)}: {p.StandardError.ReadToEnd()}");
    }

    private async Task CommitModel(string text, string message, string? layout = null)
    {
        Directory.CreateDirectory(Path.Combine(_root, "Architecture"));
        await File.WriteAllTextAsync(Path.Combine(_root, "Architecture", "Architecture.cs"), text);
        if (layout is not null) await File.WriteAllTextAsync(Path.Combine(_root, "stemma.layout.json"), layout);
        Git("add", "-A");
        Git("commit", "-q", "-m", message);
    }

    [Fact]
    public async Task The_model_at_the_last_commit_is_the_one_committed_not_the_one_on_disk()
    {
        if (!GitAvailable()) return;
        Git("init", "-q", "-b", "main");
        await CommitModel(Model, "First model", """{ "views": { "moduleMap": { "nodes": { "mod_settle": { "x": 40, "y": 80 } } } } }""");

        // An evening's edits, not committed: one renamed, one removed.
        var edited = Model.Replace("\"Authorise\"", "\"Authorise card\"")
            .Replace("var settle = new Module(\"mod_settle\", \"Settle\", \"ctx_pay\");\n", "")
            .Replace("var flow = new DataFlow(\"df_1\", \"mod_auth\", \"mod_settle\", \"Authorised\");\n", "")
            .Replace("auth, settle, flow", "auth");
        await File.WriteAllTextAsync(Path.Combine(_root, "Architecture", "Architecture.cs"), edited);

        var then = await GitHistory.ModelAtAsync(_root, "HEAD");

        then.Arch.Should().NotBeNull();
        then.Arch!.Elements.Select(e => (e.Id, e.Name)).Should().BeEquivalentTo(new[]
        {
            ("ctx_pay", "Payments"), ("mod_auth", "Authorise"), ("mod_settle", "Settle"),
        });
        then.Arch.Links.Should().ContainSingle(l => l.Id == "df_1");
        then.Sha.Should().HaveLength(40);
        // Where the removed element used to sit, for drawing its ghost.
        then.Layout!.Value.GetProperty("views").GetProperty("moduleMap").GetProperty("nodes")
            .GetProperty("mod_settle").GetProperty("x").GetInt32().Should().Be(40);
    }

    [Fact]
    public async Task The_history_names_the_branch_the_commits_and_where_the_branch_started()
    {
        if (!GitAvailable()) return;
        Git("init", "-q", "-b", "main");
        await CommitModel(Model, "First model");
        Git("tag", "v1");
        Git("checkout", "-q", "-b", "proposal");
        await CommitModel(Model.Replace("\"Settle\"", "\"Settle daily\""), "Settle daily");

        var history = await GitHistory.ReadAsync(_root);

        history.Repository.Should().BeTrue();
        history.Branch.Should().Be("proposal");
        history.DefaultBranch.Should().Be("main");
        history.MergeBase.Should().NotBeNull();
        history.Commits.Select(c => c.Subject).Should().Equal("Settle daily", "First model");
        history.Commits[0].Author.Should().Be("Ada");
        history.Tags.Should().ContainSingle(t => t.Name == "v1");

        var atBase = await GitHistory.ModelAtAsync(_root, history.MergeBase!);
        atBase.Arch!.Elements.Should().Contain(e => e.Name == "Settle");
    }

    [Fact]
    public async Task A_revision_from_before_the_model_existed_has_no_model()
    {
        if (!GitAvailable()) return;
        Git("init", "-q", "-b", "main");
        await File.WriteAllTextAsync(Path.Combine(_root, "README.md"), "Before the model.");
        Git("add", "-A");
        Git("commit", "-q", "-m", "Readme");
        await CommitModel(Model, "First model");

        var then = await GitHistory.ModelAtAsync(_root, "HEAD~1");
        then.Arch.Should().BeNull();
        then.Layout.Should().BeNull();
    }

    [Theory]
    [InlineData("--output=/tmp/x")]
    [InlineData("-p")]
    [InlineData("HEAD;rm -rf /")]
    [InlineData("a..b")]
    [InlineData("")]
    public async Task Anything_that_is_not_shaped_like_a_revision_is_refused_before_git_sees_it(string rev)
    {
        GitHistory.IsRevision(rev).Should().BeFalse();
        var read = () => GitHistory.ModelAtAsync(_root, rev);
        await read.Should().ThrowAsync<GitHistory.RevisionNotFound>();
    }

    [Fact]
    public async Task A_revision_the_repository_does_not_have_is_said_so()
    {
        if (!GitAvailable()) return;
        Git("init", "-q", "-b", "main");
        await CommitModel(Model, "First model");
        var read = () => GitHistory.ModelAtAsync(_root, "no-such-branch");
        (await read.Should().ThrowAsync<GitHistory.RevisionNotFound>()).Which.Message.Should().Contain("no-such-branch");
    }

    [Fact]
    public async Task A_folder_outside_any_repository_says_why_it_cannot_compare()
    {
        if (!GitAvailable()) return;
        // The temp folder may itself sit inside a repository on some machines; a ceiling stops the search.
        Environment.SetEnvironmentVariable("GIT_CEILING_DIRECTORIES", Path.GetDirectoryName(_root));
        try
        {
            var history = await GitHistory.ReadAsync(_root);
            history.Repository.Should().BeFalse();
            history.Reason.Should().Contain("not in a Git repository");
        }
        finally
        {
            Environment.SetEnvironmentVariable("GIT_CEILING_DIRECTORIES", null);
        }
    }
}
