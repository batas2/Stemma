using FluentAssertions;
using Stemma.Web;
using Xunit;

namespace Stemma.Web.Tests;

/// <summary>
/// The host as something other things start.
///
/// Two launchers already exist besides <c>dotnet run</c> — the render CLI and the desktop shell —
/// and both have to answer the same two questions before they can show anything: where is the built
/// front end, and which port did Kestrel actually take. Getting either wrong produces a process that
/// looks healthy and serves nothing anyone asked for.
/// </summary>
public class StemmaWebHostTests : IDisposable
{
    private readonly string _dir = Directory.CreateDirectory(
        Path.Combine(Path.GetTempPath(), $"stemma-host-{Guid.NewGuid():N}")).FullName;

    static StemmaWebHostTests() => Environment.SetEnvironmentVariable("STEMMA_LOG_FILE", "off");

    public void Dispose() => Directory.Delete(_dir, recursive: true);

    private string WithFrontEnd(params string[] segments)
    {
        var root = Path.Combine([_dir, .. segments]);
        Directory.CreateDirectory(Path.Combine(root, "wwwroot"));
        File.WriteAllText(Path.Combine(root, "wwwroot", "index.html"), "<!doctype html>");
        return root;
    }

    // ---- Finding the front end -----------------------------------------------------------------

    [Fact]
    public void Finds_a_bundle_published_beside_the_binary()
    {
        var root = WithFrontEnd();

        StemmaWebHost.FindContentRoot(root).Should().Be(root);
    }

    [Fact]
    public void Finds_the_web_project_from_a_sibling_build_output()
    {
        WithFrontEnd("src", "Stemma.Web");
        var somethingElsesOutput = Directory.CreateDirectory(
            Path.Combine(_dir, "src", "Stemma.Desktop", "bin", "Debug", "net10.0")).FullName;

        StemmaWebHost.FindContentRoot(somethingElsesOutput)
            .Should().Be(Path.Combine(_dir, "src", "Stemma.Web"));
    }

    [Fact]
    public void An_empty_wwwroot_does_not_count_as_a_front_end()
    {
        // What a failed or interrupted `vite build` leaves behind. Serving it is a blank window.
        Directory.CreateDirectory(Path.Combine(_dir, "wwwroot"));

        StemmaWebHost.FindContentRoot(_dir).Should().BeNull();
    }

    [Fact]
    public void Reports_nothing_rather_than_guessing()
    {
        StemmaWebHost.FindContentRoot(_dir).Should().BeNull();
    }

    // ---- Who is allowed to ask ------------------------------------------------------------------

    [Theory]
    [InlineData("http://localhost:5173")]   // the Vite dev server
    [InlineData("http://127.0.0.1:36565")]  // a desktop window, on whichever port it was given
    [InlineData("http://localhost:5050")]
    [InlineData("http://[::1]:41234")]
    public void Any_origin_on_this_machine_may_ask(string origin) =>
        StemmaWebHost.IsLocalOrigin(origin).Should().BeTrue();

    [Theory]
    [InlineData("https://stemma.example.com")]
    [InlineData("http://192.168.1.20:5050")]
    [InlineData("null")]
    [InlineData("")]
    public void Nothing_else_may(string origin) =>
        StemmaWebHost.IsLocalOrigin(origin).Should().BeFalse();

    // ---- Publishing where it landed ------------------------------------------------------------

    [Fact]
    public async Task Writes_the_bound_url_to_the_port_file_and_removes_it_on_shutdown()
    {
        var root = WithFrontEnd();
        var portFile = Path.Combine(_dir, "run", "port");
        var app = StemmaWebHost.Build([
            "--contentRoot", root,
            "--urls", StemmaWebHost.DynamicLoopbackUrl,
            "--port-file", portFile,
            "--log-level", "none",
        ]);

        using var stopping = new CancellationTokenSource();
        var running = StemmaWebHost.RunAsync(app, stopping.Token);

        var url = await Eventually(() => File.Exists(portFile) ? File.ReadAllText(portFile) : null);
        // A launcher reads this and navigates to it; a port of 0 or a wildcard host would be useless.
        new Uri(url).Port.Should().BeGreaterThan(0);
        using var http = new HttpClient();
        (await http.GetStringAsync(url)).Should().Contain("<!doctype html>");

        await stopping.CancelAsync();
        await running;

        // A port file that outlives its server sends the next launcher at a dead port, which reads
        // as a hang rather than as "nothing is running".
        File.Exists(portFile).Should().BeFalse();
    }

    private static async Task<T> Eventually<T>(Func<T?> read, int attempts = 100) where T : class
    {
        for (var i = 0; i < attempts; i++)
        {
            if (read() is { } value) return value;
            await Task.Delay(50);
        }
        throw new TimeoutException("the host never published its address");
    }
}
