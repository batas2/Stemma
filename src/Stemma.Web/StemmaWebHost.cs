using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.AspNetCore.Hosting.Server;
using Microsoft.AspNetCore.Hosting.Server.Features;
using Stemma.Engine.Adapters.Yaml;
using Stemma.Engine.ArchModel;
using Stemma.Engine.Operations;
using Stemma.Engine.Workspace;
using Serilog;
using Stemma.Web.Diagnostics;
using Stemma.Web.Hubs;
using Stemma.Web.Services;

namespace Stemma.Web;

/// <summary>
/// The Stemma backend as something that can be <em>hosted</em>, not only run.
///
/// It used to be a file of top-level statements, which is right up until a second thing wants to
/// start it. The desktop shell (ADR-0017) is one .NET process holding both Kestrel and the window,
/// so it needs the application object rather than a process — it has to know the bound address
/// before it can navigate to it, and it has to stop the server when the window closes. Everything
/// here is the same host <c>Program.cs</c> always built; the only thing that changed is who may
/// call it.
/// </summary>
public static class StemmaWebHost
{
    /// <summary>
    /// Loopback on a port the OS picks. Binding <c>:0</c> and reading the assignment back is what
    /// lets two Stemma windows exist at once; the alternative — a fixed port plus the stale-process
    /// reclaim <c>run.sh</c> used to carry — fails whenever the first instance is still alive, which
    /// is exactly the case a desktop app has to handle.
    /// </summary>
    public const string DynamicLoopbackUrl = "http://127.0.0.1:0";

    /// <summary>Config key (and environment variable) naming a file to write the bound URL into.</summary>
    private const string PortFileKey = "port-file";
    private const string PortFileEnvironmentVariable = "STEMMA_PORT_FILE";

    /// <summary>
    /// Build the application. Nothing is bound yet: call <see cref="RunAsync"/>, or start it
    /// yourself and read <see cref="BoundUrl"/>.
    /// </summary>
    public static WebApplication Build(string[] args)
    {
        var builder = WebApplication.CreateBuilder(args);

        // Diagnostics first, so anything that fails during startup is already observable. One factory per
        // process, owned by the host and disposed on shutdown: disposing early makes later records vanish
        // silently, and never disposing drops buffered ones (ADR-0020).
        var logOptions = StemmaLogging.Resolve(builder.Configuration, args);
        // The level switch is what makes a runtime level change work without a restart — every sink follows it.
        var levelSwitch = new Serilog.Core.LoggingLevelSwitch();
        var serilog = StemmaLogging.Build(logOptions, levelSwitch);
        builder.Logging.ClearProviders();
        builder.Logging.AddSerilog(serilog, dispose: true);
        builder.Services.AddSingleton(levelSwitch);
        builder.Services.AddSingleton(logOptions);

        builder.Services.AddSingleton<EngineHost>();
        builder.Services.AddSignalR().AddJsonProtocol(o =>
        {
            o.PayloadSerializerOptions.PropertyNamingPolicy = JsonNamingPolicy.CamelCase;
            o.PayloadSerializerOptions.Converters.Add(new JsonStringEnumConverter(JsonNamingPolicy.CamelCase));
        });
        // CORS exists for one reason: in development the Vite server is a different origin from the
        // API. The fixed allow-list that encoded stopped being true the moment the desktop shell
        // served the app from a loopback port the OS picked — the page's own origin was refused on
        // every request. Harmless to a same-origin fetch, and one "CORS policy execution failed"
        // record per asset, which buries the log the shell points the user at when something is
        // genuinely wrong. Kestrel only ever binds loopback here, so an origin that can reach it is
        // already running on this machine and gains nothing from being refused.
        builder.Services.AddCors(o => o.AddDefaultPolicy(p => p
            .SetIsOriginAllowed(IsLocalOrigin)
            .AllowAnyHeader().AllowAnyMethod().AllowCredentials()));
        builder.Services.ConfigureHttpJsonOptions(o =>
        {
            o.SerializerOptions.PropertyNamingPolicy = JsonNamingPolicy.CamelCase;
            o.SerializerOptions.Converters.Add(new JsonStringEnumConverter(JsonNamingPolicy.CamelCase));
        });

        var app = builder.Build();

        app.UseCors();
        // Before anything that logs, so every downstream record inherits the correlation scope.
        app.UseMiddleware<CorrelationMiddleware>();

        // An unhandled failure reaches the client as a bare 500 and leaves nothing behind. The record is
        // what makes the report the user files actionable.
        app.Use(async (context, next) =>
        {
            try
            {
                await next();
            }
            catch (Exception e)
            {
                WebLog.RequestFailed(
                    context.RequestServices.GetRequiredService<ILoggerFactory>().CreateLogger("Stemma.Web.Api"),
                    context.Request.Method, context.Request.Path.Value ?? "", e);
                throw;
            }
        });
        app.UseDefaultFiles();
        app.UseStaticFiles();

        MapWorkspaceApi(app);
        MapDiagnosticsApi(app);

        app.MapHub<WorkspaceHub>("/hubs/workspace");

        app.MapFallbackToFile("index.html");

        return app;
    }

    /// <summary>
    /// Start the application, publish where it landed, and block until it is asked to stop. This is
    /// what <c>Program.cs</c> runs; the desktop shell drives the same object by hand instead.
    /// </summary>
    public static async Task RunAsync(WebApplication app, CancellationToken ct = default)
    {
        await app.StartAsync(ct);
        var portFile = PortFile(app.Configuration);
        try
        {
            if (portFile is not null) WritePortFile(portFile, BoundUrl(app));
            await app.WaitForShutdownAsync(ct);
        }
        finally
        {
            // A port file that outlives its server sends the next launcher at a dead port, which
            // presents as a hang rather than as "nothing is running".
            if (portFile is not null) TryDelete(portFile);
        }
    }

    /// <summary>
    /// The address Kestrel actually bound, navigable as-is. Only meaningful once the server has
    /// started — which is the whole point of asking it rather than asking configuration.
    /// </summary>
    public static string BoundUrl(WebApplication app)
    {
        var addresses = app.Services.GetRequiredService<IServer>().Features.Get<IServerAddressesFeature>()?.Addresses;
        var address = addresses?.FirstOrDefault()
            ?? throw new InvalidOperationException("the host reported no bound address; it has not started");

        // A wildcard binding is a fine thing to serve on and a useless thing to navigate to.
        return address.Replace("://0.0.0.0", "://127.0.0.1").Replace("://[::]", "://127.0.0.1");
    }

    /// <summary>
    /// An origin on this machine — <c>localhost</c>, <c>127.0.0.1</c> or <c>::1</c>, on any port.
    /// The port is unknowable in advance now that it is the OS's to choose.
    /// </summary>
    public static bool IsLocalOrigin(string origin) =>
        Uri.TryCreate(origin, UriKind.Absolute, out var uri) && uri.IsLoopback;

    /// <summary>
    /// Where the built front end is.
    ///
    /// `wwwroot` is what Vite writes into the <em>web project's</em> directory, and it is never
    /// copied to build output — so a host started from anywhere else serves the API happily and
    /// 404s the page. That failure surfaces as a blank window several layers from its cause, which
    /// is why every non-default launcher resolves this explicitly instead of trusting the default.
    ///
    /// Two layouts exist and both are checked, walking up from <paramref name="startDirectory"/>:
    /// published (everything in one folder) and this repository (<c>src/Stemma.Web/</c>).
    /// </summary>
    public static string? FindContentRoot(string? startDirectory = null)
    {
        for (var dir = new DirectoryInfo(startDirectory ?? AppContext.BaseDirectory); dir is not null; dir = dir.Parent)
        {
            if (HasFrontEnd(dir.FullName)) return dir.FullName;

            var webProject = Path.Combine(dir.FullName, "src", "Stemma.Web");
            if (HasFrontEnd(webProject)) return webProject;
        }
        return null;
    }

    /// <summary>The bundle, not merely the folder: an empty `wwwroot` survives a failed build.</summary>
    private static bool HasFrontEnd(string directory) =>
        File.Exists(Path.Combine(directory, "wwwroot", "index.html"));

    private static string? PortFile(IConfiguration config)
    {
        var path = config[PortFileKey];
        if (string.IsNullOrWhiteSpace(path)) path = Environment.GetEnvironmentVariable(PortFileEnvironmentVariable);
        return string.IsNullOrWhiteSpace(path) ? null : Path.GetFullPath(path);
    }

    private static void WritePortFile(string path, string url)
    {
        try
        {
            var directory = Path.GetDirectoryName(path);
            if (!string.IsNullOrEmpty(directory)) Directory.CreateDirectory(directory);
            File.WriteAllText(path, url);
        }
        catch (IOException)
        {
            // The server is up and serving; a launcher that cannot be told where is a worse outcome
            // than a launcher that has to look, but it is not a reason to refuse to run.
        }
        catch (UnauthorizedAccessException) { }
    }

    private static void TryDelete(string path)
    {
        try { File.Delete(path); }
        catch (IOException) { }
        catch (UnauthorizedAccessException) { }
    }

    // ---------------- Workspace ----------------

    private static void MapWorkspaceApi(WebApplication app)
    {
        var workspaceApi = app.MapGroup("/api/workspace");

        workspaceApi.MapPost("/open", async (OpenWorkspaceRequest req, EngineHost host, ILoggerFactory logs, CancellationToken ct) =>
        {
            WebLog.WorkspaceOpenRequested(logs.CreateLogger("Stemma.Web.Api"), WorkspaceIdentity.For(req.RootPath));
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
        // What an edit actually wrote. The canvas shows this after someone's first element, which is
        // the cheapest possible demonstration of the whole premise — the box you drew is four lines
        // of C# you can read (F-003 AC7). Served as the file's own text, never as a rendering of the
        // model, because a reconstruction that happened to be right would still be a claim.
        workspaceApi.MapGet("/source/{id}", async (string id, EngineHost host, CancellationToken ct) =>
        {
            var engine = host.Engine;
            if (engine is null) return Results.NotFound();
            var declaration = await engine.ReadDeclarationAsync(id, ct);
            return declaration is null ? Results.NotFound() : Results.Ok(declaration);
        });

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

        // The escape hatch to a mature editor. It used to emit the whole model on a fixed grid regardless
        // of what was on screen, which meant the result had to be rebuilt by hand — the opposite of an
        // escape hatch. It now honours the active view and the committed layout.
        workspaceApi.MapGet("/export/drawio", async (string? view, string? palette, bool? labelKinds, EngineHost host, ILoggerFactory logs, CancellationToken ct) =>
        {
            var arch = await host.ReadArchAsync(ct);
            if (arch is null) return Results.NotFound();
            var engine = host.Engine;

            IReadOnlyCollection<string>? elementIds = null;
            var layoutKey = "moduleMap";
            if (!string.IsNullOrWhiteSpace(view) && engine is not null)
            {
                var views = await ReadViewsAsync(engine.RootPath, ct);
                var match = views.FirstOrDefault(v => v.Id == view || v.Name == view);
                if (match is not null)
                {
                    elementIds = match.ElementIds.ToHashSet(StringComparer.Ordinal);
                    layoutKey = $"custom:{match.Id}";
                }
                else
                {
                    layoutKey = view;
                }
            }

            var positions = engine is null ? null : ReadPositions(engine.RootPath, layoutKey);

            var xml = DrawioExporter.Export(arch, new DrawioExporter.Options
            {
                Positions = positions,
                ElementIds = elementIds,
                Palette = DrawioPalette.Resolve(palette),
                LabelKinds = labelKinds ?? false,
                DiagramName = view ?? "Stemma",
            });
            WebLog.ExportProduced(logs.CreateLogger("Stemma.Web.Export"), "drawio", xml.Length);
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

        // Both go through the engine, so a view file is edited in place, compile-gated, and found by
        // the id it declares — never rewritten from a template or picked out by a text search (B-010).
        workspaceApi.MapPut("/views", async (ArchView view, EngineHost host, CancellationToken ct) =>
        {
            var engine = host.Engine;
            if (engine is null) return Results.BadRequest(new { error = "no workspace open" });
            var result = await engine.SaveViewAsync($"view_{Guid.NewGuid():N}", view, ct);
            return result is OperationFailed f
                ? Results.Conflict(new { reason = f.Reason, message = f.Message })
                : Results.NoContent();
        });

        workspaceApi.MapDelete("/views/{viewId}", async (string viewId, EngineHost host, CancellationToken ct) =>
        {
            var engine = host.Engine;
            if (engine is null) return Results.BadRequest(new { error = "no workspace open" });
            var result = await engine.RemoveViewAsync($"view_{Guid.NewGuid():N}", viewId, ct);
            return result switch
            {
                OperationFailed { Reason: "ViewNotFound" } => Results.NotFound(),
                OperationFailed f => Results.Conflict(new { reason = f.Reason, message = f.Message }),
                _ => Results.NoContent(),
            };
        });

        workspaceApi.MapGet("/recents", () => Results.Ok(RecentWorkspaces.Load()));

        workspaceApi.MapGet("/violations", async (EngineHost host, CancellationToken ct) =>
        {
            var engine = host.Engine;
            if (engine is null) return Results.NotFound();
            var violations = await engine.RunValidationAsync(ct);
            return Results.Ok(violations);
        });

        // The file as it is, not the C# type's reading of it: the canvas sees what the file says,
        // keys it does not model included. One that does not parse is refused rather than read as
        // empty, since the canvas would then write that emptiness back (ADR-0021).
        workspaceApi.MapGet("/layout", (EngineHost host) =>
        {
            var engine = host.Engine;
            if (engine is null) return Results.NotFound();
            var path = LayoutSidecar.PathFor(engine.RootPath);
            if (!File.Exists(path)) return Results.Text("{\n  \"version\": 1,\n  \"views\": {}\n}\n", "application/json");
            var text = File.ReadAllText(path);
            try
            {
                using var doc = JsonDocument.Parse(text);
                if (doc.RootElement.ValueKind != JsonValueKind.Object) throw new JsonException("not an object");
            }
            catch (JsonException e)
            {
                return Results.Conflict(new { reason = "UnreadableSidecar", message = $"stemma.layout.json cannot be read: {e.Message}" });
            }
            return Results.Text(text, "application/json");
        });

        // Changes, applied to the file as it is on disk — never the canvas's copy of the whole file,
        // which wrote over whatever anyone else had changed since it was read (B-014, ADR-0021).
        workspaceApi.MapPatch("/layout", async (LayoutPatch patch, EngineHost host, ILoggerFactory logs, CancellationToken ct) =>
        {
            var engine = host.Engine;
            if (engine is null) return Results.BadRequest(new { error = "no workspace open" });
            if (patch.Changes.Any(c => c.Path.Length == 0 || (!c.Remove && c.Value is null)))
                return Results.BadRequest(new { error = "every change needs a path, and a value or remove: true" });
            var changes = patch.Changes.Select(c => new SidecarChange(c.Path, c.Remove ? null : c.Value)).ToList();
            try
            {
                var result = await engine.PatchSidecarAsync($"layout_{Guid.NewGuid():N}", changes, ct);
                return result is OperationFailed f
                    ? Results.Conflict(new { reason = f.Reason, message = f.Message })
                    : Results.NoContent();
            }
            catch (IOException e)
            {
                // The edit stands on the canvas but not on disk, and the canvas sends it again with the
                // next change; reported so a full disk or a lock is not invisible.
                WebLog.SidecarWriteFailed(logs.CreateLogger("Stemma.Web.Api"), e);
                return Results.Problem("The layout could not be saved.");
            }
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
    }

    // ---------------- Diagnostics ----------------
    // Deliberately outside /api/workspace: the log matters most when opening one has failed.

    private static void MapDiagnosticsApi(WebApplication app)
    {
        var diagnosticsApi = app.MapGroup("/api/diagnostics");

        diagnosticsApi.MapGet("/", (StemmaLogging.Options options, Serilog.Core.LoggingLevelSwitch levelSwitch) => Results.Ok(new
        {
            level = levelSwitch.MinimumLevel.ToString(),
            format = options.Format,
            fileSink = options.FileSink,
            // The desktop shell names this in its launch-failure surface, which is why it is served even
            // when nothing else works.
            logDirectory = options.Directory,
            logFilePattern = StemmaLogging.LogFilePattern,
        }));

        // AC2 — a level change takes effect without a restart. Every sink follows the switch.
        diagnosticsApi.MapPut("/level", (SetLevelRequest req, Serilog.Core.LoggingLevelSwitch levelSwitch, ILoggerFactory factory) =>
        {
            levelSwitch.MinimumLevel = StemmaLogging.ParseLevel(req.Level);
            WebLog.LevelChanged(factory.CreateLogger("Stemma.Web.Api"), levelSwitch.MinimumLevel.ToString());
            return Results.Ok(new { level = levelSwitch.MinimumLevel.ToString() });
        });

        // AC9 — redacted by default. `includeModelContent` is an explicit opt-in and is never the default,
        // because the consequence is disclosing the user's architecture.
        diagnosticsApi.MapGet("/bundle", (bool? includeModelContent, StemmaLogging.Options options, EngineHost host) =>
        {
            var environment = new Dictionary<string, string>
            {
                ["os"] = Environment.OSVersion.ToString(),
                ["dotnet"] = Environment.Version.ToString(),
                ["processors"] = Environment.ProcessorCount.ToString(),
                ["workspaceId"] = WorkspaceIdentity.For(host.Engine?.RootPath),
                ["workspaceOpen"] = (host.Engine is not null).ToString(),
            };
            var json = DiagnosticsBundle.Build(options.Directory,
                new DiagnosticsBundle.Options(includeModelContent ?? false), environment);
            return Results.Text(json, "application/json");
        });
    }

    // ---------------- Helpers ----------------

    private static async Task<IReadOnlyList<ArchView>> ReadViewsAsync(string root, CancellationToken ct)
    {
        var viewsDir = Path.Combine(root, "Views");
        if (!Directory.Exists(viewsDir)) return [];
        var docs = new List<(string, Microsoft.CodeAnalysis.SyntaxNode)>();
        foreach (var path in Directory.EnumerateFiles(viewsDir, "*.cs", SearchOption.TopDirectoryOnly))
        {
            var content = await File.ReadAllTextAsync(path, ct);
            docs.Add((path, Microsoft.CodeAnalysis.CSharp.CSharpSyntaxTree.ParseText(content).GetRoot()));
        }
        return ViewsAdapter.ReadAllFrom(docs);
    }

    // Positions live in the committed sidecar under the view's key. Read straight off it rather than
    // through the typed model, so a view laid out by a constraint exports where it actually sits.
    private static Dictionary<string, (double X, double Y)>? ReadPositions(string root, string viewKey)
    {
        var sidecar = LayoutSidecar.Read(root);
        if (!sidecar.Views.TryGetValue(viewKey, out var layout)) return null;
        return layout.Nodes.ToDictionary(kv => kv.Key, kv => (kv.Value.X, kv.Value.Y), StringComparer.Ordinal);
    }
}

/// <summary>The body of <c>PATCH /api/workspace/layout</c>: each change sets the value at a path of keys, or removes it.</summary>
internal sealed record LayoutPatch(List<LayoutPatch.Change> Changes)
{
    internal sealed record Change(string[] Path, JsonElement? Value, bool Remove);
}
