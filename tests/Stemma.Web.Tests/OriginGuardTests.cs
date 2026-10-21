using System.Net;
using System.Net.Http.Json;
using FluentAssertions;
using Microsoft.AspNetCore.Builder;
using Stemma.Web;
using Xunit;

namespace Stemma.Web.Tests;

/// <summary>
/// The local server answers only its own page. It binds loopback, but any page the user's browser
/// opens can still reach it: through the hub (CORS does not cover a WebSocket), with a "simple"
/// cross-site POST (CORS does not stop it being sent), or by a name that resolves to 127.0.0.1 (DNS
/// rebinding, after which the page is "same origin"). Each of those once let a stranger's page edit the
/// model or write files; each is refused here as such a page would try it.
/// </summary>
public sealed class OriginGuardTests : IAsyncLifetime
{
    private readonly string _root = Path.Combine(Path.GetTempPath(), $"stemma-origin-{Guid.NewGuid():N}");
    private WebApplication _app = null!;
    private HttpClient _http = null!;
    private string _base = null!;

    static OriginGuardTests() => Environment.SetEnvironmentVariable("STEMMA_LOG_FILE", "off");

    public async Task InitializeAsync()
    {
        _app = StemmaWebHost.Build(["--urls", StemmaWebHost.DynamicLoopbackUrl, "--log-level", "none"]);
        await _app.StartAsync();
        _base = StemmaWebHost.BoundUrl(_app);
        _http = new HttpClient { BaseAddress = new Uri(_base), Timeout = TimeSpan.FromMinutes(2) };
        (await _http.PostAsJsonAsync("/api/workspace/init", new { rootPath = _root, name = "Guarded" }))
            .StatusCode.Should().Be(HttpStatusCode.OK);
    }

    public async Task DisposeAsync()
    {
        _http.Dispose();
        await _app.StopAsync();
        await _app.DisposeAsync();
        try { Directory.Delete(_root, recursive: true); } catch (IOException) { } catch (UnauthorizedAccessException) { }
    }

    private HttpRequestMessage From(HttpMethod method, string path, string origin, HttpContent? content = null)
    {
        var request = new HttpRequestMessage(method, path) { Content = content };
        request.Headers.Add("Origin", origin);
        return request;
    }

    [Fact]
    public async Task A_page_on_another_site_cannot_open_the_hub()
    {
        // The negotiate step, and the WebSocket a page would open directly instead.
        var negotiate = await _http.SendAsync(From(HttpMethod.Post, "/hubs/workspace/negotiate?negotiateVersion=1", "https://evil.example"));
        negotiate.StatusCode.Should().Be(HttpStatusCode.Forbidden);

        var upgrade = From(HttpMethod.Get, "/hubs/workspace", "https://evil.example");
        upgrade.Headers.Add("Connection", "Upgrade");
        upgrade.Headers.Add("Upgrade", "websocket");
        (await _http.SendAsync(upgrade)).StatusCode.Should().Be(HttpStatusCode.Forbidden);
    }

    [Fact]
    public async Task A_simple_cross_site_post_cannot_close_the_workspace()
    {
        var close = await _http.SendAsync(From(HttpMethod.Post, "/api/workspace/close", "https://evil.example", new StringContent("", null, "text/plain")));
        close.StatusCode.Should().Be(HttpStatusCode.Forbidden);
        (await _http.GetAsync("/api/workspace/snapshot")).StatusCode.Should().Be(HttpStatusCode.OK);
    }

    [Fact]
    public async Task Another_app_on_this_machine_is_another_site()
    {
        var other = await _http.SendAsync(From(HttpMethod.Post, "/api/workspace/close", "http://127.0.0.1:3000"));
        other.StatusCode.Should().Be(HttpStatusCode.Forbidden);
    }

    [Fact]
    public async Task A_request_addressed_to_another_name_is_not_answered()
    {
        // DNS rebinding: the page's own name resolves to 127.0.0.1, so it arrives as that name.
        var port = new Uri(_base).Port;
        var rebound = new HttpRequestMessage(HttpMethod.Post, "/api/workspace/init")
        {
            Content = JsonContent.Create(new { rootPath = Path.Combine(_root, "planted"), name = "Planted" }),
        };
        rebound.Headers.Host = $"evil.example:{port}";
        rebound.Headers.Add("Origin", $"http://evil.example:{port}");
        (await _http.SendAsync(rebound)).StatusCode.Should().Be(HttpStatusCode.BadRequest);
        Directory.Exists(Path.Combine(_root, "planted")).Should().BeFalse();
    }

    [Fact]
    public async Task The_app_s_own_page_and_the_dev_server_are_let_through()
    {
        var own = await _http.SendAsync(From(HttpMethod.Get, "/api/workspace/snapshot", _base.TrimEnd('/')));
        own.StatusCode.Should().Be(HttpStatusCode.OK);
        // Allowed by CORS too, so the desktop window's requests are not logged as refused one per asset.
        own.Headers.GetValues("Access-Control-Allow-Origin").Should().Contain(_base.TrimEnd('/'));
        var dev = await _http.SendAsync(From(HttpMethod.Get, "/api/workspace/snapshot", "http://localhost:5173"));
        dev.StatusCode.Should().Be(HttpStatusCode.OK);
    }

    [Theory]
    [InlineData("http://127.0.0.1:41234", "127.0.0.1:41234", true)]
    [InlineData("http://localhost:41234", "localhost:41234", true)]
    [InlineData("http://localhost:5173", "127.0.0.1:5050", true)]
    [InlineData("http://127.0.0.1:41234", "127.0.0.1:9999", false)]
    [InlineData("https://evil.example", "127.0.0.1:41234", false)]
    [InlineData("null", "127.0.0.1:41234", false)]
    [InlineData("file://", "127.0.0.1:41234", false)]
    public void An_origin_is_allowed_only_when_it_is_this_server_or_the_dev_server(string origin, string host, bool allowed)
    {
        StemmaWebHost.IsAllowedOrigin(origin, new Microsoft.AspNetCore.Http.HostString(host)).Should().Be(allowed);
    }
}
