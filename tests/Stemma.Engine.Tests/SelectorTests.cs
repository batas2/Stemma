using FluentAssertions;
using Stemma.Engine.ArchModel;
using Xunit;

namespace Stemma.Engine.Tests;

/// <summary>
/// The selector language of ADR-0026, every form of it, against <see cref="C4Model"/>. A selector is
/// how a view says "the containers of the shop and whatever talks to them" instead of seventeen ids,
/// so what it selects has to be exactly what it says, and a selector that cannot be read has to say
/// where — an agent fixing it has nothing else to go on.
/// </summary>
public sealed class SelectorTests
{
    private static readonly ArchModel.ArchModel Model = C4Model.Read();

    private static IReadOnlyList<string> Select(string text)
    {
        Selector.TryParse(text, out var selector, out var error).Should().BeTrue(error?.Message);
        return selector!.Select(Model);
    }

    [Fact]
    public void A_star_selects_every_element_in_the_order_the_model_declares_them()
    {
        Select("*").Should().Equal(Model.Elements.Select(e => e.Id));
    }

    [Fact]
    public void An_id_selects_that_element_and_a_missing_one_selects_nothing_but_is_named()
    {
        Select("cnt_api").Should().Equal("cnt_api");

        Selector.TryParse("cnt_gone", out var missing, out _).Should().BeTrue();
        missing!.Select(Model).Should().BeEmpty();
        missing.NamedId.Should().Be("cnt_gone");
        missing.IsPlainId.Should().BeTrue();
    }

    [Fact]
    public void Children_are_a_system_s_containers_and_a_context_s_modules_and_capabilities()
    {
        Select("sys_shop.*").Should().Equal("cnt_web", "cnt_api", "cnt_db");
        Select("ctx_sales.*").Should().Equal("mod_checkout", "cap_quote");
        Select("cnt_api.*").Should().BeEmpty();
    }

    [Theory]
    [InlineData("kind:container")]
    [InlineData("kind:Container")]
    [InlineData("KIND:CONTAINER")]
    public void A_kind_matches_whatever_its_case(string text)
    {
        Select(text).Should().Equal("cnt_web", "cnt_api", "cnt_db", "cnt_gateway", "cnt_ledger");
    }

    [Fact]
    public void A_kind_written_in_camel_case_is_the_kind_it_names()
    {
        Select("kind:softwareSystem").Should().Equal("sys_shop", "sys_payments", "sys_mail", "sys_hr");
    }

    [Theory]
    [InlineData("kind:container[kind=db]", new[] { "cnt_db", "cnt_ledger" })]
    [InlineData("kind:container[kind!=db]", new[] { "cnt_web", "cnt_api", "cnt_gateway" })]
    [InlineData("kind:container[kind=db|spa]", new[] { "cnt_web", "cnt_db", "cnt_ledger" })]
    // A container written without its kind is a service, as the model's default says.
    [InlineData("kind:container[kind=service]", new[] { "cnt_api", "cnt_gateway" })]
    [InlineData("kind:person[role=user]", new[] { "per_admin" })]
    // Attribute names and values compare whatever their case.
    [InlineData("*[Technology=postgresql]", new[] { "cnt_db" })]
    [InlineData("*[systemId=SYS_PAYMENTS]", new[] { "cnt_gateway", "cnt_ledger" })]
    // Lifecycle and ownership, from the tags.
    [InlineData("*[status=current]", new[] { "cnt_api" })]
    [InlineData("kind:container[status!=deprecated]", new[] { "cnt_web", "cnt_api", "cnt_db", "cnt_gateway" })]
    [InlineData("*[squad=sell]", new[] { "cnt_api" })]
    // Filters narrow one another; an attribute nothing has never equals anything.
    [InlineData("sys_shop.*[kind=spa][technology=React]", new[] { "cnt_web" })]
    [InlineData("*[nonsense=x]", new string[0])]
    [InlineData("*[name=order store]", new[] { "cnt_db" })]
    public void Filters_keep_what_an_attribute_says(string text, string[] expected)
    {
        Select(text).Should().Equal(expected);
    }

    [Fact]
    public void Neighbours_are_what_relates_to_an_element_what_it_relates_to_or_both()
    {
        // Over links of any kind: a dependency counts as a relationship as much as a flow.
        Select("->cnt_api").Should().Equal("cnt_web", "cnt_api", "cnt_gateway");
        Select("cnt_api->").Should().Equal("sys_mail", "cnt_api", "cnt_db", "cnt_gateway");
        Select("->cnt_api->").Should().Equal("sys_mail", "cnt_web", "cnt_api", "cnt_db", "cnt_gateway");
        Select("cnt_web->").Should().Equal("cnt_web", "cnt_api", "mod_checkout");
    }

    [Fact]
    public void A_filter_inside_a_neighbourhood_narrows_the_centre_not_the_neighbours()
    {
        Select("->kind:container[kind=db]").Should().Equal("cnt_api", "cnt_db", "cnt_gateway", "cnt_ledger");
    }

    [Fact]
    public void Spaces_around_the_parts_are_allowed()
    {
        Select("  -> cnt_api  ").Should().Equal("cnt_web", "cnt_api", "cnt_gateway");
        Select("kind:container [ kind = db | spa ]").Should().Equal("cnt_web", "cnt_db", "cnt_ledger");
    }

    [Theory]
    [InlineData("", 1, "expected an id")]
    [InlineData("kind:", 6, "expected a kind")]
    [InlineData("kind:widget", 6, "unknown kind 'widget'")]
    [InlineData("*[kind=db", 2, "never closed")]
    [InlineData("*[=db]", 3, "expected an attribute name")]
    [InlineData("*[kind db]", 8, "expected = or !=")]
    [InlineData("*[kind=]", 8, "expected a value")]
    [InlineData("*[kind=db|]", 11, "expected a value")]
    [InlineData("sys shop", 5, "unexpected 's'")]
    [InlineData("->", 3, "expected an id")]
    [InlineData("cnt_api->cnt_db", 10, "unexpected 'c'")]
    [InlineData("sys_shop .*", 10, "unexpected '.'")]
    [InlineData("#tag", 1, "unexpected '#'")]
    public void A_selector_that_cannot_be_read_says_what_is_wrong_and_where(string text, int position, string says)
    {
        Selector.TryParse(text, out _, out var error).Should().BeFalse();

        error!.Position.Should().Be(position);
        error.Message.Should().Contain(says);
    }

    [Theory]
    [InlineData("->cnt_api", 1)]
    [InlineData("cnt_api->", 8)]
    public void Neighbourhoods_are_refused_where_they_mean_nothing(string text, int position)
    {
        Selector.TryParse(text, out _, out var error, allowNeighbours: false).Should().BeFalse();

        error!.Position.Should().Be(position);
        error.Message.Should().Contain("->");
    }

    [Theory]
    [InlineData("cnt_api", true, "cnt_api")]
    [InlineData("sys_shop.*", false, "sys_shop")]
    [InlineData("->cnt_api", false, "cnt_api")]
    [InlineData("cnt_api[kind=db]", false, "cnt_api")]
    [InlineData("*", false, null)]
    [InlineData("kind:person", false, null)]
    public void A_selector_says_which_id_it_names_and_whether_that_is_all_it_is(string text, bool plain, string? named)
    {
        Selector.TryParse(text, out var selector, out _).Should().BeTrue();

        selector!.IsPlainId.Should().Be(plain);
        selector.NamedId.Should().Be(named);
    }

    [Theory]
    [InlineData("link:dataFlow", new[] { "flow_browse", "flow_call", "flow_persist", "flow_pay", "flow_refund", "flow_settle", "flow_notify", "flow_confirm", "flow_rota" })]
    [InlineData("link:DATAFLOW[technology=https/json]", new[] { "flow_call" })]
    [InlineData("link:dataFlow[label=order|payment]", new[] { "flow_persist", "flow_pay" })]
    [InlineData("link:dataFlow[technology!=HTTPS/JSON][direction=oneway]", new[] { "flow_browse", "flow_persist", "flow_pay", "flow_refund", "flow_settle", "flow_notify", "flow_confirm", "flow_rota" })]
    [InlineData("link:dependency[kind=uses]", new[] { "dep_web_checkout" })]
    [InlineData("link:dependency[label=uses]", new[] { "dep_web_checkout" })]
    public void Where_links_are_asked_for_a_link_selector_selects_links_by_their_arguments_and_defaults(string text, string[] expected)
    {
        Selector.TryParse(text, out var selector, out var error, allowNeighbours: false, allowLinks: true).Should().BeTrue(error?.Message);

        selector!.IsLinkSelector.Should().BeTrue();
        selector.SelectLinks(Model).Select(l => l.Id).Should().Equal(expected);
        selector.Select(Model).Should().BeEmpty("a link selector selects no elements");
        selector.NamedId.Should().BeNull();
    }

    [Fact]
    public void A_link_selector_reads_a_link_s_tags()
    {
        var model = C4Model.Read(C4Model.Source.Replace("Tag.For(ledger,", "Tag.For(pay, lifecycle: new Lifecycle(Status: \"target\"));\n Tag.For(ledger,"));
        Selector.TryParse("link:dataFlow[status=target]", out var selector, out _, allowNeighbours: false, allowLinks: true).Should().BeTrue();

        selector!.SelectLinks(model).Select(l => l.Id).Should().Equal("flow_pay");
    }

    [Fact]
    public void Where_links_are_not_asked_for_link_x_is_an_id_as_it_always_was()
    {
        Selector.TryParse("link:dataFlow", out var selector, out _).Should().BeTrue();

        selector!.IsLinkSelector.Should().BeFalse();
        selector.NamedId.Should().Be("link:dataFlow");
    }

    [Theory]
    [InlineData("link:", 6, "expected a link kind")]
    [InlineData("link:flow", 6, "unknown link kind 'flow'")]
    [InlineData("link:relation", 6, "a relation claims nothing")]
    [InlineData("link:dataFlow[payload=order", 14, "never closed")]
    [InlineData("link:dataFlow->", 14, "unexpected '-'")]
    public void A_link_selector_that_cannot_be_read_says_what_is_wrong_and_where(string text, int position, string says)
    {
        Selector.TryParse(text, out _, out var error, allowNeighbours: false, allowLinks: true).Should().BeFalse();

        error!.Position.Should().Be(position);
        error.Message.Should().Contain(says);
    }

    [Fact]
    public void An_id_with_a_hyphen_or_a_dot_is_still_one_id()
    {
        var model = C4Model.Read(C4Model.Source.Replace("\"cnt_web\"", "\"order-web.v2\""));
        Selector.TryParse("order-web.v2->", out var selector, out _).Should().BeTrue();

        selector!.Select(model).Should().Equal("order-web.v2", "cnt_api", "mod_checkout");
    }
}
