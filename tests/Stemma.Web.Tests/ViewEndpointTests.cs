using System.Net;
using System.Net.Http.Json;
using FluentAssertions;
using Microsoft.AspNetCore.Builder;
using Stemma.Web;
using Xunit;

namespace Stemma.Web.Tests;

/// <summary>
/// The canvas saves a view with PUT /api/workspace/views and deletes one with DELETE. Driven over
/// HTTP against a real model, because the defect these guard against (B-010) lived in the endpoint
/// itself: it wrote the file from a template and deleted whatever file mentioned the id.
/// </summary>
public sealed class ViewEndpointTests : IAsyncLifetime
{
    private readonly string _root = Path.Combine(Path.GetTempPath(), $"stemma-viewapi-{Guid.NewGuid():N}");
    private WebApplication _app = null!;
    private HttpClient _http = null!;

    static ViewEndpointTests() => Environment.SetEnvironmentVariable("STEMMA_LOG_FILE", "off");

    public async Task InitializeAsync()
    {
        _app = StemmaWebHost.Build(["--urls", StemmaWebHost.DynamicLoopbackUrl, "--log-level", "none"]);
        await _app.StartAsync();
        _http = new HttpClient { BaseAddress = new Uri(StemmaWebHost.BoundUrl(_app)), Timeout = TimeSpan.FromMinutes(2) };
        var created = await _http.PostAsJsonAsync("/api/workspace/init", new { rootPath = _root, name = "Views" });
        created.StatusCode.Should().Be(HttpStatusCode.OK);
    }

    public async Task DisposeAsync()
    {
        _http.Dispose();
        await _app.StopAsync();
        await _app.DisposeAsync();
        // A leftover temp folder is harmless; a cleanup failure must not mask the assertion that failed.
        try { Directory.Delete(_root, recursive: true); } catch (IOException) { } catch (UnauthorizedAccessException) { }
    }

    private Task<HttpResponseMessage> PutAsync(string id, string name, params string[] ids) =>
        _http.PutAsJsonAsync("/api/workspace/views", new { id, name, baseView = "all", elementIds = ids });

    [Fact]
    public async Task A_view_saved_twice_is_one_file_edited_in_place_and_deleted_by_its_id()
    {
        (await PutAsync("view_a", "Checkout path", "ctx_x")).StatusCode.Should().Be(HttpStatusCode.NoContent);
        var file = Path.Combine(_root, "Views", "CheckoutPath.cs");
        File.Exists(file).Should().BeTrue();

        // Someone documents the view by hand, straight after the canvas saved it; the next save from
        // the canvas must keep that. If it arrives before the watcher has seen the hand edit it is
        // refused as ChangedOnDisk and the edit is read, so the retry lands on top of it.
        var documented = (await File.ReadAllTextAsync(file)).Replace("public static class", "/// <summary>The path an order takes.</summary>\npublic static class");
        await File.WriteAllTextAsync(file, documented);

        var second = await PutAsync("view_a", "Checkout path, revised", "ctx_x", "ctx_y");
        if (second.StatusCode == HttpStatusCode.Conflict)
        {
            (await second.Content.ReadAsStringAsync()).Should().Contain("ChangedOnDisk");
            second = await PutAsync("view_a", "Checkout path, revised", "ctx_x", "ctx_y");
        }
        second.StatusCode.Should().Be(HttpStatusCode.NoContent);
        Directory.GetFiles(Path.Combine(_root, "Views")).Select(Path.GetFileName).Should().Equal("CheckoutPath.cs");
        var saved = await File.ReadAllTextAsync(file);
        saved.Should().Contain("/// <summary>The path an order takes.</summary>")
            .And.Contain("Name: \"Checkout path, revised\"")
            .And.Contain("[\"ctx_x\", \"ctx_y\"]");

        (await _http.DeleteAsync("/api/workspace/views/view_a")).StatusCode.Should().Be(HttpStatusCode.NoContent);
        File.Exists(file).Should().BeFalse();
        (await _http.DeleteAsync("/api/workspace/views/view_a")).StatusCode.Should().Be(HttpStatusCode.NotFound);
    }

    private void ViewFile(string relative, string id)
    {
        var path = Path.Combine(_root, relative);
        Directory.CreateDirectory(Path.GetDirectoryName(path)!);
        var name = Path.GetFileNameWithoutExtension(path);
        File.WriteAllText(path, $$"""
            using Stemma.Model;
            namespace Views;
            public static class {{name}}
            {
                public static View Define() => new(Id: "{{id}}", Name: "{{name}}", BaseView: "all", ElementIds: new[] { "ctx_x" });
            }
            """);
    }

    [Fact]
    public async Task The_list_has_every_view_the_workspace_holds_in_a_subfolder_too()
    {
        // The list read only the top of Views/, while the engine — which saves and deletes a view —
        // and validate read its subfolders too: a view in Views/Billing/ was checked and could be
        // deleted, and never appeared in the list.
        ViewFile(Path.Combine("Views", "Overview.cs"), "view_overview");
        ViewFile(Path.Combine("Views", "Billing", "Invoices.cs"), "view_invoices");
        ViewFile(Path.Combine("Views", "obj", "Copy.cs"), "view_copy");
        (await _http.PostAsJsonAsync("/api/workspace/open", new { rootPath = _root })).EnsureSuccessStatusCode();

        var views = await _http.GetFromJsonAsync<List<ListedView>>("/api/workspace/views");

        views!.Select(v => v.Id).Should().BeEquivalentTo(["view_overview", "view_invoices"],
            "build output is never part of the workspace");
    }

    private sealed record ListedView(string Id, string Name);
}
