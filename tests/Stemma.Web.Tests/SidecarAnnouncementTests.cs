using System.Net;
using System.Net.Http.Json;
using FluentAssertions;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.SignalR.Client;
using Stemma.Web;
using Xunit;

namespace Stemma.Web.Tests;

/// <summary>
/// Two windows on one workspace. The engine tells its own write apart from someone else's, so a
/// layout or comment change made in one window was announced to nobody: the other window kept its
/// copy, showed the old layout, and its next save sent arrays it had never re-read — shapes,
/// waypoints, a book's order — over the first window's change. The server now tells every other
/// window, and not the one that made the change, which names itself in a header.
/// </summary>
public sealed class SidecarAnnouncementTests : IAsyncLifetime
{
    private readonly string _root = Path.Combine(Path.GetTempPath(), $"stemma-announce-{Guid.NewGuid():N}");
    private WebApplication _app = null!;
    private HttpClient _http = null!;
    private string _base = null!;

    static SidecarAnnouncementTests() => Environment.SetEnvironmentVariable("STEMMA_LOG_FILE", "off");

    public async Task InitializeAsync()
    {
        _app = StemmaWebHost.Build(["--urls", StemmaWebHost.DynamicLoopbackUrl, "--log-level", "none"]);
        await _app.StartAsync();
        _base = StemmaWebHost.BoundUrl(_app);
        _http = new HttpClient { BaseAddress = new Uri(_base), Timeout = TimeSpan.FromMinutes(2) };
        (await _http.PostAsJsonAsync("/api/workspace/init", new { rootPath = _root, name = "Announce" }))
            .StatusCode.Should().Be(HttpStatusCode.OK);
        await File.WriteAllTextAsync(Path.Combine(_root, "stemma.layout.json"), "{\n  \"version\": 1,\n  \"views\": {}\n}\n");
    }

    public async Task DisposeAsync()
    {
        _http.Dispose();
        await _app.StopAsync();
        await _app.DisposeAsync();
        try { Directory.Delete(_root, recursive: true); } catch (IOException) { } catch (UnauthorizedAccessException) { }
    }

    /// <summary>A connected window, and what the hub has told it.</summary>
    private sealed class Window : IAsyncDisposable
    {
        public required HubConnection Connection { get; init; }
        public int SidecarChanged;
        public int CommentsChanged;
        public string Id => Connection.ConnectionId!;
        public ValueTask DisposeAsync() => Connection.DisposeAsync();
    }

    private async Task<Window> OpenWindowAsync()
    {
        var connection = new HubConnectionBuilder().WithUrl($"{_base}/hubs/workspace").Build();
        var window = new Window { Connection = connection };
        connection.On("SidecarChanged", () => Interlocked.Increment(ref window.SidecarChanged));
        connection.On("CommentsChanged", () => Interlocked.Increment(ref window.CommentsChanged));
        await connection.StartAsync();
        return window;
    }

    private Task<HttpResponseMessage> PatchAsync(string path, object body, string? from)
    {
        var request = new HttpRequestMessage(HttpMethod.Patch, path) { Content = JsonContent.Create(body) };
        if (from is not null) request.Headers.Add(StemmaWebHost.ConnectionHeader, from);
        return _http.SendAsync(request);
    }

    private static readonly object MoveABox = new
    {
        changes = new[] { new { path = new[] { "views", "moduleMap", "nodes", "ctx_a" }, value = new { x = 10, y = 20 } } },
    };

    private static readonly object AddAComment = new
    {
        changes = new[]
        {
            new
            {
                op = "add",
                comment = new { id = $"cmt_{Guid.NewGuid():N}", targetKind = "element", targetId = "ctx_a", author = "Ada", createdAt = "2026-10-21T12:00:00Z", body = "Tak.", resolved = false, thread = Array.Empty<object>() },
            },
        },
    };

    private static async Task Eventually(Func<bool> condition)
    {
        var deadline = DateTime.UtcNow + TimeSpan.FromSeconds(10);
        while (!condition())
        {
            if (DateTime.UtcNow > deadline) throw new TimeoutException("the window was never told");
            await Task.Delay(20);
        }
    }

    [Fact]
    public async Task A_layout_change_is_announced_to_the_other_window_and_not_back_to_its_own()
    {
        await using var mine = await OpenWindowAsync();
        await using var theirs = await OpenWindowAsync();

        (await PatchAsync("/api/workspace/layout", MoveABox, from: mine.Id)).StatusCode.Should().Be(HttpStatusCode.NoContent);

        await Eventually(() => Volatile.Read(ref theirs.SidecarChanged) == 1);
        // Told after the other window was, over the same hub: had it been sent here, it would be here.
        await Task.Delay(200);
        mine.SidecarChanged.Should().Be(0, "the window that made the change already has it, and re-reading would only race its next edit");
        theirs.CommentsChanged.Should().Be(0);
    }

    [Fact]
    public async Task A_comment_is_announced_to_the_other_window_and_not_back_to_its_own()
    {
        await using var mine = await OpenWindowAsync();
        await using var theirs = await OpenWindowAsync();

        (await PatchAsync("/api/workspace/comments", AddAComment, from: mine.Id)).StatusCode.Should().Be(HttpStatusCode.OK);

        await Eventually(() => Volatile.Read(ref theirs.CommentsChanged) == 1);
        await Task.Delay(200);
        mine.CommentsChanged.Should().Be(0);
        theirs.SidecarChanged.Should().Be(0);
    }

    [Fact]
    public async Task A_change_that_does_not_say_where_it_came_from_is_announced_to_every_window()
    {
        await using var one = await OpenWindowAsync();
        await using var two = await OpenWindowAsync();

        (await PatchAsync("/api/workspace/layout", MoveABox, from: null)).EnsureSuccessStatusCode();

        await Eventually(() => Volatile.Read(ref one.SidecarChanged) == 1 && Volatile.Read(ref two.SidecarChanged) == 1);
    }

    [Fact]
    public async Task A_refused_change_is_announced_to_nobody()
    {
        await using var theirs = await OpenWindowAsync();

        (await PatchAsync("/api/workspace/layout", new
        {
            rootPath = Path.Combine(Path.GetTempPath(), "somewhere-else"),
            changes = new[] { new { path = new[] { "version" }, value = 2 } },
        }, from: null)).StatusCode.Should().Be(HttpStatusCode.Conflict);

        await Task.Delay(300);
        theirs.SidecarChanged.Should().Be(0);
    }

    [Fact]
    public async Task The_dev_server_may_send_the_header_across_origins()
    {
        // The page is served by Vite on another port in development, so the PATCH is preflighted.
        var preflight = new HttpRequestMessage(HttpMethod.Options, "/api/workspace/layout");
        preflight.Headers.Add("Origin", "http://localhost:5173");
        preflight.Headers.Add("Access-Control-Request-Method", "PATCH");
        preflight.Headers.Add("Access-Control-Request-Headers", $"content-type,{StemmaWebHost.ConnectionHeader.ToLowerInvariant()}");

        var response = await _http.SendAsync(preflight);

        response.IsSuccessStatusCode.Should().BeTrue();
        response.Headers.GetValues("Access-Control-Allow-Headers").Single()
            .Should().ContainEquivalentOf(StemmaWebHost.ConnectionHeader);
    }
}
