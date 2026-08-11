using System.Diagnostics;
using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using FluentAssertions;
using Microsoft.AspNetCore.Builder;
using Stemma.Web;
using Xunit;

namespace Stemma.Web.Tests;

/// <summary>
/// The first ten minutes, driven rather than described (F-003).
///
/// Walking this path by hand on 2026-08-01 found six distinct stops, and two of them were invisible
/// from inside a development checkout: the scaffold emitted a `PackageReference` to a package that
/// was never published, and it targeted a framework the solution had moved off. Both worked
/// perfectly here and were fatal for everyone else. So this drives the real HTTP surface against a
/// real temporary folder — create it by name, open it, and then look at what is actually on disk.
/// </summary>
public sealed class FromScratchJourneyTests : IAsyncLifetime
{
    private readonly string _root = Path.Combine(Path.GetTempPath(), $"stemma-scratch-{Guid.NewGuid():N}");
    private WebApplication _app = null!;
    private HttpClient _http = null!;

    static FromScratchJourneyTests() => Environment.SetEnvironmentVariable("STEMMA_LOG_FILE", "off");

    public async Task InitializeAsync()
    {
        _app = StemmaWebHost.Build(["--urls", StemmaWebHost.DynamicLoopbackUrl, "--log-level", "none"]);
        await _app.StartAsync();
        _http = new HttpClient { BaseAddress = new Uri(StemmaWebHost.BoundUrl(_app)), Timeout = TimeSpan.FromMinutes(2) };
    }

    public async Task DisposeAsync()
    {
        _http.Dispose();
        await _app.StopAsync();
        await _app.DisposeAsync();
        if (Directory.Exists(_root)) DeleteTree(_root);
    }

    private async Task<JsonElement> CreateModelAsync(string name = "Payments Platform")
    {
        var response = await _http.PostAsJsonAsync("/api/workspace/init", new { rootPath = _root, name });
        response.StatusCode.Should().Be(HttpStatusCode.OK,
            "creating a model is the first thing anyone does, and it must not need a path they had to know");
        return await response.Content.ReadFromJsonAsync<JsonElement>();
    }

    private string Path_(params string[] parts) => Path.Combine([_root, .. parts]);

    // ---- AC3: it loads on a machine that has never built Stemma -------------------------------

    [Fact]
    public async Task A_model_created_by_name_is_open_and_readable_straight_away()
    {
        await CreateModelAsync();

        // Creating opens it, so there is no second step between "I clicked Create" and a canvas.
        var snapshot = await _http.GetAsync("/api/workspace/snapshot");
        snapshot.StatusCode.Should().Be(HttpStatusCode.OK);

        var arch = await _http.GetFromJsonAsync<JsonElement>("/api/workspace/arch");
        arch.GetProperty("elements").GetArrayLength().Should().Be(0,
            "a new model is empty — the canvas has to say so rather than show a bare grid");
    }

    [Fact]
    public async Task The_workspace_it_creates_has_no_project_file_at_all()
    {
        await CreateModelAsync();

        // The reason AC3 holds. A project file would drag in MSBuild, an SDK, and a restore of a
        // package that is not published — which is exactly how this failed for everyone who was not
        // running from this repository (ADR-0016).
        Directory.GetFiles(_root, "*.csproj", SearchOption.AllDirectories).Should().BeEmpty();
        Directory.GetFiles(_root, "*.sln", SearchOption.AllDirectories).Should().BeEmpty();
        File.Exists(Path_("Architecture", "Architecture.cs")).Should().BeTrue();
    }

    [Fact]
    public async Task It_lands_with_the_brief_and_the_readme_beside_the_model()
    {
        await CreateModelAsync();

        File.Exists(Path_("STEMMA.md")).Should().BeTrue();
        File.Exists(Path_("README.md")).Should().BeTrue();
        File.Exists(Path_(".gitignore")).Should().BeTrue();
    }

    // ---- AC4: a clean Git working tree ---------------------------------------------------------

    [Fact]
    public async Task Loading_the_new_model_leaves_no_build_output_behind()
    {
        await CreateModelAsync();

        // The tool whose pitch is "Git-native" used to hand you a folder full of obj/ within seconds
        // of creating it, because opening it ran a design-time build.
        Directory.GetDirectories(_root, "obj", SearchOption.AllDirectories).Should().BeEmpty();
        Directory.GetDirectories(_root, "bin", SearchOption.AllDirectories).Should().BeEmpty();
    }

    [Fact]
    public async Task The_new_model_is_a_repository_with_nothing_uncommitted()
    {
        var created = await CreateModelAsync();
        if (!created.GetProperty("gitInitialised").GetBoolean())
            return; // No git on this machine; the model is still usable, which is the design.

        Directory.Exists(Path_(".git")).Should().BeTrue();

        // The whole point of the first commit is that the next diff is the user's first edit and
        // nothing else. An untracked file here means their first `git status` is noise.
        var status = RunGit("status", "--porcelain");
        status.Should().BeEmpty($"the working tree should be clean, but git reported:\n{status}");
    }

    // ---- AC7: what the first element actually wrote --------------------------------------------

    [Fact]
    public async Task An_id_that_does_not_exist_has_no_source_to_show()
    {
        await CreateModelAsync();

        var response = await _http.GetAsync("/api/workspace/source/nope_not_here");

        // The canvas asks for this straight after an add; a 404 has to mean "nothing to show",
        // never an invented line of C#.
        response.StatusCode.Should().Be(HttpStatusCode.NotFound);
    }

    // ---- Naming ---------------------------------------------------------------------------------

    [Fact]
    public async Task A_name_with_spaces_becomes_a_legal_namespace()
    {
        await CreateModelAsync("Payments Platform");

        var source = await File.ReadAllTextAsync(Path_("Architecture", "Architecture.cs"));
        source.Should().Contain("namespace PaymentsPlatform;");
    }

    [Fact]
    public async Task Creating_without_a_name_is_refused_rather_than_guessed_at()
    {
        var response = await _http.PostAsJsonAsync("/api/workspace/init", new { rootPath = (string?)null, name = "  " });

        response.StatusCode.Should().Be(HttpStatusCode.BadRequest);
    }

    private string RunGit(params string[] args)
    {
        var psi = new ProcessStartInfo("git")
        {
            WorkingDirectory = _root,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            UseShellExecute = false,
        };
        foreach (var a in args) psi.ArgumentList.Add(a);
        using var process = Process.Start(psi)!;
        var output = process.StandardOutput.ReadToEnd();
        process.WaitForExit();
        return output.Trim();
    }

    /// <summary>A `.git` directory contains read-only objects, which a plain recursive delete trips on.</summary>
    private static void DeleteTree(string path)
    {
        foreach (var file in Directory.EnumerateFiles(path, "*", SearchOption.AllDirectories))
            File.SetAttributes(file, FileAttributes.Normal);
        Directory.Delete(path, recursive: true);
    }
}
