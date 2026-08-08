using System.Reflection;

namespace Stemma.Cli;

/// <summary>
/// Where the built web host and its compiled front end are.
///
/// Two things have to be found and they are not in the same place. `Stemma.Web.dll` is in the build
/// output; `wwwroot` — the bundle Vite writes — lives in the *project* directory and is never copied
/// to output. Point the host at the wrong one and it starts happily, serves the API, and 404s the
/// page; the symptom surfaces several layers away as an opaque navigation failure, so both paths
/// are resolved explicitly here rather than left to the host's defaults.
/// </summary>
public sealed record HostLocation(string Dll, string ContentRoot)
{
    private const string HostDllName = "Stemma.Web.dll";

    /// <summary>
    /// Look in the two layouts that exist: published side by side, and built from this repository.
    /// Null when neither has a `wwwroot`, which is the real precondition — a host without one
    /// cannot serve a render, however well it starts.
    /// </summary>
    public static HostLocation? Find()
    {
        var here = Path.GetDirectoryName(Assembly.GetExecutingAssembly().Location)!;

        // Published: everything lands in one folder.
        if (File.Exists(Path.Combine(here, HostDllName)) && Directory.Exists(Path.Combine(here, "wwwroot")))
            return new HostLocation(Path.Combine(here, HostDllName), here);

        // Source tree: …/src/Stemma.Cli/bin/<cfg>/<tfm>/ → …/src/Stemma.Web/
        var dir = new DirectoryInfo(here);
        var tfm = dir.Name;
        var cfg = dir.Parent?.Name;
        var srcDir = dir.Parent?.Parent?.Parent?.Parent;      // tfm → cfg → bin → Stemma.Cli → src
        if (cfg is null || srcDir is null) return null;

        var webProject = Path.Combine(srcDir.FullName, "Stemma.Web");
        var builtDll = Path.Combine(webProject, "bin", cfg, tfm, HostDllName);
        if (File.Exists(builtDll) && Directory.Exists(Path.Combine(webProject, "wwwroot")))
            return new HostLocation(builtDll, webProject);

        return null;
    }
}
