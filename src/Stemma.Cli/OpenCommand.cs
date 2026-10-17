using System.Diagnostics;
using System.Reflection;

namespace Stemma.Cli;

/// <summary>
/// `stemma open` — the window, from the command line.
///
/// The shell is a separate binary on purpose: it links a native webview, and the render path must
/// stay headless and light (ADR-0017). This command is the thin bridge, so that the name a person
/// already knows opens the app, without `stemma render` acquiring GTK.
/// </summary>
internal static class OpenCommand
{
    public const string Usage = """
        stemma open — open Stemma in its own window.

          stemma open [<workspace>] [--workspace <path>] [--log-level <level>]

        With no arguments the window opens on the start screen. Everything is passed through to the
        shell, so `stemma open --help` prints its options.
        """;

    private const string ShellName = "stemma-desktop";
    private const string ShellDll = ShellName + ".dll";

    public static async Task<int> RunAsync(string[] args)
    {
        if (args.Length > 0 && args[0] is "-h" or "--help")
        {
            Console.WriteLine(Usage);
            return 0;
        }

        var shell = FindShell();
        if (shell is null)
            return Cli.Fail($"could not find '{ShellName}'. It ships beside this binary; from a source "
                            + "tree, build it with `dotnet build src/Stemma.Desktop`.");

        var psi = SiblingProgram.StartInfo(shell);
        // A bare path is the natural way to type this, and the shell only understands the flag.
        if (args.Length > 0 && !args[0].StartsWith('-'))
        {
            psi.ArgumentList.Add("--workspace");
            psi.ArgumentList.Add(args[0]);
            foreach (var arg in args.Skip(1)) psi.ArgumentList.Add(arg);
        }
        else
        {
            foreach (var arg in args) psi.ArgumentList.Add(arg);
        }

        using var process = Process.Start(psi);
        if (process is null) return Cli.Fail($"could not start '{psi.FileName}'");

        // Waited on rather than detached: Ctrl-C then closes the window, and whatever the shell
        // writes reaches the terminal that asked for it.
        await process.WaitForExitAsync();
        return process.ExitCode;
    }

    /// <summary>Published side by side, or built from this repository.</summary>
    private static string? FindShell()
    {
        var here = Path.GetDirectoryName(Assembly.GetExecutingAssembly().Location)!;

        var published = Path.Combine(here, ShellDll);
        if (File.Exists(published)) return published;

        // …/src/Stemma.Cli/bin/<cfg>/<tfm>/ → …/src/Stemma.Desktop/bin/<cfg>/<tfm>/
        var dir = new DirectoryInfo(here);
        var tfm = dir.Name;
        var cfg = dir.Parent?.Name;
        var srcDir = dir.Parent?.Parent?.Parent?.Parent;
        if (cfg is null || srcDir is null) return null;

        var built = Path.Combine(srcDir.FullName, "Stemma.Desktop", "bin", cfg, tfm, ShellDll);
        return File.Exists(built) ? built : null;
    }
}
