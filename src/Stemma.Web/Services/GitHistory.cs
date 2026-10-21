using System.Diagnostics;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using Microsoft.CodeAnalysis.CSharp;
using Stemma.Engine.ArchModel;
using Stemma.Engine.Workspace;

namespace Stemma.Web.Services;

/// <summary>
/// What the model was at a revision, read from Git and kept nowhere (ADR-0024, F-017).
///
/// The <c>git</c> command, never a shell: every argument is its own entry in <c>ArgumentList</c>, and a
/// revision is refused unless it looks like one, so nothing a request carries can become an option or
/// a command. The model files at a revision are parsed by the engine's own reader and merged by the
/// same rule as the live model, so the two are comparable element by element.
/// </summary>
public static class GitHistory
{
    public sealed record Commit(string Sha, string ShortSha, string Subject, string Author, DateTimeOffset When);
    public sealed record Tag(string Name, string Sha);

    public sealed record History(
        bool Repository,
        string? Reason,
        string? Branch,
        string? DefaultBranch,
        string? MergeBase,
        IReadOnlyList<Commit> Commits,
        IReadOnlyList<Tag> Tags);

    /// <param name="Arch">The model at that revision; null when there was none (the model did not exist yet).</param>
    /// <param name="Layout">The layout sidecar at that revision, as it was written; null when there was none.</param>
    public sealed record ModelAt(string Rev, string Sha, ArchModel? Arch, JsonElement? Layout);

    public sealed class RevisionNotFound(string message) : Exception(message);

    private const int CommitCount = 25;
    private static readonly TimeSpan Timeout = TimeSpan.FromSeconds(15);

    /// <summary>What a revision may look like: a sha, a branch, a tag, HEAD~2, main@{1}. Never an option.</summary>
    private static readonly Regex RevisionShape = new(@"^[A-Za-z0-9][A-Za-z0-9._/@^~{}-]{0,199}$", RegexOptions.CultureInvariant);

    public static bool IsRevision(string? rev) => rev is not null && RevisionShape.IsMatch(rev) && !rev.Contains("..");

    public static async Task<History> ReadAsync(string root, CancellationToken ct = default)
    {
        var inside = await RunAsync(root, ct, "rev-parse", "--is-inside-work-tree");
        if (inside.Error is not null) return Unavailable(inside.Error);
        if (inside.ExitCode != 0 || inside.Output.Trim() != "true")
            return Unavailable("This model is not in a Git repository.");

        var branch = await RunAsync(root, ct, "symbolic-ref", "--quiet", "--short", "HEAD");
        var current = branch.ExitCode == 0 ? branch.Output.Trim() : null;
        var defaultBranch = await DefaultBranchAsync(root, ct);
        string? mergeBase = null;
        if (defaultBranch is not null && current is not null && current != defaultBranch)
        {
            var mb = await RunAsync(root, ct, "merge-base", "HEAD", defaultBranch);
            if (mb.ExitCode == 0) mergeBase = mb.Output.Trim();
        }

        // Commits that touched this folder: the model and its sidecar, not the rest of a monorepo.
        var log = await RunAsync(root, ct, "log", $"--max-count={CommitCount}", "--format=%H%x1f%h%x1f%s%x1f%an%x1f%aI", "--", ".");
        var commits = log.ExitCode != 0 ? [] : log.Output
            .Split('\n', StringSplitOptions.RemoveEmptyEntries)
            .Select(line => line.Split('\u001f'))
            .Where(f => f.Length == 5)
            .Select(f => new Commit(f[0], f[1], f[2], f[3], DateTimeOffset.TryParse(f[4], out var when) ? when : DateTimeOffset.MinValue))
            .ToList();

        var tagList = await RunAsync(root, ct, "for-each-ref", "--sort=-creatordate", "--count=10", "--format=%(refname:short)%1f%(objectname)", "refs/tags");
        var tags = tagList.ExitCode != 0 ? [] : tagList.Output
            .Split('\n', StringSplitOptions.RemoveEmptyEntries)
            .Select(line => line.Split('\u001f'))
            .Where(f => f.Length == 2)
            .Select(f => new Tag(f[0], f[1]))
            .ToList();

        return new History(true, commits.Count == 0 ? "No commit has the model in it yet." : null, current, defaultBranch, mergeBase, commits, tags);
    }

    /// <summary>The model and its sidecar at <paramref name="rev"/>, read from the repository holding <paramref name="root"/>.</summary>
    /// <exception cref="RevisionNotFound">The revision is not shaped like one, or the repository has no such commit.</exception>
    public static async Task<ModelAt> ModelAtAsync(string root, string rev, CancellationToken ct = default)
    {
        if (!IsRevision(rev)) throw new RevisionNotFound($"\"{rev}\" is not a revision.");
        var resolved = await RunAsync(root, ct, "rev-parse", "--verify", "--quiet", $"{rev}^{{commit}}");
        if (resolved.Error is not null) throw new RevisionNotFound(resolved.Error);
        if (resolved.ExitCode != 0) throw new RevisionNotFound($"There is no commit \"{rev}\" in this repository.");
        var sha = resolved.Output.Trim();

        // Paths relative to the workspace, wherever it sits in the repository. NUL-separated, because git
        // quotes a name with anything but ASCII in it otherwise, and "Zamówienia.cs" would come back as
        // a quoted string that is no file at all. A model file is any C# file in a folder named
        // Architecture, as the live workspace reads them.
        var files = await RunAsync(root, ct, "ls-tree", "-r", "-z", "--name-only", sha, "--", ".");
        var modelFiles = files.ExitCode != 0 ? [] : files.Output
            .Split('\0', StringSplitOptions.RemoveEmptyEntries)
            .Where(IsModelFile)
            .ToList();

        var partials = new List<ArchModel?>();
        string? primary = null;
        foreach (var path in ArchModelMerge.ReadingOrder(modelFiles))
        {
            var text = await RunAsync(root, ct, "show", $"{sha}:./{path}");
            if (text.ExitCode != 0) continue;
            var syntax = CSharpSyntaxTree.ParseText(text.Output, path: path, cancellationToken: ct).GetRoot(ct);
            var partial = DslReader.TryRead(Path.Combine(root, path), syntax);
            if (partial is null) continue;
            primary ??= partial.FilePath;
            partials.Add(partial);
        }
        var arch = primary is null ? null : ArchModelMerge.Merge(primary, partials);

        JsonElement? layout = null;
        var sidecar = await RunAsync(root, ct, "show", $"{sha}:./{Path.GetFileName(LayoutSidecar.PathFor(root))}");
        if (sidecar.ExitCode == 0)
        {
            // A sidecar a merge left unreadable then is no reason not to show the model: positions are a nicety.
            try { layout = JsonDocument.Parse(sidecar.Output).RootElement.Clone(); }
            catch (JsonException) { layout = null; }
        }
        return new ModelAt(rev, sha, arch, layout);
    }

    private static History Unavailable(string reason) => new(false, reason, null, null, null, [], []);

    /// <summary>A C# file inside a folder named <c>Architecture</c>, not generated — the live read's rule.</summary>
    public static bool IsModelFile(string path) => ArchModelMerge.IsModelFile(path);

    private static async Task<string?> DefaultBranchAsync(string root, CancellationToken ct)
    {
        // The remote's idea of its default branch, when there is a remote; otherwise main or master, whichever exists.
        var remote = await RunAsync(root, ct, "symbolic-ref", "--quiet", "--short", "refs/remotes/origin/HEAD");
        if (remote.ExitCode == 0 && remote.Output.Trim().Length > 0)
        {
            var name = remote.Output.Trim();
            return name.StartsWith("origin/", StringComparison.Ordinal) ? name["origin/".Length..] : name;
        }
        foreach (var candidate in new[] { "main", "master" })
        {
            var exists = await RunAsync(root, ct, "rev-parse", "--verify", "--quiet", $"refs/heads/{candidate}");
            if (exists.ExitCode == 0) return candidate;
        }
        return null;
    }

    private sealed record Result(int ExitCode, string Output, string? Error);

    private static async Task<Result> RunAsync(string root, CancellationToken ct, params string[] args)
    {
        var psi = new ProcessStartInfo("git")
        {
            WorkingDirectory = root,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            UseShellExecute = false,
            CreateNoWindow = true,
            StandardOutputEncoding = Encoding.UTF8,
        };
        foreach (var a in args) psi.ArgumentList.Add(a);
        // Read only: never wait on a credential prompt or a pager.
        psi.Environment["GIT_TERMINAL_PROMPT"] = "0";
        psi.Environment["GIT_PAGER"] = "cat";

        Process? process;
        try { process = Process.Start(psi); }
        catch (System.ComponentModel.Win32Exception) { return new Result(-1, "", "Git is not installed, or not on the PATH."); }
        if (process is null) return new Result(-1, "", "Git could not be started.");

        using (process)
        {
            using var timeout = CancellationTokenSource.CreateLinkedTokenSource(ct);
            timeout.CancelAfter(Timeout);
            var output = process.StandardOutput.ReadToEndAsync(timeout.Token);
            var error = process.StandardError.ReadToEndAsync(timeout.Token);
            try
            {
                await process.WaitForExitAsync(timeout.Token);
                return new Result(process.ExitCode, await output, null);
            }
            catch (OperationCanceledException)
            {
                // Too slow, or the request went away: either way nobody is waiting for this git any more.
                try { process.Kill(entireProcessTree: true); } catch (InvalidOperationException) { }
                if (ct.IsCancellationRequested) throw;
                return new Result(-1, "", "Git took too long to answer.");
            }
            finally
            {
                // Drained so a chatty stderr cannot fill its pipe and stall the process; not reported,
                // since the exit code already says whether the read worked.
                try { await error; } catch (OperationCanceledException) { }
            }
        }
    }
}
