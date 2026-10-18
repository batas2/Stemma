using System.Text.Json;

namespace Stemma.Cli;

public static class ValidateCommand
{
    public const string Usage = """
        stemma validate — check a workspace for the things the compiler cannot see.

          stemma validate --workspace <path> [--json] [--strict]

        Ids in flows, dependencies, aboutId, views and books are strings. Nothing verifies them at
        build time or at run time: a typo produces a missing node, a missing edge or a page that
        points at nothing, silently.

        Options
          --workspace <path>   Workspace root. Defaults to the current directory.
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

        string workspace = Directory.GetCurrentDirectory();
        var json = false;
        var strict = false;

        for (var i = 0; i < args.Length; i++)
        {
            switch (args[i])
            {
                case "--workspace":
                    if (i + 1 >= args.Length) return Fail("--workspace needs a path");
                    workspace = args[++i];
                    break;
                case "--json": json = true; break;
                case "--strict": strict = true; break;
                default:
                    if (args[i].StartsWith("--", StringComparison.Ordinal)) return Fail($"unknown option '{args[i]}'");
                    break;
            }
        }

        workspace = Path.GetFullPath(workspace);
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

    private static Task<int> Fail(string message)
    {
        Console.Error.WriteLine($"stemma validate: {message}");
        Console.Error.WriteLine();
        Console.Error.WriteLine(Usage);
        return Task.FromResult(2);
    }
}
