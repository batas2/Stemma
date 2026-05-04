using System.Text.Json;
using System.Text.Json.Serialization;
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

app.MapHub<WorkspaceHub>("/hubs/workspace");

app.MapFallbackToFile("index.html");

app.Run();

public sealed record OpenWorkspaceRequest(string RootPath);

public partial class Program;
