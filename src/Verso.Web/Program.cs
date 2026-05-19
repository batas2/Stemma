using System.Text.Json;
using System.Text.Json.Serialization;
using Verso.Engine.Adapters.Yaml;
using Verso.Engine.ArchModel;
using Verso.Engine.Discovery;
using Verso.Engine.Workspace;
using Verso.Web.Hubs;
using Verso.Web.Services;

var builder = WebApplication.CreateBuilder(args);

builder.Services.AddSingleton<EngineHost>();
builder.Services.AddSingleton<DiscoveryService>();
builder.Services.AddSingleton<IClaudeTransport>(sp => SelectClaudeTransport(sp.GetRequiredService<IConfiguration>()));
builder.Services.AddSingleton<AiBroker>(sp => new AiBroker(sp.GetRequiredService<IClaudeTransport>()));

static IClaudeTransport SelectClaudeTransport(IConfiguration config)
{
    // Selection order:
    //   1. $VERSO_AI_TRANSPORT=cli|http (env wins — easy override per shell).
    //   2. config "Verso:Ai:Transport" from appsettings.json (project default = "cli").
    //   3. Auto-detect: prefer CLI when `claude` is on PATH; fall back to HTTP.
    var pinned = (Environment.GetEnvironmentVariable("VERSO_AI_TRANSPORT")
                  ?? config["Verso:Ai:Transport"])?.ToLowerInvariant();
    if (pinned == "cli") return new ClaudeCliTransport();
    if (pinned == "http") return new HttpClaudeTransport();

    var cli = new ClaudeCliTransport();
    return cli.IsAvailable ? cli : new HttpClaudeTransport();
}
builder.Services.AddSignalR().AddJsonProtocol(o =>
{
    o.PayloadSerializerOptions.PropertyNamingPolicy = JsonNamingPolicy.CamelCase;
    o.PayloadSerializerOptions.Converters.Add(new JsonStringEnumConverter(JsonNamingPolicy.CamelCase));
});
builder.Services.AddCors(o => o.AddDefaultPolicy(p => p
    .WithOrigins("http://localhost:5173", "http://127.0.0.1:5173")
    .AllowAnyHeader().AllowAnyMethod().AllowCredentials()));
builder.Services.ConfigureHttpJsonOptions(o =>
{
    o.SerializerOptions.PropertyNamingPolicy = JsonNamingPolicy.CamelCase;
    o.SerializerOptions.Converters.Add(new JsonStringEnumConverter(JsonNamingPolicy.CamelCase));
});

var app = builder.Build();

app.UseCors();
app.UseDefaultFiles();
app.UseStaticFiles();

var workspaceApi = app.MapGroup("/api/workspace");

workspaceApi.MapPost("/open", async (OpenWorkspaceRequest req, EngineHost host, CancellationToken ct) =>
{
    if (string.IsNullOrWhiteSpace(req.RootPath))
        return Results.BadRequest(new { error = "rootPath is required" });

    var resolved = Path.GetFullPath(req.RootPath);
    if (!Directory.Exists(resolved))
        return Results.BadRequest(new { error = $"Directory not found: {resolved}" });

    var hasSln = Directory.EnumerateFiles(resolved, "*.sln", SearchOption.TopDirectoryOnly).Any()
              || Directory.EnumerateFiles(resolved, "*.slnx", SearchOption.TopDirectoryOnly).Any();
    var hasProj = Directory.EnumerateFiles(resolved, "*.csproj", SearchOption.AllDirectories).Any();
    if (!hasSln && !hasProj)
        return Results.BadRequest(new { error = $"No .sln or .csproj found under {resolved}" });

    try
    {
        var snapshot = await host.OpenAsync(resolved, ct);
        return Results.Ok(snapshot);
    }
    catch (Exception ex)
    {
        return Results.BadRequest(new { error = ex.Message });
    }
});

workspaceApi.MapGet("/snapshot", (EngineHost host) =>
{
    var snap = host.Snapshot();
    return snap is null ? Results.NotFound() : Results.Ok(snap);
});

workspaceApi.MapPost("/close", async (EngineHost host) =>
{
    await host.CloseAsync();
    return Results.NoContent();
});

workspaceApi.MapPost("/init", async (InitWorkspaceRequest req, EngineHost host, CancellationToken ct) =>
{
    if (string.IsNullOrWhiteSpace(req.RootPath))
        return Results.BadRequest(new { error = "rootPath is required" });
    var resolved = Path.GetFullPath(req.RootPath);
    var name = string.IsNullOrWhiteSpace(req.Name) ? Path.GetFileName(resolved.TrimEnd('/', '\\')) : req.Name!;
    if (string.IsNullOrWhiteSpace(name)) name = "Workspace";

    Directory.CreateDirectory(resolved);
    Directory.CreateDirectory(Path.Combine(resolved, "Architecture"));

    // Locate Verso.Model.csproj relative to the running app for development; in production users
    // would reference the published NuGet package instead. Spike 02 supports both via the env var.
    var modelPath = Environment.GetEnvironmentVariable("VERSO_MODEL_PROJECT")
                    ?? Path.GetFullPath(Path.Combine(AppContext.BaseDirectory, "..", "..", "..", "..", "..", "src", "Verso.Model", "Verso.Model.csproj"));
    var hasLocalModel = File.Exists(modelPath);

    var csprojRef = hasLocalModel
        ? $"<ProjectReference Include=\"{modelPath}\" />"
        : "<PackageReference Include=\"Verso.Model\" Version=\"0.1.0\" />";

    var csproj = $"""
        <Project Sdk="Microsoft.NET.Sdk">
          <PropertyGroup>
            <TargetFramework>net8.0</TargetFramework>
            <Nullable>enable</Nullable>
            <ImplicitUsings>enable</ImplicitUsings>
            <LangVersion>latest</LangVersion>
            <NoWarn>$(NoWarn);CS1591;CS8019</NoWarn>
          </PropertyGroup>
          <ItemGroup>
            {csprojRef}
          </ItemGroup>
        </Project>
        """;
    var csprojPath = Path.Combine(resolved, $"{name}.csproj");
    if (!File.Exists(csprojPath)) await File.WriteAllTextAsync(csprojPath, csproj, ct);

    var archPath = Path.Combine(resolved, "Architecture", "Architecture.cs");
    if (!File.Exists(archPath))
    {
        var archStub = $$"""
            using Verso.Model;

            namespace {{name}};

            public static class Architecture
            {
                public static Model Build()
                {
                    return Model.Of();
                }
            }
            """;
        await File.WriteAllTextAsync(archPath, archStub, ct);
    }

    try
    {
        var snapshot = await host.OpenAsync(resolved, ct);
        return Results.Ok(snapshot);
    }
    catch (Exception ex)
    {
        return Results.BadRequest(new { error = ex.Message });
    }
});

workspaceApi.MapGet("/arch", async (EngineHost host, CancellationToken ct) =>
{
    var arch = await host.ReadArchAsync(ct);
    return arch is null ? Results.NotFound() : Results.Ok(arch);
});

// Epic 08 — Data-layer concepts (AggregateRoot / DomainEntity / ValueObject / Resource)
// and View Books live in `Concepts/*.verso.yaml`. The frontend Data Model + Resource Tree
// views render off this surface; the Books popover seeds from `books`.
workspaceApi.MapGet("/yaml-concepts", (EngineHost host) =>
{
    var engine = host.Engine;
    if (engine is null) return Results.NotFound();
    var adapter = YamlAdapter.Load(engine.RootPath);
    var concepts = adapter.AllConcepts.Select(c => new YamlConceptDto(
        c.Id, c.Kind, c.Name, c.Layer,
        c.Properties.ToDictionary(p => p.Key, p => (string?)p.Value),
        c.Aliases.ToArray())).ToArray();
    var relations = adapter.AllRelations.Select(r => new YamlRelationDto(
        r.Id, r.Kind, r.From, r.To,
        r.Properties.ToDictionary(p => p.Key, p => (string?)p.Value))).ToArray();
    var books = adapter.AllBooks.Select(b => new YamlBookDto(
        b.Id, b.Name, b.Audience,
        b.Pages.Select(p => new YamlBookPageDto(p.ViewId, p.Title, p.Narrative)).ToArray())).ToArray();
    return Results.Ok(new YamlConceptsResponse(concepts, relations, books));
});

workspaceApi.MapGet("/export/mermaid", async (string view, EngineHost host, CancellationToken ct) =>
{
    var arch = await host.ReadArchAsync(ct);
    if (arch is null) return Results.NotFound();
    var viewKind = view switch
    {
        "c4" or "c4Context" or "context" => ArchViewKind.C4Context,
        "module" or "moduleMap" => ArchViewKind.ModuleMap,
        "dependency" or "dependencyGraph" => ArchViewKind.DependencyGraph,
        _ => ArchViewKind.ModuleMap
    };
    var text = MermaidExporter.Export(arch, viewKind);
    return Results.Text(text, "text/plain");
});

workspaceApi.MapGet("/export/drawio", async (EngineHost host, CancellationToken ct) =>
{
    var arch = await host.ReadArchAsync(ct);
    if (arch is null) return Results.NotFound();
    var xml = DrawioExporter.Export(arch);
    return Results.Text(xml, "application/xml");
});

workspaceApi.MapPost("/export/book-pdf", (BookPdfRequest req) =>
{
    var book = new BookPdfExporter.PdfBook(
        req.Name,
        req.Audience,
        req.Pages.Select(p => new BookPdfExporter.PdfBookPage(
            p.ViewId,
            p.Title,
            p.Narrative,
            string.IsNullOrEmpty(p.CapturePngBase64) ? null : Convert.FromBase64String(p.CapturePngBase64)
        )).ToList());
    var bytes = BookPdfExporter.Render(book);
    var safeName = string.Concat(req.Name.Where(c => char.IsLetterOrDigit(c) || c is '-' or '_'));
    if (string.IsNullOrEmpty(safeName)) safeName = "book";
    return Results.File(bytes, "application/pdf", $"{safeName}.pdf");
});

workspaceApi.MapGet("/views", async (EngineHost host, CancellationToken ct) =>
{
    var engine = host.Engine;
    if (engine is null) return Results.NotFound();
    var viewsDir = Path.Combine(engine.RootPath, "Views");
    if (!Directory.Exists(viewsDir)) return Results.Ok(Array.Empty<ArchView>());
    var docs = new List<(string, Microsoft.CodeAnalysis.SyntaxNode)>();
    foreach (var path in Directory.EnumerateFiles(viewsDir, "*.cs", SearchOption.TopDirectoryOnly))
    {
        var content = await File.ReadAllTextAsync(path, ct);
        var tree = Microsoft.CodeAnalysis.CSharp.CSharpSyntaxTree.ParseText(content);
        docs.Add((path, tree.GetRoot()));
    }
    return Results.Ok(ViewsAdapter.ReadAllFrom(docs));
});

workspaceApi.MapPut("/views", async (ArchView view, EngineHost host, CancellationToken ct) =>
{
    var engine = host.Engine;
    if (engine is null) return Results.BadRequest(new { error = "no workspace open" });
    var ns = engine.NamespaceForViews();
    var (path, content) = ViewsAdapter.Render(engine.RootPath, ns, view);
    Directory.CreateDirectory(Path.GetDirectoryName(path)!);
    // Remove any existing file for this view id first (in case the name changed).
    var viewsDir = Path.GetDirectoryName(path)!;
    if (Directory.Exists(viewsDir))
    {
        foreach (var existing in Directory.EnumerateFiles(viewsDir, "*.cs"))
        {
            if (existing == path) continue;
            try
            {
                var existingContent = await File.ReadAllTextAsync(existing, ct);
                if (existingContent.Contains($"\"{view.Id}\"")) File.Delete(existing);
            }
            catch { /* ignore */ }
        }
    }
    await File.WriteAllTextAsync(path, content, ct);
    return Results.NoContent();
});

workspaceApi.MapDelete("/views/{viewId}", async (string viewId, EngineHost host, CancellationToken ct) =>
{
    var engine = host.Engine;
    if (engine is null) return Results.BadRequest(new { error = "no workspace open" });
    var viewsDir = Path.Combine(engine.RootPath, "Views");
    if (!Directory.Exists(viewsDir)) return Results.NotFound();
    foreach (var filePath in Directory.EnumerateFiles(viewsDir, "*.cs", SearchOption.TopDirectoryOnly))
    {
        var content = await File.ReadAllTextAsync(filePath, ct);
        if (!content.Contains($"\"{viewId}\"")) continue;
        File.Delete(filePath);
        return Results.NoContent();
    }
    return Results.NotFound();
});

workspaceApi.MapGet("/decisions/{decisionId}/narrative", async (string decisionId, EngineHost host, CancellationToken ct) =>
{
    var engine = host.Engine;
    if (engine is null) return Results.NotFound();
    var folder = Path.Combine(engine.RootPath, "Decisions");
    if (!Directory.Exists(folder)) return Results.NotFound();
    var path = Directory.EnumerateFiles(folder, $"{decisionId}-*.md").FirstOrDefault();
    if (path is null) return Results.NotFound();
    var content = await File.ReadAllTextAsync(path, ct);
    return Results.Text(content, "text/markdown");
});

workspaceApi.MapGet("/elements/{elementId}/narrative", async (string elementId, EngineHost host, CancellationToken ct) =>
{
    var engine = host.Engine;
    if (engine is null) return Results.NotFound();
    var arch = await engine.ReadArchModelAsync(ct);
    var elem = arch?.Elements.FirstOrDefault(e => e.Id == elementId);
    if (elem is null) return Results.NotFound();
    var folder = elem.Kind switch
    {
        ArchElementKind.Capability => "Capabilities",
        ArchElementKind.BoundedContext => "BoundedContexts",
        _ => "Elements",
    };
    var slug = string.Concat(elem.Name.ToLowerInvariant().Select(c => char.IsLetterOrDigit(c) ? c : '-'))
        .Trim('-')
        .Replace("--", "-");
    while (slug.Contains("--", StringComparison.Ordinal)) slug = slug.Replace("--", "-");
    var path = Path.Combine(engine.RootPath, folder, slug + ".md");
    if (!File.Exists(path)) return Results.Text(string.Empty, "text/markdown");
    var content = await File.ReadAllTextAsync(path, ct);
    return Results.Text(content, "text/markdown");
});

workspaceApi.MapGet("/recents", () => Results.Ok(RecentWorkspaces.Load()));

workspaceApi.MapGet("/violations", async (EngineHost host, CancellationToken ct) =>
{
    var engine = host.Engine;
    if (engine is null) return Results.NotFound();
    var violations = await engine.RunValidationAsync(ct);
    return Results.Ok(violations);
});

workspaceApi.MapGet("/layout", (EngineHost host) =>
{
    var engine = host.Engine;
    if (engine is null) return Results.NotFound();
    var sidecar = LayoutSidecar.Read(engine.RootPath);
    return Results.Ok(sidecar);
});

workspaceApi.MapPut("/layout", async (LayoutSidecar sidecar, EngineHost host) =>
{
    var engine = host.Engine;
    if (engine is null) return Results.BadRequest(new { error = "no workspace open" });
    sidecar.Write(engine.RootPath);
    await Task.CompletedTask;
    return Results.NoContent();
});

// ---------------- Epic 06 — Discovery, metrics, AI, view recommendations ----------------

workspaceApi.MapPost("/discovery/run", async (EngineHost host, DiscoveryService discovery, CancellationToken ct) =>
{
    var engine = host.Engine;
    if (engine is null) return Results.BadRequest(new { error = "no workspace open" });
    var bundle = await discovery.RunAsync(engine.Model, engine.Solution, ct);
    return Results.Ok(bundle);
});

workspaceApi.MapGet("/discovery", (EngineHost host, DiscoveryService discovery) =>
{
    var engine = host.Engine;
    if (engine is null) return Results.NotFound();
    var cached = discovery.ReadCached(engine.RootPath);
    return cached is null ? Results.NotFound() : Results.Ok(cached);
});

workspaceApi.MapGet("/discovery/metrics", (EngineHost host) =>
{
    var engine = host.Engine;
    if (engine is null) return Results.NotFound();
    var metrics = DiscoverySidecars.ReadMetrics(engine.RootPath);
    return metrics is null ? Results.NotFound() : Results.Ok(metrics);
});

workspaceApi.MapPost("/discovery/analyse-module", async (
    AnalyseModuleRequest req, EngineHost host, DiscoveryService discovery, AiBroker broker, CancellationToken ct) =>
{
    var engine = host.Engine;
    if (engine is null) return Results.BadRequest(new { error = "no workspace open" });
    var bundle = discovery.ReadCached(engine.RootPath);
    if (bundle is null) return Results.BadRequest(new { error = "run /discovery/run first" });
    var result = await broker.AnalyseModuleAsync(req, engine.Model, bundle, ct);
    return Results.Ok(result);
});

workspaceApi.MapGet("/discovery/ai-status", (AiBroker broker) =>
    Results.Ok(new { configured = broker.IsConfigured, transport = broker.TransportLabel }));

// ---------------- Epic 07 — Comments substrate ----------------

workspaceApi.MapGet("/comments", (EngineHost host) =>
{
    var engine = host.Engine;
    if (engine is null) return Results.NotFound();
    return Results.Ok(CommentsSidecar.Read(engine.RootPath));
});

workspaceApi.MapPut("/comments", async (CommentsSidecar sidecar, EngineHost host) =>
{
    var engine = host.Engine;
    if (engine is null) return Results.BadRequest(new { error = "no workspace open" });
    sidecar.Write(engine.RootPath);
    await Task.CompletedTask;
    return Results.NoContent();
});

workspaceApi.MapGet("/author", () =>
{
    // Best-effort resolution of the current author for new comment entries.
    string? FromGit(string key)
    {
        try
        {
            var psi = new System.Diagnostics.ProcessStartInfo("git", $"config {key}")
            {
                RedirectStandardOutput = true, UseShellExecute = false, CreateNoWindow = true,
            };
            using var p = System.Diagnostics.Process.Start(psi);
            if (p is null) return null;
            var s = p.StandardOutput.ReadToEnd().Trim();
            p.WaitForExit(500);
            return string.IsNullOrEmpty(s) ? null : s;
        }
        catch { return null; }
    }
    var author = FromGit("user.name")
                 ?? Environment.GetEnvironmentVariable("USER")
                 ?? Environment.GetEnvironmentVariable("USERNAME")
                 ?? "anonymous";
    return Results.Ok(new { author });
});

app.MapHub<WorkspaceHub>("/hubs/workspace");

app.MapFallbackToFile("index.html");

app.Run();

public sealed record OpenWorkspaceRequest(string RootPath);
public sealed record InitWorkspaceRequest(string RootPath, string? Name);

public sealed record BookPdfPageRequest(string ViewId, string Title, string Narrative, string? CapturePngBase64);
public sealed record BookPdfRequest(string Name, string? Audience, IReadOnlyList<BookPdfPageRequest> Pages);

public sealed record YamlConceptDto(string Id, string Kind, string Name, string? Layer, IReadOnlyDictionary<string, string?> Properties, IReadOnlyList<string> Aliases);
public sealed record YamlRelationDto(string Id, string Kind, string From, string To, IReadOnlyDictionary<string, string?> Properties);
public sealed record YamlBookPageDto(string ViewId, string Title, string Narrative);
public sealed record YamlBookDto(string Id, string Name, string? Audience, IReadOnlyList<YamlBookPageDto> Pages);
public sealed record YamlConceptsResponse(IReadOnlyList<YamlConceptDto> Concepts, IReadOnlyList<YamlRelationDto> Relations, IReadOnlyList<YamlBookDto> Books);

public partial class Program;
