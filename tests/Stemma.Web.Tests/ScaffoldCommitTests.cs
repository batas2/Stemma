using System.Diagnostics;
using FluentAssertions;
using Stemma.Web.Services;
using Xunit;

namespace Stemma.Web.Tests;

/// <summary>
/// B-017. A new model is a repository with one commit, so the first diff its author reads is their
/// own first edit (F-003 AC4). Git will not commit for someone it cannot name, and on a fresh machine
/// — and on CI — nobody has told it a name yet. Each test gives git a home of its own, so what the
/// machine running the tests has configured cannot decide the outcome.
/// </summary>
public sealed class ScaffoldCommitTests : IDisposable
{
    private readonly string _dir = Directory.CreateDirectory(
        Path.Combine(Path.GetTempPath(), $"stemma-commit-{Guid.NewGuid():N}")).FullName;

    private string Root => Path.Combine(_dir, "model");

    public void Dispose() => Directory.Delete(_dir, recursive: true);

    /// <summary>A git that reads only the given global config and may not guess an identity.</summary>
    private Dictionary<string, string?> Git(string globalConfig)
    {
        var config = Path.Combine(_dir, "gitconfig");
        File.WriteAllText(config, globalConfig);
        return new Dictionary<string, string?>
        {
            ["GIT_CONFIG_GLOBAL"] = config,
            ["GIT_CONFIG_NOSYSTEM"] = "1",
            ["GIT_CONFIG_COUNT"] = "1",
            ["GIT_CONFIG_KEY_0"] = "user.useConfigOnly",
            ["GIT_CONFIG_VALUE_0"] = "true",
            ["GIT_AUTHOR_NAME"] = null,
            ["GIT_AUTHOR_EMAIL"] = null,
            ["GIT_COMMITTER_NAME"] = null,
            ["GIT_COMMITTER_EMAIL"] = null,
            ["EMAIL"] = null,
        };
    }

    private string RunGit(IReadOnlyDictionary<string, string?> environment, params string[] args)
    {
        var psi = new ProcessStartInfo("git")
        {
            WorkingDirectory = Root,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            UseShellExecute = false,
        };
        foreach (var a in args) psi.ArgumentList.Add(a);
        foreach (var (key, value) in environment)
        {
            if (value is null) psi.Environment.Remove(key);
            else psi.Environment[key] = value;
        }
        using var p = Process.Start(psi)!;
        var output = p.StandardOutput.ReadToEnd();
        p.WaitForExit();
        return output.Trim();
    }

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

    [Fact]
    public async Task Where_git_knows_nobody_the_new_model_is_still_one_clean_commit_made_by_Stemma()
    {
        if (!GitAvailable()) return;
        var git = Git("");

        var created = await WorkspaceScaffold.CreateAsync("Payments", Root, git);

        created.GitInitialised.Should().BeTrue();
        created.GitError.Should().BeNull();
        RunGit(git, "status", "--porcelain").Should().BeEmpty("the user's first diff has to be their own first edit");
        RunGit(git, "log", "--format=%an <%ae>|%cn <%ce>|%s").Should().Be(
            "Stemma <stemma@localhost>|Stemma <stemma@localhost>|Start architecture model");
    }

    [Fact]
    public async Task Where_git_knows_the_user_the_commit_is_theirs()
    {
        if (!GitAvailable()) return;
        var git = Git("[user]\n\tname = Ada Lovelace\n\temail = ada@example.com\n");

        var created = await WorkspaceScaffold.CreateAsync("Payments", Root, git);

        created.GitError.Should().BeNull();
        RunGit(git, "status", "--porcelain").Should().BeEmpty();
        RunGit(git, "log", "--format=%an <%ae>").Should().Be("Ada Lovelace <ada@example.com>");
    }

    [Fact]
    public async Task Stemma_is_only_the_committer_for_the_one_commit_it_makes()
    {
        if (!GitAvailable()) return;
        var git = Git("");

        await WorkspaceScaffold.CreateAsync("Payments", Root, git);

        // The fallback is passed to that one command, never written into the repository's config,
        // so the user's own first commit is refused until they say who they are, as git intends.
        RunGit(git, "config", "--local", "--get", "user.name").Should().BeEmpty();
        RunGit(git, "config", "--local", "--get", "user.email").Should().BeEmpty();
    }
}
