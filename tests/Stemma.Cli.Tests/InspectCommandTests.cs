using System.Text.Json;
using FluentAssertions;
using Xunit;

namespace Stemma.Cli.Tests;

/// <summary>
/// `stemma inspect --view`, run as the shipped command from a directory that is not the workspace. A
/// view by rule is not readable off its file; this is how an agent sees what its rule selected, so
/// the answer has to be the canvas's, member by member and link by link.
/// </summary>
public sealed class InspectCommandTests : IDisposable
{
    private readonly string _dir = Directory.CreateDirectory(
        Path.Combine(Path.GetTempPath(), $"stemma-inspect-{Guid.NewGuid():N}")).FullName;

    public void Dispose() => Directory.Delete(_dir, recursive: true);

    private string Workspace()
    {
        var root = Path.Combine(_dir, "shop");
        Directory.CreateDirectory(Path.Combine(root, "Architecture"));
        Directory.CreateDirectory(Path.Combine(root, "Views"));
        File.WriteAllText(Path.Combine(root, "Architecture", "Architecture.cs"), """
            using Stemma.Model;
            namespace Probe;
            public static class Architecture
            {
                public static Model Build()
                {
                    var buyer = new Person("per_buyer", "Buyer", "external");
                    var hr = new SoftwareSystem("sys_hr", "HR");
                    var shop = new SoftwareSystem("sys_shop", "Shop");
                    var payments = new SoftwareSystem("sys_payments", "Payments");
                    var web = new Container("cnt_web", "Web Shop", "sys_shop", "spa");
                    var api = new Container("cnt_api", "Order API", "sys_shop", Technology: ".NET 8");
                    var gateway = new Container("cnt_gateway", "Gateway", "sys_payments");
                    var browse = new DataFlow("flow_browse", "per_buyer", "cnt_web", "search terms", Technology: "HTTPS");
                    var call = new DataFlow("flow_call", "cnt_web", "cnt_api", "orders");
                    var pay = new DataFlow("flow_pay", "cnt_api", "cnt_gateway", "payment");
                    var refund = new DataFlow("flow_refund", "cnt_api", "cnt_gateway", "refund");
                    var rota = new DataFlow("flow_rota", "sys_hr", "per_buyer", "rota");
                    return Model.Of(buyer, hr, shop, payments, web, api, gateway, browse, call, pay, refund, rota);
                }
            }
            """);
        File.WriteAllText(Path.Combine(root, "Views", "ShopContainers.cs"), """
            using Stemma.Model;
            namespace Probe;
            public static class ShopContainers
            {
                public static View Define() => new(Id: "view_shop", Name: "Shop containers", BaseView: "container", Scope: "sys_shop",
                    Include: new[] { "sys_hr" }, Exclude: new[] { "cnt_web" });
            }
            """);
        File.WriteAllText(Path.Combine(root, "Views", "Broken.cs"), """
            using Stemma.Model;
            namespace Probe;
            public static class Broken
            {
                public static View Define() => new(Id: "view_broken", Name: "Broken", BaseView: "container");
            }
            """);
        return root;
    }

    private (int ExitCode, string Output, string Error) Stemma(params string[] args)
    {
        var psi = SiblingProgram.StartInfo(Path.Combine(AppContext.BaseDirectory, "stemma.dll"));
        psi.RedirectStandardOutput = true;
        psi.RedirectStandardError = true;
        psi.WorkingDirectory = _dir;
        foreach (var a in args) psi.ArgumentList.Add(a);
        using var p = System.Diagnostics.Process.Start(psi)!;
        var error = p.StandardError.ReadToEndAsync();
        var output = p.StandardOutput.ReadToEnd();
        p.WaitForExit();
        return (p.ExitCode, output.Trim(), error.Result.Trim());
    }

    [Fact]
    public void The_json_says_each_member_and_what_brought_it_in_the_links_drawn_implied_and_left_out()
    {
        var (exit, output, _) = Stemma("inspect", "--view", "view_shop", Workspace(), "--json");

        exit.Should().Be(0);
        using var json = JsonDocument.Parse(output);
        var root = json.RootElement;
        root.GetProperty("view").GetProperty("scope").GetString().Should().Be("sys_shop");
        root.GetProperty("members").EnumerateArray()
            .Select(m => (m.GetProperty("id").GetString(), m.GetProperty("kind").GetString(), m.GetProperty("provenance").GetString()))
            .Should().Equal(
                ("per_buyer", "person", "lens"), ("sys_shop", "softwareSystem", "lens"), ("sys_payments", "softwareSystem", "lens"),
                ("cnt_api", "container", "lens"), ("sys_hr", "softwareSystem", "include:sys_hr"));
        root.GetProperty("links").EnumerateArray().Select(l => l.GetProperty("id").GetString()).Should().Equal("flow_rota");
        // The web shop is excluded, so the buyer's search is drawn to the shop it is part of; the API's
        // orders from it would be an arrow from the boundary to a card inside it, and are left out.
        var implied = root.GetProperty("implied").EnumerateArray().ToList();
        implied.Select(i => i.GetProperty("id").GetString()).Should().Equal("__implied__per_buyer__sys_shop", "__implied__cnt_api__sys_payments");
        implied[1].GetProperty("linkIds").EnumerateArray().Select(l => l.GetString()).Should().Equal("flow_pay", "flow_refund");
        implied[1].GetProperty("labels").EnumerateArray().Select(l => l.GetString()).Should().Equal("payment", "refund");
        implied[0].GetProperty("labels").EnumerateArray().Select(l => l.GetString()).Should().Equal("search terms [HTTPS]");
        root.GetProperty("leftOut").EnumerateArray()
            .Select(l => (l.GetProperty("id").GetString(), l.GetProperty("absent").GetString(), l.GetProperty("label").GetString()))
            .Should().Equal(("flow_call", "cnt_web", "orders"));
        root.GetProperty("problems").GetArrayLength().Should().Be(0);
    }

    [Fact]
    public void The_text_is_found_by_the_view_s_name_and_says_the_same_in_sections()
    {
        var (exit, output, _) = Stemma("inspect", "--workspace", Workspace(), "--view", "Shop containers");

        exit.Should().Be(0);
        output.Should().StartWith("stemma inspect: view_shop \"Shop containers\" — container, scope sys_shop")
            .And.Contain("Members (5)").And.Contain("Links drawn (1)").And.Contain("Implied links (2)").And.Contain("Left out (1)")
            .And.Contain("cnt_api -> sys_payments, for flow_pay  \"payment\", flow_refund  \"refund\"")
            .And.Contain("'cnt_web' is not in the view");
    }

    [Fact]
    public void A_view_with_an_error_in_how_it_is_written_exits_like_validate()
    {
        var (exit, output, _) = Stemma("inspect", "--view", "view_broken", Workspace());

        exit.Should().Be(1);
        output.Should().Contain("Problems (1)").And.Contain("view/bad-scope");
    }

    [Theory]
    [InlineData("--view", "view_nope")]
    [InlineData("--json")]
    public void No_such_view_or_no_view_at_all_is_a_mistake_on_the_command_line(params string[] args)
    {
        var (exit, _, error) = Stemma(["inspect", Workspace(), .. args]);

        exit.Should().Be(2);
        error.Should().Match(e => e.Contains("view_broken, view_shop") || e.Contains("--view"));
    }

    [Fact]
    public void Inspect_is_listed_with_the_other_commands()
    {
        Stemma("--help").Output.Should().Contain("stemma inspect");
    }
}
