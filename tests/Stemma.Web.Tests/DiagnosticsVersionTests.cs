using System.Net.Http.Json;
using System.Text.Json;
using FluentAssertions;
using Microsoft.AspNetCore.Builder;
using Stemma.Engine.Diagnostics;
using Xunit;

namespace Stemma.Web.Tests;

/// <summary>
/// F-012. The first question about any report is which build it came from, so the host says, and
/// the bundle — the thing pasted into an issue — carries the commit as well as the release.
/// </summary>
public sealed class DiagnosticsVersionTests : IAsyncLifetime
{
    private WebApplication _app = null!;
    private HttpClient _http = null!;

    static DiagnosticsVersionTests() => Environment.SetEnvironmentVariable("STEMMA_LOG_FILE", "off");

    public async Task InitializeAsync()
    {
        _app = StemmaWebHost.Build(["--urls", StemmaWebHost.DynamicLoopbackUrl, "--log-level", "none"]);
        await _app.StartAsync();
        _http = new HttpClient { BaseAddress = new Uri(StemmaWebHost.BoundUrl(_app)) };
    }

    public async Task DisposeAsync()
    {
        _http.Dispose();
        await _app.StopAsync();
        await _app.DisposeAsync();
    }

    [Fact]
    public async Task The_host_says_which_release_it_is()
    {
        var diagnostics = await _http.GetFromJsonAsync<JsonElement>("/api/diagnostics");

        diagnostics.GetProperty("version").GetString().Should().Be(StemmaVersion.Release);
    }

    [Fact]
    public async Task The_bundle_names_the_build_it_came_from()
    {
        var bundle = await _http.GetFromJsonAsync<JsonElement>("/api/diagnostics/bundle");

        bundle.GetProperty("environment").GetProperty("stemma").GetString().Should().Be(StemmaVersion.Build);
    }
}
