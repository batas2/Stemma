using FluentAssertions;
using Stemma.Desktop;
using Xunit;

namespace Stemma.Desktop.Tests;

/// <summary>
/// The shell's half of the host contract: it boots on a port the OS picked, serves the app, and
/// stops when it is disposed (F-002 AC1, AC2, and the §7 smoke test).
///
/// The content root is a stand-in for a built front end — one <c>index.html</c> — because the point
/// is the wiring, not the bundle: static files, the default document, and the SPA fallback that
/// makes a deep link work. A host that starts and 404s the page is the exact failure this catches,
/// and it is invisible from the API side.
/// </summary>
public sealed class BackendSessionTests : IDisposable
{
    private const string IndexHtml = "<!doctype html><title>Stemma</title><div id=\"root\"></div>";

    private readonly string _contentRoot;

    static BackendSessionTests()
    {
        // A test must never write into the log directory the user's real windows share.
        Environment.SetEnvironmentVariable("STEMMA_LOG_FILE", "off");
    }

    public BackendSessionTests()
    {
        _contentRoot = Directory.CreateDirectory(
            Path.Combine(Path.GetTempPath(), $"stemma-host-{Guid.NewGuid():N}")).FullName;
        var wwwroot = Directory.CreateDirectory(Path.Combine(_contentRoot, "wwwroot")).FullName;
        File.WriteAllText(Path.Combine(wwwroot, "index.html"), IndexHtml);
    }

    public void Dispose() => Directory.Delete(_contentRoot, recursive: true);

    private BackendSession Create() =>
        BackendSession.Create(["--contentRoot", _contentRoot, "--log-level", "none"]);

    private static readonly HttpClient Http = new() { Timeout = TimeSpan.FromSeconds(30) };

    [Fact]
    public async Task Binds_a_port_the_operating_system_chose()
    {
        await using var session = Create();

        var url = await session.StartAsync(workspacePath: null);

        var port = new Uri(url).Port;
        port.Should().BeGreaterThan(0, "port 0 means 'choose one', and the chosen one is what we need back");
        url.Should().StartWith("http://127.0.0.1:", "the backend is this window's, and nobody else's business");
    }

    [Fact]
    public async Task Serves_the_app()
    {
        await using var session = Create();
        var url = await session.StartAsync(workspacePath: null);

        var page = await Http.GetStringAsync(url);

        page.Should().Contain("<div id=\"root\">");
    }

    [Fact]
    public async Task Serves_a_deep_link_as_the_app()
    {
        await using var session = Create();
        var url = await session.StartAsync(workspacePath: null);

        // No server-side route matches this; the SPA has to get it, or every refresh is a 404.
        var page = await Http.GetStringAsync($"{url}/views/some-view");

        page.Should().Contain("<div id=\"root\">");
    }

    [Fact]
    public async Task Serves_the_api_beside_it()
    {
        await using var session = Create();
        var url = await session.StartAsync(workspacePath: null);

        var response = await Http.GetAsync($"{url}/api/workspace/snapshot");

        // Nothing is open yet, which is a perfectly good answer — what matters is that it is *an*
        // answer and not the SPA fallback swallowing the API surface.
        response.StatusCode.Should().Be(System.Net.HttpStatusCode.NotFound);
    }

    [Fact]
    public async Task The_page_it_serves_is_allowed_to_talk_to_it()
    {
        await using var session = Create();
        var url = await session.StartAsync(workspacePath: null);

        using var request = new HttpRequestMessage(HttpMethod.Get, $"{url}/api/workspace/recents");
        // What the webview sends: the origin is the window's own, on a port nobody could allow-list
        // in advance. The allow-list that named the dev server refused it and logged a failure for
        // every asset on the page.
        request.Headers.Add("Origin", url);
        var response = await Http.SendAsync(request);

        response.Headers.GetValues("Access-Control-Allow-Origin").Should().Contain(url);
    }

    [Fact]
    public async Task Two_windows_do_not_collide()
    {
        await using var first = Create();
        await using var second = Create();

        var firstUrl = await first.StartAsync(workspacePath: null);
        var secondUrl = await second.StartAsync(workspacePath: null);

        // The whole reason for binding :0. With a fixed port the second launch either fails or
        // reclaims the first one's port, which is what run.sh used to paper over.
        new Uri(secondUrl).Port.Should().NotBe(new Uri(firstUrl).Port);
        (await Http.GetStringAsync(firstUrl)).Should().Contain("root");
        (await Http.GetStringAsync(secondUrl)).Should().Contain("root");
    }

    [Fact]
    public async Task A_workspace_that_does_not_exist_still_opens_a_window()
    {
        await using var session = Create();

        var url = await session.StartAsync(Path.Combine(Path.GetTempPath(), $"stemma-absent-{Guid.NewGuid():N}"));

        // The user lands in the app's own empty state and picks another one. A dead window would be
        // the worse answer, and a crash the worst.
        (await Http.GetStringAsync(url)).Should().Contain("root");
    }

    [Theory]
    [InlineData("--contentRoot", "/no/such/directory/anywhere")]
    [InlineData("--log-level", "not-a-level")]
    [InlineData("--nonsense", "")]
    public void Composing_the_host_never_throws_at_the_caller(string flag, string value)
    {
        // Whatever is wrong has to reach the window's failure surface. A shell that dies before it
        // has drawn anything is indistinguishable from one that never launched, and the terminal
        // that would have shown the stack trace may not exist.
        var create = () => BackendSession.Create(value.Length == 0 ? [flag] : [flag, value]);

        create.Should().NotThrow();
    }

    [Fact]
    public async Task Closing_the_window_stops_the_server()
    {
        var session = Create();
        var url = await session.StartAsync(workspacePath: null);

        await session.DisposeAsync();

        // AC2: no orphan holds the port after the window goes away.
        var request = async () => await Http.GetStringAsync(url);
        await request.Should().ThrowAsync<HttpRequestException>();
    }
}
