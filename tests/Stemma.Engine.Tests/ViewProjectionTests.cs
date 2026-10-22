using FluentAssertions;
using Stemma.Engine.ArchModel;
using Stemma.Engine.Validation;
using Xunit;

namespace Stemma.Engine.Tests;

/// <summary>
/// What a view draws (ADR-0026, F-023 AC1–AC3), against <see cref="C4Model"/>: the two C4 lenses with
/// their members, boundary and implied links, and views by list and by rule. The canvas, validate,
/// render and inspect all take this answer, so it is checked here once and exactly.
/// </summary>
public sealed class ViewProjectionTests
{
    private static readonly ArchModel.ArchModel Model = C4Model.Read();

    private static ViewResolution Resolve(ArchView view, ArchModel.ArchModel? model = null) => ViewProjection.Resolve(view, model ?? Model);

    private static ArchView View(string baseView, string? scope = null, IReadOnlyList<string>? elementIds = null,
        IReadOnlyList<string>? include = null, IReadOnlyList<string>? exclude = null) =>
        new("view_v", "V", baseView, elementIds ?? [], scope, include, exclude);

    [Fact]
    public void A_system_context_draws_the_system_and_the_people_and_systems_related_to_it_or_its_containers()
    {
        var view = Resolve(View("systemContext", "sys_shop"));

        // HR relates to the admin, not to the shop: not in its context.
        view.Members.Should().Equal("per_buyer", "per_admin", "sys_shop", "sys_payments", "sys_mail");
        view.Provenance.Values.Should().AllBe("lens");
        view.Problems.Should().BeEmpty();
    }

    [Fact]
    public void A_system_context_lifts_each_relationship_with_a_container_to_its_system_once_per_pair_and_direction()
    {
        var view = Resolve(View("systemContext", "sys_shop"));

        view.LinkIds.Should().Equal("rel_manage");
        view.Implied.Should().BeEquivalentTo(new[]
        {
            new ImpliedLink("__implied__per_buyer__sys_shop", "per_buyer", "sys_shop", ["flow_browse"]),
            new ImpliedLink("__implied__sys_shop__sys_payments", "sys_shop", "sys_payments", ["flow_pay", "flow_refund"]),
            new ImpliedLink("__implied__sys_shop__sys_mail", "sys_shop", "sys_mail", ["flow_notify"]),
            new ImpliedLink("__implied__sys_payments__sys_shop", "sys_payments", "sys_shop", ["flow_confirm"]),
        }, o => o.WithStrictOrdering());
        // Inside the shop, inside payments, and the module nothing lifts: none is a half-link. HR's
        // rota to the admin is, since the admin is drawn and HR is not.
        view.LeftOut.Should().Equal("flow_rota");
    }

    [Fact]
    public void A_container_view_draws_the_system_around_its_containers_and_what_relates_to_them()
    {
        var view = Resolve(View("container", "sys_shop"));

        view.Members.Should().Equal("per_buyer", "per_admin", "sys_shop", "sys_payments", "sys_mail", "cnt_web", "cnt_api", "cnt_db");
        view.LinkIds.Should().Equal("flow_browse", "flow_call", "flow_persist", "flow_notify", "rel_manage");
    }

    [Fact]
    public void A_container_view_draws_another_system_s_container_as_its_system()
    {
        var view = Resolve(View("container", "sys_shop"));

        view.Members.Should().NotContain(["cnt_gateway", "cnt_ledger"]);
        view.Implied.Should().BeEquivalentTo(new[]
        {
            new ImpliedLink("__implied__cnt_api__sys_payments", "cnt_api", "sys_payments", ["flow_pay", "flow_refund"]),
            new ImpliedLink("__implied__sys_payments__cnt_api", "sys_payments", "cnt_api", ["flow_confirm"]),
        }, o => o.WithStrictOrdering());
        view.LeftOut.Should().Equal("flow_rota", "dep_web_checkout");
    }

    [Fact]
    public void A_real_link_between_the_two_ends_is_drawn_instead_of_an_implied_one()
    {
        var model = C4Model.Read(C4Model.Source.Replace(
            "var uses = new Dependency(",
            "var status = new DataFlow(\"flow_status\", \"cnt_api\", \"sys_payments\", \"status\");\n        var uses = new Dependency(")
            .Replace("rota, uses);", "rota, status, uses);"));

        var view = Resolve(View("container", "sys_shop"), model);

        view.LinkIds.Should().Contain("flow_status");
        view.Implied.Should().ContainSingle().Which.Id.Should().Be("__implied__sys_payments__cnt_api");
        view.LeftOut.Should().NotContain(["flow_pay", "flow_refund"], "the real link says what they say");
    }

    [Fact]
    public void An_excluded_container_s_links_are_left_out_not_drawn_to_its_own_boundary()
    {
        var view = Resolve(View("container", "sys_shop", exclude: ["cnt_db"]));

        view.Members.Should().NotContain("cnt_db");
        view.Implied.Should().NotContain(i => i.ToId == "sys_shop" || i.FromId == "sys_shop");
        view.LeftOut.Should().Contain("flow_persist");
    }

    [Theory]
    [InlineData("systemContext", null, Severity.Error, "has no Scope")]
    [InlineData("container", "sys_gone", Severity.Error, "is not an element")]
    [InlineData("container", "cnt_api", Severity.Error, "is a Container, not a software system")]
    [InlineData("moduleMap", "sys_shop", Severity.Warning, "does not use")]
    public void A_scope_that_cannot_be_drawn_around_is_said_to_be(string lens, string? scope, Severity severity, string says)
    {
        var view = Resolve(View(lens, scope));

        var problem = view.Problems.Should().ContainSingle().Which;
        (problem.Rule, problem.Severity).Should().Be(("view/bad-scope", severity));
        problem.Message.Should().Contain(says);
        view.Members.Should().BeEmpty();
    }

    [Fact]
    public void Members_are_the_lens_then_the_list_then_the_includes_in_model_order_minus_the_excludes()
    {
        var view = Resolve(View("systemContext", "sys_shop",
            elementIds: ["cnt_ledger", "per_buyer"],
            include: ["kind:softwareSystem", "sys_shop.*"],
            exclude: ["sys_mail", "cnt_db"]));

        view.Members.Should().Equal("per_buyer", "per_admin", "sys_shop", "sys_payments", "cnt_ledger", "sys_hr", "cnt_web", "cnt_api");
        view.Provenance.Should().Equal(new Dictionary<string, string>
        {
            ["per_buyer"] = "lens", ["per_admin"] = "lens", ["sys_shop"] = "lens", ["sys_payments"] = "lens",
            ["cnt_ledger"] = "elementIds", ["sys_hr"] = "include:kind:softwareSystem",
            ["cnt_web"] = "include:sys_shop.*", ["cnt_api"] = "include:sys_shop.*",
        });
    }

    [Fact]
    public void A_view_by_list_alone_is_its_list_with_no_implied_links()
    {
        var view = Resolve(View("all", elementIds: ["cnt_api", "sys_payments", "cnt_web"]));

        view.Members.Should().Equal("cnt_api", "sys_payments", "cnt_web");
        view.Provenance.Values.Should().AllBe("elementIds");
        view.LinkIds.Should().Equal("flow_call");
        view.Implied.Should().BeEmpty("only the C4 lenses draw a container as its system");
        view.LeftOut.Should().Equal("flow_browse", "flow_persist", "flow_pay", "flow_refund", "flow_notify", "flow_confirm", "dep_web_checkout");
    }

    [Fact]
    public void Rules_and_members_that_name_nothing_are_problems_of_their_own()
    {
        var view = Resolve(View("all",
            elementIds: ["cnt_api", "cnt_gone"],
            include: ["sys_missing", "sys_hr.*", "*[technology=COBOL]", "sys_gone.*", "->nothing", "kind:", "sys shop"],
            exclude: ["per_gone", "*[kind="]));

        view.Problems.Select(p => (p.Rule, p.Severity, p.ElementId)).Should().Equal(
            ("view/dangling-member", Severity.Error, "cnt_gone"),
            ("view/dangling-include", Severity.Error, "sys_missing"),
            ("view/dangling-include", Severity.Warning, null),
            ("view/dangling-include", Severity.Warning, null),
            ("view/dangling-include", Severity.Error, "sys_gone"),
            ("view/dangling-include", Severity.Error, "nothing"),
            ("view/bad-selector", Severity.Error, null),
            ("view/bad-selector", Severity.Error, null),
            ("view/dangling-exclude", Severity.Warning, "per_gone"),
            ("view/bad-selector", Severity.Error, null));
        view.Problems.Where(p => p.Rule == "view/bad-selector").Select(p => p.Message).Should().SatisfyRespectively(
            m => m.Should().Contain("\"kind:\"").And.Contain("(character 6)"),
            m => m.Should().Contain("\"sys shop\"").And.Contain("(character 5)"),
            m => m.Should().Contain("excludes \"*[kind=\"").And.Contain("(character 8)"));
        view.Members.Should().Equal("cnt_api");
    }
}
