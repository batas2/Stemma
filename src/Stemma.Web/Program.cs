using System.Text.Json;
using System.Text.Json.Serialization;
using Stemma.Engine.Adapters.Yaml;
using Stemma.Engine.ArchModel;
using Stemma.Engine.Workspace;
using Stemma.Web.Hubs;
using Stemma.Web.Services;

var builder = WebApplication.CreateBuilder(args);

builder.Services.AddSingleton<EngineHost>();
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

    // A model-only folder is openable too — it needs no project file at all (ADR-0016).
    if (ModelWorkspaceLoader.DetectKind(resolved) == WorkspaceKind.None)
        return Results.BadRequest(new
        {
            error = $"Nothing to open in {resolved}. Expected a .sln, a .csproj, " +
                    "or an Architecture/ folder containing the model."
        });

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
    // Name is enough: a model created by name lands in ~/stemma/<name>, so nobody has to type a
    // filesystem path to start. An explicit rootPath still wins when one is given.
    var name = (req.Name ?? "").Trim();
    if (string.IsNullOrWhiteSpace(name) && !string.IsNullOrWhiteSpace(req.RootPath))
        name = Path.GetFileName(Path.GetFullPath(req.RootPath).TrimEnd('/', '\\'));
    if (string.IsNullOrWhiteSpace(name))
        return Results.BadRequest(new { error = "A model name is required" });

    try
    {
        var created = await WorkspaceScaffold.CreateAsync(name, req.RootPath, ct);
        var snapshot = await host.OpenAsync(created.RootPath, ct);
        return Results.Ok(new
        {
            snapshot.RootPath,
            snapshot.Projects,
            gitInitialised = created.GitInitialised,
            gitError = created.GitError,
        });
    }
    catch (Exception ex)
    {
        return Results.BadRequest(new { error = ex.Message });
    }
});

// Lets the client show where a new model will live without asking the user to know or type it.
workspaceApi.MapGet("/default-root", (string? name) => Results.Ok(new
{
    root = WorkspaceScaffold.DefaultRoot,
    path = string.IsNullOrWhiteSpace(name) ? WorkspaceScaffold.DefaultRoot : WorkspaceScaffold.PathFor(name!),
}));


workspaceApi.MapGet("/arch", async (EngineHost host, CancellationToken ct) =>
{
    var arch = await host.ReadArchAsync(ct);
    return arch is null ? Results.NotFound() : Results.Ok(arch);
});

// View Books live in `Concepts/view-book.stemma.yaml`. The Books panel + book-mode footer
// read this surface; each book page references a built-in view by id.
workspaceApi.MapGet("/books", (EngineHost host) =>
{
    var engine = host.Engine;
    if (engine is null) return Results.NotFound();
    var adapter = YamlAdapter.Load(engine.RootPath);
    var books = adapter.AllBooks.Select(b => new YamlBookDto(
        b.Id, b.Name, b.Audience,
        b.Pages.Select(p => new YamlBookPageDto(p.ViewId, p.Title, p.Narrative)).ToArray())).ToArray();
    return Results.Ok(books);
});

workspaceApi.MapGet("/export/mermaid", async (string view, EngineHost host, CancellationToken ct) =>
{
    var arch = await host.ReadArchAsync(ct);
    if (arch is null) return Results.NotFound();
    var viewKind = view switch
    {
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

// ---------------- Comments substrate ----------------

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

public sealed record YamlBookPageDto(string ViewId, string Title, string Narrative);
public sealed record YamlBookDto(string Id, string Name, string? Audience, IReadOnlyList<YamlBookPageDto> Pages);

public partial class Program;
