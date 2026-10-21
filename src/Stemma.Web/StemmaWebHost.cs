using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.AspNetCore.Hosting.Server;
using Microsoft.AspNetCore.Hosting.Server.Features;
using Stemma.Engine.ArchModel;
using Stemma.Engine.Diagnostics;
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
            .SetIsOriginAllowed(IsDevOrigin)
            .AllowAnyHeader().AllowAnyMethod().AllowCredentials()));
        // A server on loopback is still reachable from any page the user's browser opens, by a name that
        // resolves to 127.0.0.1 (DNS rebinding): that page is then "same origin" and the whole API is
        // its. Only requests addressed to a loopback name are answered. Set here rather than in
        // appsettings.json, which not every package ships.
        builder.Services.Configure<Microsoft.AspNetCore.HostFiltering.HostFilteringOptions>(o =>
        {
            o.AllowedHosts = ["localhost", "127.0.0.1", "[::1]"];
            o.AllowEmptyHosts = false;
        });
        builder.Services.ConfigureHttpJsonOptions(o =>
        {
            o.SerializerOptions.PropertyNamingPolicy = JsonNamingPolicy.CamelCase;
            o.SerializerOptions.Converters.Add(new JsonStringEnumConverter(JsonNamingPolicy.CamelCase));
        });

        var app = builder.Build();

        app.UseHostFiltering();
        // CORS does not cover a WebSocket, nor a "simple" cross-site POST: a page anywhere could open the
        // hub and apply operations, or close the workspace. A browser always says where a request comes
        // from, so a request that names an origin must name this server's own (or the dev server's).
        // One with no Origin is not from a page — the tests, the CLI — and a page cannot leave it out.
        app.Use(async (context, next) =>
        {
            var path = context.Request.Path;
            if ((path.StartsWithSegments("/api") || path.StartsWithSegments("/hubs"))
                && context.Request.Headers.Origin is { Count: > 0 } origin
                && !IsAllowedOrigin(origin.ToString(), context.Request.Host))
            {
                context.Response.StatusCode = StatusCodes.Status403Forbidden;
                return;
            }
            await next();
        });
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

    /// <summary>The Vite dev server, the one other origin that serves this app (development only).</summary>
    public static bool IsDevOrigin(string origin) =>
        Uri.TryCreate(origin, UriKind.Absolute, out var uri) && uri.IsLoopback && uri.Scheme == Uri.UriSchemeHttp && uri.Port == 5173;

    /// <summary>
    /// Whether a request naming <paramref name="origin"/> may use the API: this server's own page (its
    /// origin is the host the request was addressed to) or the dev server. Any other site — or another
    /// local web app — may not.
    /// </summary>
    public static bool IsAllowedOrigin(string origin, HostString host)
    {
        if (!Uri.TryCreate(origin, UriKind.Absolute, out var uri)) return false;
        var own = uri.IsDefaultPort ? uri.Host : $"{uri.Host}:{uri.Port}";
        return (host.HasValue && string.Equals(own, host.Value, StringComparison.OrdinalIgnoreCase)
                && (uri.Scheme == Uri.UriSchemeHttp || uri.Scheme == Uri.UriSchemeHttps))
            || IsDevOrigin(origin);
    }

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

        // What the model was (F-017, ADR-0024): read from Git on demand, kept nowhere. The history is
        // what a person can compare with; arch-at is the model and its sidecar at one of those points.
        workspaceApi.MapGet("/history", async (EngineHost host, CancellationToken ct) =>
        {
            var root = host.Snapshot()?.RootPath;
            if (root is null) return Results.NotFound();
            return Results.Ok(await GitHistory.ReadAsync(root, ct));
        });

        workspaceApi.MapGet("/arch-at", async (string? rev, EngineHost host, CancellationToken ct) =>
        {
            var root = host.Snapshot()?.RootPath;
            if (root is null) return Results.NotFound();
            try
            {
                return Results.Ok(await GitHistory.ModelAtAsync(root, rev ?? "", ct));
            }
            catch (GitHistory.RevisionNotFound e)
            {
                return Results.Problem(e.Message, statusCode: StatusCodes.Status404NotFound);
            }
        });

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

        // A book's PDF is the deck (F-013 AC10). The client sends each page as it was presented, and
        // the server lays the pages out. A capture that is not base64 is a page without its picture,
        // not a failed export; a request too big to be a book is refused before anything is drawn.
        workspaceApi.MapPost("/export/book-pdf", (BookPdfRequest req) =>
        {
            var requested = req.Pages ?? [];
            if (requested.Count > BookPdfExporter.MaxPages)
                return Results.BadRequest(new { error = $"A book's PDF holds at most {BookPdfExporter.MaxPages} pages; this one has {requested.Count}." });

            var pages = new List<BookPdfExporter.PdfBookPage>(requested.Count);
            foreach (var p in requested)
            {
                if (p is null) continue;
                var capture = BookPdfExporter.ReadCapture(p.CapturePngBase64);
                if (capture is { Length: > BookPdfExporter.MaxCaptureBytes })
                    return Results.BadRequest(new { error = $"The picture of page {pages.Count + 1} is over {BookPdfExporter.MaxCaptureBytes / (1024 * 1024)} MB." });
                pages.Add(new BookPdfExporter.PdfBookPage(p.Title ?? "", p.Narrative ?? "", capture));
            }

            var name = string.IsNullOrWhiteSpace(req.Name) ? "Book" : req.Name;
            var bytes = BookPdfExporter.Render(new BookPdfExporter.PdfBook(name, req.Audience, DateTimeOffset.UtcNow, pages));
            var safeName = string.Concat(name.Where(c => char.IsLetterOrDigit(c) || c is '-' or '_'));
            if (string.IsNullOrEmpty(safeName)) safeName = "book";
            return Results.File(bytes, "application/pdf", $"{safeName}.pdf");
        }).WithMetadata(new Microsoft.AspNetCore.Mvc.RequestSizeLimitAttribute(BookPdfExporter.MaxRequestBytes));

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
            // Read by the same reader that writes it, so the two cannot disagree about what is readable.
            try { SidecarPatch.Apply(text, []); }
            catch (SidecarPatchRefusedException e) { return Results.Conflict(new { reason = e.Reason, message = e.Message }); }
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

        // ---------------- Comments ----------------
        // The file as it is, like the layout's: the panel shows what the file says. One that does not
        // parse is refused rather than read as no comments, which the next one posted was then written
        // over (B-018).

        workspaceApi.MapGet("/comments", (EngineHost host) =>
        {
            var engine = host.Engine;
            if (engine is null) return Results.NotFound();
            var path = CommentsSidecar.PathFor(engine.RootPath);
            if (!File.Exists(path)) return Results.Text(CommentsSidecar.Empty, "application/json");
            var text = File.ReadAllText(path);
            try { CommentsPatch.Apply(text, []); }
            catch (SidecarPatchRefusedException e) { return Results.Conflict(new { reason = e.Reason, message = e.Message }); }
            return Results.Text(text, "application/json");
        });

        // Changes, each naming its comment by id, applied to the file as it is on disk — never the
        // panel's copy of the whole file, which wrote over every comment that arrived after it was
        // read. The answer is the file as it now is, so the panel shows the others' comments too.
        workspaceApi.MapPatch("/comments", async (CommentChanges request, EngineHost host, ILoggerFactory logs, CancellationToken ct) =>
        {
            var engine = host.Engine;
            if (engine is null) return Results.BadRequest(new { error = "no workspace open" });
            var changes = new List<CommentChange>();
            foreach (var c in request.Changes)
            {
                CommentChange? change = c.Op switch
                {
                    "add" when c.Comment is { } comment => new CommentChange.Add(comment),
                    "reply" when c.Id is { Length: > 0 } id && c.Reply is { } reply => new CommentChange.AddReply(id, reply),
                    "resolve" when c.Id is { Length: > 0 } id && c.Resolved is { } resolved => new CommentChange.SetResolved(id, resolved),
                    "remove" when c.Id is { Length: > 0 } id => new CommentChange.Remove(id),
                    _ => null,
                };
                if (change is null)
                    return Results.BadRequest(new { error = "each change is add with a comment, reply with an id and a reply, resolve with an id and resolved, or remove with an id" });
                changes.Add(change);
            }
            try
            {
                var result = await engine.PatchCommentsAsync($"comments_{Guid.NewGuid():N}", changes, ct);
                if (result is OperationFailed f) return Results.Conflict(new { reason = f.Reason, message = f.Message });
                var path = CommentsSidecar.PathFor(engine.RootPath);
                return Results.Text(File.Exists(path) ? await File.ReadAllTextAsync(path, ct) : CommentsSidecar.Empty, "application/json");
            }
            catch (IOException e)
            {
                WebLog.SidecarWriteFailed(logs.CreateLogger("Stemma.Web.Api"), e);
                return Results.Problem("The comments could not be saved.");
            }
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
            version = StemmaVersion.Release,
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
                // The release and the commit: the first thing anyone reading the bundle asks.
                ["stemma"] = StemmaVersion.Build,
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

/// <summary>
/// The body of <c>PATCH /api/workspace/comments</c>: each change adds a comment, replies to one,
/// resolves one or removes one, naming it by id.
/// </summary>
internal sealed record CommentChanges(List<CommentChanges.Change> Changes)
{
    internal sealed record Change(string? Op, string? Id, JsonElement? Comment, JsonElement? Reply, bool? Resolved);
}
