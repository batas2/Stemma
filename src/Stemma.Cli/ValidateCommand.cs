using System.Text.Json;

namespace Stemma.Cli;

public static class ValidateCommand
{
    public const string Usage = """
        stemma validate — check a workspace for the things the compiler cannot see.

          stemma validate [<path>] [--workspace <path>] [--json] [--strict]

        Ids in flows, dependencies, aboutId, views and books are strings. Nothing verifies them at
        build time or at run time: a typo produces a missing node, a missing edge or a page that
        points at nothing, silently.

        Options
          <path>, --workspace <path>
                               Workspace root, either way. Defaults to the current directory.
          --json               Machine-readable output. An agent can act on this; it cannot act on
                               a node it never sees.
          --strict             Treat warnings as failures too.

        Exit codes
          0  nothing wrong (warnings and notes may still be printed)
          1  at least one error, or a warning under --strict
          2  the command line was wrong
        """;

    public static Task<int> RunAsync(string[] args)
    {
        if (args.Contains("--help") || args.Contains("-h"))
        {
            Console.WriteLine(Usage);
            return Task.FromResult(0);
        }

        string? flagged = null;
        string? positional = null;
        var json = false;
        var strict = false;

        for (var i = 0; i < args.Length; i++)
        {
            switch (args[i])
            {
                case "--workspace":
                    if (i + 1 >= args.Length) return Fail("--workspace needs a path");
                    flagged = args[++i];
                    break;
                case "--json": json = true; break;
                case "--strict": strict = true; break;
                default:
                    if (args[i].StartsWith('-')) return Fail($"unknown option '{args[i]}'");
                    // A bare path is the natural way to type this, as it is for `stemma open`. Ignored,
                    // it had the current directory checked instead, and reported as no workspace.
                    if (positional is not null) return Fail($"unexpected argument '{args[i]}' — validate checks one workspace");
                    positional = args[i];
                    break;
            }
        }

        if (flagged is not null && positional is not null && !SameFolder(flagged, positional))
            return Fail($"two workspaces given, '{positional}' and --workspace '{flagged}' — name one");
        var workspace = Path.GetFullPath(flagged ?? positional ?? Directory.GetCurrentDirectory());
        if (!Directory.Exists(workspace))
        {
            Console.Error.WriteLine($"stemma validate: no such workspace '{workspace}'");
            return Task.FromResult(1);
        }

        var findings = WorkspaceCheck.Run(workspace);
        var errors = findings.Count(f => f.Severity == CheckSeverity.Error);
        var warnings = findings.Count(f => f.Severity == CheckSeverity.Warning);

        if (json)
        {
            Console.WriteLine(JsonSerializer.Serialize(new
            {
                workspace,
                ok = errors == 0 && (!strict || warnings == 0),
                errors,
                warnings,
                findings = findings.Select(f => new
                {
                    severity = f.Severity.ToString().ToLowerInvariant(),
                    rule = f.Rule,
                    message = f.Message,
                    elementId = f.ElementId,
                }),
            }, new JsonSerializerOptions { WriteIndented = true }));
        }
        else if (findings.Count == 0)
        {
            Console.WriteLine($"stemma validate: {Path.GetFileName(workspace)} — nothing to report");
        }
        else
        {
            foreach (var f in findings.OrderBy(f => f.Severity))
                Console.WriteLine($"  {f.Severity.ToString().ToLowerInvariant(),-7} {f.Rule,-28} {f.Message}");
            Console.WriteLine($"stemma validate: {errors} error(s), {warnings} warning(s)");
        }

        return Task.FromResult(errors > 0 || (strict && warnings > 0) ? 1 : 0);
    }

    private static bool SameFolder(string a, string b)
    {
        static string Normal(string p) => Path.TrimEndingDirectorySeparator(Path.GetFullPath(p));
        var comparison = OperatingSystem.IsWindows() || OperatingSystem.IsMacOS() ? StringComparison.OrdinalIgnoreCase : StringComparison.Ordinal;
        return string.Equals(Normal(a), Normal(b), comparison);
    }

    private static Task<int> Fail(string message)
    {
        Console.Error.WriteLine($"stemma validate: {message}");
        Console.Error.WriteLine();
        Console.Error.WriteLine(Usage);
        return Task.FromResult(2);
    }
}
