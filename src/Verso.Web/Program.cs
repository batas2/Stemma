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
    var snapshot = await host.OpenAsync(req.RootPath, ct);
    return Results.Ok(snapshot);
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
