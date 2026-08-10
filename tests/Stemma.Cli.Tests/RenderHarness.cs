using System.Diagnostics;
using Xunit;

namespace Stemma.Cli.Tests;

/// <summary>
/// Drives the real `stemma render` as a subprocess against a workspace written to a temp directory.
///
/// B-002 and B-003 were both invisible below this level — every unit underneath them behaved. The
/// only test that would have caught either one asserts on the file that came out, so these run the
/// shipped command rather than calling into the renderer: `HostLocation` resolves paths relative to
/// the executing assembly, and an in-process call from a test assembly resolves them somewhere else.
///
/// The cost is that this needs a built host, a built front end and Chrome. When those are absent the
/// tests skip rather than fail, so `dotnet test` on a clean checkout stays green and honest.
/// </summary>
internal static class RenderHarness
{
    private static readonly Lazy<string?> Cli = new(FindCli);

    /// <summary>Why these tests cannot run here, or null when they can.</summary>
    public static string? SkipReason => Cli.Value is null
        ? "needs a built CLI and web host with wwwroot — run `dotnet build` and `npm run build` first"
        : null;

    /// <summary>
    /// The built `stemma.dll`, preferring whichever configuration also has a host beside it. Both
    /// halves have to be present: a CLI without `wwwroot` starts, serves the API and 404s the page.
    /// </summary>
    private static string? FindCli()
    {
        var root = RepositoryRoot();
        if (root is null) return null;

        foreach (var cfg in new[] { "Debug", "Release" })
        {
            var cli = Path.Combine(root, "src", "Stemma.Cli", "bin", cfg, "net10.0", "stemma.dll");
            var host = Path.Combine(root, "src", "Stemma.Web", "bin", cfg, "net10.0", "Stemma.Web.dll");
            var wwwroot = Path.Combine(root, "src", "Stemma.Web", "wwwroot");
            if (File.Exists(cli) && File.Exists(host) && Directory.Exists(wwwroot)) return cli;
        }

        return null;
    }

    private static string? RepositoryRoot()
    {
        var dir = new DirectoryInfo(AppContext.BaseDirectory);
        while (dir is not null && !File.Exists(Path.Combine(dir.FullName, "Stemma.slnx"))) dir = dir.Parent;
        return dir?.FullName;
    }

    /// <summary>
    /// Run a render. Generous timeout: the command starts its own host and a browser, and a machine
    /// under load is slow rather than broken.
    /// </summary>
    public static (int ExitCode, string Output) Render(params string[] args)
    {
        var psi = new ProcessStartInfo("dotnet")
        {
            RedirectStandardOutput = true,
            RedirectStandardError = true,
        };
        psi.ArgumentList.Add(Cli.Value!);
        psi.ArgumentList.Add("render");
        foreach (var a in args) psi.ArgumentList.Add(a);

        using var p = Process.Start(psi)!;
        var stdout = p.StandardOutput.ReadToEndAsync();
        var stderr = p.StandardError.ReadToEndAsync();
        if (!p.WaitForExit(TimeSpan.FromMinutes(5)))
        {
            p.Kill(entireProcessTree: true);
            throw new TimeoutException("stemma render did not finish within five minutes");
        }

        return (p.ExitCode, stdout.Result + stderr.Result);
    }

    /// <summary>
    /// Write a workspace: `Architecture.cs` with one <c>Concept</c> per id, a view over all of them,
    /// and the sidecar under test. No project file — the loader does not need one, and the layout is
    /// the only part any of these tests is really varying.
    /// </summary>
    public static string Workspace(string dir, string viewId, IReadOnlyList<string> ids, string sidecar)
    {
        Directory.CreateDirectory(Path.Combine(dir, "Architecture"));
        Directory.CreateDirectory(Path.Combine(dir, "Views"));

        var concepts = string.Join("\n", ids.Select((id, i) =>
            $"        var e{i} = new Concept(\"{id}\", \"{id.Replace('_', ' ')}\");"));
        var names = string.Join(", ", ids.Select((_, i) => $"e{i}"));

        File.WriteAllText(Path.Combine(dir, "Architecture", "Architecture.cs"), $$"""
            using Stemma.Model;

            namespace Fixture;

            public static class Architecture
            {
                public static Model Build()
                {
            {{concepts}}
                    return Model.Of({{names}});
                }
            }

            """);

        var elementIds = string.Join(", ", ids.Select(id => $"\"{id}\""));
        File.WriteAllText(Path.Combine(dir, "Views", "Fixture.cs"), $$"""
            using Stemma.Model;

            namespace Fixture;

            public static class FixtureView
            {
                public static View Define() => new(
                    Id: "{{viewId}}",
                    Name: "Fixture",
                    BaseView: "all",
                    ElementIds: new[] { {{elementIds}} });
            }

            """);

        File.WriteAllText(Path.Combine(dir, "stemma.layout.json"), sidecar);
        return dir;
    }
}

/// <summary>A fact that skips, with a reason, when this machine cannot run a render.</summary>
public sealed class RenderFactAttribute : FactAttribute
{
    public RenderFactAttribute() => Skip = RenderHarness.SkipReason;
}
