using System.Text.Json;

namespace Stemma.Cli;

public static class RenderCommand
{
    public static async Task<int> RunAsync(string[] args)
    {
        if (args.Length == 0 || args.Contains("--help") || args.Contains("-h"))
        {
            Console.WriteLine(RenderOptions.Usage);
            return 0;
        }

        var parsed = RenderOptions.Parse(args);
        if (!parsed.Ok)
        {
            Console.Error.WriteLine($"stemma render: {parsed.Error}");
            Console.Error.WriteLine();
            Console.Error.WriteLine(RenderOptions.Usage);
            return 2;
        }
        var o = parsed.Options!;

        if (!Directory.Exists(o.Workspace))
        {
            Console.Error.WriteLine($"stemma render: no such workspace '{o.Workspace}'");
            return 1;
        }

        var palette = o.Palette ?? "dual-theme";

        // --check answers "is the committed picture still current?" without rendering anything, which
        // is what a build wants: it is cheap, it needs no browser, and it fails loudly rather than
        // quietly replacing a file nobody asked it to touch.
        if (o.CheckOnly) return CheckManifest(o, palette);

        var location = HostLocation.Find();
        if (location is null)
        {
            Console.Error.WriteLine("stemma render: could not find a built Stemma.Web with its wwwroot — run `dotnet build` and `npx vite build` first");
            return 1;
        }

        await using var host = await HostProcess.StartAsync(location.Dll, location.ContentRoot, TimeSpan.FromSeconds(o.TimeoutSeconds));
        await host.OpenWorkspaceAsync(o.Workspace);

        await using var renderer = new DiagramRenderer(host.BaseUrl);
        var written = new List<RenderedFile>();

        // Themes outer, formats inner: one page load per theme is the expensive part.
        foreach (var theme in o.Themes)
        {
            foreach (var format in o.Formats)
            {
                var file = await renderer.RenderAsync(o, theme, format);
                written.Add(file);
                Console.WriteLine($"  {Path.GetFileName(file.Path)}  {file.Width}x{file.Height}  {file.NodeCount} nodes");
            }
        }

        if (o.Manifest) await WriteManifestAsync(o, palette, written);

        Console.WriteLine($"stemma render: wrote {written.Count} file{(written.Count == 1 ? "" : "s")}");
        return 0;
    }

    private static string ManifestPath(RenderOptions o) =>
        Path.Combine(Path.GetDirectoryName(o.Output)!, $"{Path.GetFileNameWithoutExtension(o.Output)}.manifest.json");

    /// <summary>
    /// A sibling manifest describing what was drawn and what it was drawn from.
    ///
    /// A published PNG is otherwise an ordinary image: nothing notices when the model moves on, and
    /// the picture goes on making a claim that has stopped being true. This is the "cannot lie"
    /// promise extended past the app window — and the thing a drawing tool structurally cannot do.
    /// </summary>
    private static async Task WriteManifestAsync(RenderOptions o, string palette, IReadOnlyList<RenderedFile> files)
    {
        var fp = SourceFingerprint.For(o.Workspace, o.View, o.Profile, palette);
        var manifest = new
        {
            view = o.View,
            profile = o.Profile,
            palette,
            transparent = o.Transparent,
            scale = o.Scale,
            source = new { hash = fp.Hash, elements = fp.Elements, links = fp.Links, viewMembers = fp.ViewMembers },
            files = files.Select(f => new { path = Path.GetFileName(f.Path), theme = f.Theme, format = f.Format, nodes = f.NodeCount, width = f.Width, height = f.Height }),
        };
        Directory.CreateDirectory(Path.GetDirectoryName(o.Output)!);
        await File.WriteAllTextAsync(ManifestPath(o), JsonSerializer.Serialize(manifest, new JsonSerializerOptions { WriteIndented = true }));
    }

    private static int CheckManifest(RenderOptions o, string palette)
    {
        var path = ManifestPath(o);
        if (!File.Exists(path))
        {
            Console.Error.WriteLine($"stemma render --check: no manifest at {path} — render it once first");
            return 1;
        }

        using var doc = JsonDocument.Parse(File.ReadAllText(path));
        var recorded = doc.RootElement.GetProperty("source");
        var now = SourceFingerprint.For(o.Workspace, o.View, o.Profile, palette);

        if (recorded.GetProperty("hash").GetString() == now.Hash)
        {
            Console.WriteLine($"stemma render --check: {Path.GetFileName(o.Output)} is current");
            return 0;
        }

        // Say what moved, not just that something did: "hash mismatch" is not actionable.
        var was = (recorded.GetProperty("elements").GetInt32(), recorded.GetProperty("links").GetInt32(), recorded.GetProperty("viewMembers").GetInt32());
        Console.Error.WriteLine($"stemma render --check: {Path.GetFileName(o.Output)} is out of date");
        Console.Error.WriteLine($"  elements {was.Item1} -> {now.Elements}, links {was.Item2} -> {now.Links}, view members {was.Item3} -> {now.ViewMembers}");
        if (was == (now.Elements, now.Links, now.ViewMembers))
            Console.Error.WriteLine("  counts match, so something was renamed, re-linked, or moved in the layout");
        return 1;
    }

}
