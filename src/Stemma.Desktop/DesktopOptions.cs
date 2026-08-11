namespace Stemma.Desktop;

/// <summary>
/// What the shell was asked to do. Everything it does not recognise is handed to the web host
/// unchanged, so <c>--log-level debug</c> and friends keep working without this file knowing they
/// exist.
/// </summary>
public sealed record DesktopOptions(string? WorkspacePath, bool ShowHelp, IReadOnlyList<string> HostArgs)
{
    public const string Usage = """
        stemma-desktop — Stemma in its own window.

          stemma-desktop [<workspace>] [options]

          --workspace <path>   Open this workspace on launch. A bare path does the same.
          --log-level <level>  trace | debug | information | warning | error | critical | none
          --log-format <fmt>   simple | json

        The window owns the backend: closing it stops the server. The port is chosen by the OS, so
        several windows can be open at once.
        """;

    public static DesktopOptions Parse(IReadOnlyList<string> args)
    {
        string? workspace = null;
        var showHelp = false;
        var hostArgs = new List<string>();

        for (var i = 0; i < args.Count; i++)
        {
            switch (args[i])
            {
                case "--workspace" or "-w" when i + 1 < args.Count:
                    workspace = args[++i];
                    break;
                case "-h" or "--help" or "help":
                    showHelp = true;
                    break;
                // A bare path, which is what a `.desktop` entry's `%f` expands to when Stemma is
                // registered as a folder handler — and what anyone types by hand. Distinguished
                // from the *value* of a flag by looking at what came before it.
                case var bare when workspace is null && !bare.StartsWith('-') && !PrecededByAFlag(args, i):
                    workspace = bare;
                    break;
                default:
                    hostArgs.Add(args[i]);
                    break;
            }
        }

        // Resolved here rather than at the point of use: a relative path means "relative to where I
        // typed this", and by the time the window is up the working directory is no longer evidence
        // of anything.
        if (workspace is not null) workspace = Path.GetFullPath(workspace);

        return new DesktopOptions(workspace, showHelp, hostArgs);
    }

    /// <summary>`--log-level debug` — "debug" belongs to the flag, not to the shell.</summary>
    private static bool PrecededByAFlag(IReadOnlyList<string> args, int index) =>
        index > 0 && args[index - 1].StartsWith('-');
}
