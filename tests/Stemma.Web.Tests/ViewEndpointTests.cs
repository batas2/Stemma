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

    // ---- views by rule (F-023, ADR-0026) ------------------------------------------------------

    private async Task OpenC4Async(params (string File, string Define)[] views)
    {
        await File.WriteAllTextAsync(Path.Combine(_root, "Architecture", "Architecture.cs"), """
            using Stemma.Model;
            namespace Views;
            public static class Architecture
            {
                public static Model Build()
                {
                    var buyer = new Person("per_buyer", "Buyer", "external");
                    var shop = new SoftwareSystem("sys_shop", "Shop");
                    var payments = new SoftwareSystem("sys_payments", "Payments");
                    var web = new Container("cnt_web", "Web Shop", "sys_shop", "spa");
                    var api = new Container("cnt_api", "Order API", "sys_shop", Technology: ".NET 8");
                    var gateway = new Container("cnt_gateway", "Gateway", "sys_payments");
                    var browse = new DataFlow("flow_browse", "per_buyer", "cnt_web", "search terms");
                    var call = new DataFlow("flow_call", "cnt_web", "cnt_api", "orders");
                    var pay = new DataFlow("flow_pay", "cnt_api", "cnt_gateway", "payment");
                    var refund = new DataFlow("flow_refund", "cnt_api", "cnt_gateway", "refund");
                    return Model.Of(buyer, shop, payments, web, api, gateway, browse, call, pay, refund);
                }
            }
            """);
        Directory.CreateDirectory(Path.Combine(_root, "Views"));
        foreach (var (file, define) in views)
            await File.WriteAllTextAsync(Path.Combine(_root, "Views", file), $$"""
                using Stemma.Model;
                namespace Views;
                public static class {{Path.GetFileNameWithoutExtension(file)}}
                {
                    public static View Define() => {{define}};
                }
                """);
        (await _http.PostAsJsonAsync("/api/workspace/open", new { rootPath = _root })).EnsureSuccessStatusCode();
    }

    [Fact]
    public async Task The_list_gives_each_view_as_written_and_what_it_draws()
    {
        await OpenC4Async(
            ("ShopContainers.cs", """new(Id: "view_shop", Name: "Shop", BaseView: "container", Scope: "sys_shop", Include: new[] { "sys_ghost.*" })"""),
            ("Listed.cs", """new(Id: "view_listed", Name: "Listed", BaseView: "all", ElementIds: new[] { "cnt_api", "cnt_web" })"""));

        using var json = System.Text.Json.JsonDocument.Parse(await _http.GetStringAsync("/api/workspace/views"));
        var views = json.RootElement.EnumerateArray().ToDictionary(v => v.GetProperty("id").GetString()!);

        var shop = views["view_shop"];
        shop.EnumerateObject().Select(p => p.Name).Should().Equal(
            "id", "name", "baseView", "elementIds", "scope", "include", "exclude", "members", "provenance", "implied", "problems");
        shop.GetProperty("elementIds").GetArrayLength().Should().Be(0, "a view with no list is an empty one, not a missing one");
        shop.GetProperty("scope").GetString().Should().Be("sys_shop");
        shop.GetProperty("exclude").ValueKind.Should().Be(System.Text.Json.JsonValueKind.Null);
        shop.GetProperty("members").EnumerateArray().Select(m => m.GetString()).Should()
            .Equal("per_buyer", "sys_shop", "sys_payments", "cnt_web", "cnt_api");
        shop.GetProperty("provenance").GetProperty("cnt_api").GetString().Should().Be("lens");
        var implied = shop.GetProperty("implied").EnumerateArray().Single();
        implied.GetProperty("id").GetString().Should().Be("__implied__cnt_api__sys_payments");
        (implied.GetProperty("fromId").GetString(), implied.GetProperty("toId").GetString()).Should().Be(("cnt_api", "sys_payments"));
        implied.GetProperty("linkIds").EnumerateArray().Select(l => l.GetString()).Should().Equal("flow_pay", "flow_refund");
        var problem = shop.GetProperty("problems").EnumerateArray().Single();
        problem.EnumerateObject().Select(p => p.Name).Should().Equal("rule", "severity", "message");
        (problem.GetProperty("rule").GetString(), problem.GetProperty("severity").GetString()).Should().Be(("view/dangling-include", "error"));

        var listed = views["view_listed"];
        listed.GetProperty("scope").ValueKind.Should().Be(System.Text.Json.JsonValueKind.Null);
        listed.GetProperty("include").ValueKind.Should().Be(System.Text.Json.JsonValueKind.Null);
        listed.GetProperty("members").EnumerateArray().Select(m => m.GetString()).Should().Equal("cnt_api", "cnt_web");
        listed.GetProperty("provenance").GetProperty("cnt_web").GetString().Should().Be("elementIds");
        listed.GetProperty("implied").GetArrayLength().Should().Be(0);
    }

    [Fact]
    public async Task Saving_the_view_as_listed_with_an_exclude_keeps_the_rules_and_ignores_what_was_resolved()
    {
        await OpenC4Async(("ShopContainers.cs", """new(Id: "view_shop", Name: "Shop", BaseView: "container", Scope: "sys_shop", Include: new[] { "per_buyer" })"""));
        var file = Path.Combine(_root, "Views", "ShopContainers.cs");
        var before = await File.ReadAllTextAsync(file);
        var listed = (await _http.GetFromJsonAsync<List<System.Text.Json.Nodes.JsonObject>>("/api/workspace/views"))!.Single();

        // Sent back as it came, members and all, with one element hidden and the scope and include
        // left out altogether.
        listed["exclude"] = new System.Text.Json.Nodes.JsonArray("cnt_web");
        listed.Remove("scope");
        listed["include"] = null;
        var saved = await _http.PutAsJsonAsync("/api/workspace/views", listed);

        saved.StatusCode.Should().Be(HttpStatusCode.NoContent, await saved.Content.ReadAsStringAsync());
        (await File.ReadAllTextAsync(file)).Should().Be(before.Replace(
            "Include: new[] { \"per_buyer\" })",
            "Include: new[] { \"per_buyer\" }, Exclude: [\"cnt_web\"])"));
    }

    [Fact]
    public async Task The_draw_io_export_of_a_view_by_rule_has_what_the_view_draws()
    {
        // It took the view's ElementIds, which a view by rule does not have: the export was empty.
        await OpenC4Async(("ShopContainers.cs", """new(Id: "view_shop", Name: "Shop", BaseView: "container", Scope: "sys_shop")"""));

        var xml = await _http.GetStringAsync("/api/workspace/export/drawio?view=view_shop");

        var labels = System.Xml.Linq.XDocument.Parse(xml).Descendants("mxCell")
            .Where(c => c.Attribute("vertex")?.Value == "1").Select(c => c.Attribute("value")?.Value);
        labels.Should().BeEquivalentTo("Buyer", "Shop", "Payments", "Web Shop", "Order API");
    }

    [Fact]
    public async Task A_save_with_no_id_is_refused_rather_than_written_somewhere()
    {
        var response = await _http.PutAsJsonAsync("/api/workspace/views", new { name = "Nameless", baseView = "all" });

        response.StatusCode.Should().Be(HttpStatusCode.BadRequest);
    }
}
