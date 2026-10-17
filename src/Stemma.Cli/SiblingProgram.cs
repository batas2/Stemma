using System.Diagnostics;
using System.Runtime.InteropServices;

namespace Stemma.Cli;

/// <summary>
/// How to start a .NET program that ships beside this one: the web host for a render, the shell for
/// `stemma open`.
///
/// The two ways Stemma is shipped want opposite things (B-016). Framework-dependent — a source
/// build, the tool package — the program is a dll and runs on the runtime this CLI is running on,
/// which is not necessarily the `dotnet` PATH finds first, and need not be on PATH at all when a
/// tool shim found it. Self-contained — the tarball — there is no `dotnet` anywhere, by design: the
/// program has its own executable, with the runtime in the same folder.
/// </summary>
public static class SiblingProgram
{
    public static ProcessStartInfo StartInfo(string dll) =>
        StartInfo(dll, RuntimeEnvironment.GetRuntimeDirectory());

    public static ProcessStartInfo StartInfo(string dll, string runtimeDirectory)
    {
        var muxer = MuxerFor(runtimeDirectory);
        if (muxer is not null) return OnMuxer(muxer, dll);

        var apphost = Path.ChangeExtension(dll, OperatingSystem.IsWindows() ? ".exe" : null);
        if (File.Exists(apphost)) return new ProcessStartInfo(apphost) { UseShellExecute = false };

        // Neither layout: leave it to PATH, so the failure names the thing that is missing.
        return OnMuxer("dotnet", dll);
    }

    private static ProcessStartInfo OnMuxer(string muxer, string dll)
    {
        var psi = new ProcessStartInfo(muxer) { UseShellExecute = false };
        psi.ArgumentList.Add(dll);
        return psi;
    }

    /// <summary>
    /// A shared runtime lives at <c>&lt;root&gt;/shared/Microsoft.NETCore.App/&lt;version&gt;/</c>,
    /// with the muxer at <c>&lt;root&gt;/dotnet</c>. A self-contained app's runtime directory is the
    /// app's own folder, which has neither.
    /// </summary>
    private static string? MuxerFor(string runtimeDirectory)
    {
        var version = new DirectoryInfo(Path.TrimEndingDirectorySeparator(runtimeDirectory));
        var framework = version.Parent;
        var shared = framework?.Parent;
        if (framework?.Name != "Microsoft.NETCore.App" || shared?.Name != "shared" || shared.Parent is null)
            return null;

        var muxer = Path.Combine(shared.Parent.FullName, OperatingSystem.IsWindows() ? "dotnet.exe" : "dotnet");
        return File.Exists(muxer) ? muxer : null;
    }
}
