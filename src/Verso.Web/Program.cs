using System.Text.Json;
using System.Text.Json.Serialization;
using Verso.Engine.ArchModel;
using Verso.Web.Hubs;
using Verso.Web.Services;

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

app.MapHub<WorkspaceHub>("/hubs/workspace");

app.MapFallbackToFile("index.html");

app.Run();

public sealed record OpenWorkspaceRequest(string RootPath);
public sealed record InitWorkspaceRequest(string RootPath, string? Name);

public partial class Program;
