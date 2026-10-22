using System.Text.Json;

namespace Stemma.Cli;

/// <summary>
/// `stemma hook post-edit` — what the Claude Code plugin runs after every file an agent writes
/// (F-026, ADR-0030).
///
/// An agent that edits a model and moves on finds out what it broke only when it remembers to run
/// `validate`, which is usually three edits later and far from the cause. The hook closes that gap:
/// after a write to a workspace file it validates the workspace and, when there is an error, says what
/// and where, while the edit that caused it is still the last thing the agent did.
///
/// The logic lives here rather than in a shell script so that it needs neither `jq` nor a POSIX shell,
/// and behaves the same everywhere the CLI runs. It reads and validates; it never writes.
/// </summary>
public static class HookCommand
{
    public const string Usage = """
        stemma hook — entry points for agent hooks.

          stemma hook post-edit     Read a Claude Code PostToolUse event on stdin; if the file it wrote
                                    belongs to a Stemma workspace, validate the workspace. Exit 2 with the
                                    errors on stderr when there are any, which Claude reads; otherwise 0.
        """;

    /// <summary>The folders and files of a workspace an edit can break. Anything else is not our business.</summary>
    private static readonly string[] WorkspaceFolders = ["Architecture", "Views", "Rules"];
    private const string Sidecar = "stemma.layout.json";

    /// <summary>At most this many errors are listed; the rest are counted. The agent can run validate for all of them.</summary>
    private const int MaxListed = 12;

    public static Task<int> RunAsync(string[] args) => RunAsync(args, Console.In, Console.Error);

    public static async Task<int> RunAsync(string[] args, TextReader stdin, TextWriter stderr)
    {
        if (args.Length == 0 || args[0] is "--help" or "-h" || args[0] != "post-edit")
        {
            await stderr.WriteLineAsync(Usage);
            return args.Length > 0 && args[0] is "--help" or "-h" ? 0 : 2;
        }

        // A hook must never get in the way: an event it cannot read, or a file that is not part of a
        // workspace, is silence and success.
        var path = FilePathFrom(await stdin.ReadToEndAsync());
        if (path is null) return 0;
        var root = WorkspaceRootFor(path);
        if (root is null) return 0;

        IReadOnlyList<CheckFinding> findings;
        try
        {
            findings = WorkspaceCheck.Run(root);
        }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException)
        {
            // A file mid-write, or one the agent cannot read: the next edit will try again, and saying
            // nothing beats blocking the agent on a check that could not run.
            return 0;
        }

        var errors = findings.Where(f => f.Severity == CheckSeverity.Error).ToList();
        if (errors.Count == 0) return 0;

        await stderr.WriteLineAsync($"stemma validate: {errors.Count} error{(errors.Count == 1 ? "" : "s")} in {root} after editing {Path.GetRelativePath(root, path)}:");
        foreach (var f in errors.Take(MaxListed))
            await stderr.WriteLineAsync($"  {f.Rule}: {f.Message}");
        if (errors.Count > MaxListed)
            await stderr.WriteLineAsync($"  … and {errors.Count - MaxListed} more — run `stemma validate {root}` for all of them.");
        await stderr.WriteLineAsync("Fix these before rendering; an unfinished edit across several files may explain some of them.");
        return 2;
    }

    /// <summary>`tool_input.file_path` of a PostToolUse event, or null.</summary>
    internal static string? FilePathFrom(string json)
    {
        if (string.IsNullOrWhiteSpace(json)) return null;
        try
        {
            using var doc = JsonDocument.Parse(json);
            return doc.RootElement.TryGetProperty("tool_input", out var input)
                && input.ValueKind == JsonValueKind.Object
                && input.TryGetProperty("file_path", out var p)
                && p.ValueKind == JsonValueKind.String
                ? Path.GetFullPath(p.GetString()!)
                : null;
        }
        catch (JsonException)
        {
            return null;
        }
    }

    /// <summary>
    /// The workspace an edited file belongs to: the folder above an `Architecture`, `Views` or `Rules`
    /// folder that holds it (at any depth), or holding it as its sidecar — and only when that folder has a
    /// model, so a `Views` folder in some other project is left alone.
    /// </summary>
    internal static string? WorkspaceRootFor(string path)
    {
        if (Path.GetFileName(path) == Sidecar)
        {
            var dir = Path.GetDirectoryName(path);
            return dir is not null && HasModel(dir) ? dir : null;
        }
        if (!path.EndsWith(".cs", StringComparison.OrdinalIgnoreCase)) return null;

        for (var dir = Path.GetDirectoryName(path); dir is not null; dir = Path.GetDirectoryName(dir))
        {
            if (!WorkspaceFolders.Contains(Path.GetFileName(dir), StringComparer.OrdinalIgnoreCase)) continue;
            var root = Path.GetDirectoryName(dir);
            if (root is not null && HasModel(root)) return root;
        }
        return null;
    }

    private static bool HasModel(string root)
    {
        var architecture = Path.Combine(root, "Architecture");
        return Directory.Exists(architecture)
            && Directory.EnumerateFiles(architecture, "*.cs", SearchOption.AllDirectories).Any();
    }
}
