using System.Net;
using System.Net.Http.Json;
using FluentAssertions;
using Microsoft.AspNetCore.Builder;
using Stemma.Web;
using Xunit;

namespace Stemma.Web.Tests;

/// <summary>
/// The canvas reads stemma.layout.json with GET and writes it with PATCH: a list of changes, applied
/// to the file as it is on disk (ADR-0021). The whole-file PUT is gone — it wrote the session's copy
/// over the file, re-serialized, which was B-014.
/// </summary>
public sealed class LayoutEndpointTests : IAsyncLifetime
{
    private readonly string _root = Path.Combine(Path.GetTempPath(), $"stemma-layoutapi-{Guid.NewGuid():N}");
    private WebApplication _app = null!;
    private HttpClient _http = null!;

    // Written by hand: a key Stemma does not know, a number spelled 10.50, an array on one line.
    private const string Sidecar = """
        {
          "version": 1,
          "views": {
            "moduleMap": {
              "nodes": {
                "ctx_a": { "x": 10.50, "y": 20 }
              },
              "gap": [90, 70]
            }
          },
          "palettes": { "ink": "#222" }
        }

        """;

    static LayoutEndpointTests() => Environment.SetEnvironmentVariable("STEMMA_LOG_FILE", "off");

    private string File_ => Path.Combine(_root, "stemma.layout.json");

    public async Task InitializeAsync()
    {
        _app = StemmaWebHost.Build(["--urls", StemmaWebHost.DynamicLoopbackUrl, "--log-level", "none"]);
        await _app.StartAsync();
        _http = new HttpClient { BaseAddress = new Uri(StemmaWebHost.BoundUrl(_app)), Timeout = TimeSpan.FromMinutes(2) };
        var created = await _http.PostAsJsonAsync("/api/workspace/init", new { rootPath = _root, name = "Layout" });
        created.StatusCode.Should().Be(HttpStatusCode.OK);
        await File.WriteAllTextAsync(File_, Sidecar);
    }

    public async Task DisposeAsync()
    {
        _http.Dispose();
        await _app.StopAsync();
        await _app.DisposeAsync();
        try { Directory.Delete(_root, recursive: true); } catch (IOException) { } catch (UnauthorizedAccessException) { }
    }

    private Task<HttpResponseMessage> PatchAsync(object body) =>
        _http.PatchAsync("/api/workspace/layout", JsonContent.Create(body));

    [Fact]
    public async Task Get_returns_the_file_as_it_is()
    {
        (await _http.GetStringAsync("/api/workspace/layout")).Should().Be(Sidecar);
    }

    [Fact]
    public async Task Patch_changes_what_it_names_and_leaves_every_other_byte()
    {
        var response = await PatchAsync(new
        {
            changes = new object[]
            {
                new { path = new[] { "views", "moduleMap", "nodes", "ctx_a", "y" }, value = 42 },
                new { path = new[] { "palettes", "ink" }, remove = true },
            },
        });

        response.StatusCode.Should().Be(HttpStatusCode.NoContent);
        (await File.ReadAllTextAsync(File_)).Should().Be(Sidecar
            .Replace("\"y\": 20", "\"y\": 42")
            .Replace("\"palettes\": { \"ink\": \"#222\" }", "\"palettes\": {}"));
    }

    [Fact]
    public async Task A_sidecar_that_cannot_be_read_is_refused_by_both_and_left_alone()
    {
        const string conflicted = "{\n<<<<<<< HEAD\n  \"version\": 1\n=======\n  \"version\": 2\n>>>>>>> theirs\n}\n";
        await File.WriteAllTextAsync(File_, conflicted);

        var read = await _http.GetAsync("/api/workspace/layout");
        read.StatusCode.Should().Be(HttpStatusCode.Conflict);
        (await read.Content.ReadAsStringAsync()).Should().Contain("UnreadableSidecar");

        var write = await PatchAsync(new { changes = new[] { new { path = new[] { "version" }, value = 1 } } });
        write.StatusCode.Should().Be(HttpStatusCode.Conflict);
        (await File.ReadAllTextAsync(File_)).Should().Be(conflicted);
    }

    [Fact]
    public async Task The_whole_file_can_no_longer_be_put()
    {
        var put = await _http.PutAsJsonAsync("/api/workspace/layout", new { version = 1 });
        put.StatusCode.Should().Be(HttpStatusCode.MethodNotAllowed);
        (await File.ReadAllTextAsync(File_)).Should().Be(Sidecar);
    }
}
