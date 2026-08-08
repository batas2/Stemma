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

        Console.WriteLine($"stemma render: wrote {written.Count} file{(written.Count == 1 ? "" : "s")}");
        return 0;
    }

}
