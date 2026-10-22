using FluentAssertions;
using Microsoft.CodeAnalysis.CSharp;
using Stemma.Engine.Validation;
using Stemma.Engine.Workspace;
using Xunit;

namespace Stemma.Engine.Tests;

/// <summary>
/// What each rule kind says (F-024 AC2), on <see cref="C4Model"/>: every rule against a model written to
/// break it and one written not to, run the way the canvas and validate run them — through the
/// <see cref="RuleEngine"/>, beside the built-in rules.
/// </summary>
public sealed class DeclaredRuleEvaluatorTests
{
    private static readonly string Root = Path.Combine(Path.GetTempPath(), "stemma-evaluator");

    private static DeclaredRules Declare(string body) =>
        DeclaredRules.ReadFrom(Root, [(Path.Combine(Root, "Rules", "Probe.cs"), CSharpSyntaxTree.ParseText($$"""
            using Stemma.Model;
            public static class Probe
            {
                public static RuleSet Define() => RuleSet.Of(
            {{body}});
            }
            """).GetRoot())]);

    /// <summary>The workspace's rules alone, over <paramref name="model"/> — the built-in ones have their own tests.</summary>
    private static IReadOnlyList<Violation> Run(string body, ArchModel.ArchModel? model = null)
    {
        var declared = Declare(body);
        return new RuleEngine(WorkspaceRules.For(Root, declared), RulesConfig.Empty).Run(model ?? C4Model.Read());
    }

    /// <summary>An element's name in the test model, as a violation says it.</summary>
    private static string Name(string id) => C4Model.Read().Elements.Single(e => e.Id == id).Name;

    [Fact]
    public void Forbid_reports_each_relationship_from_what_from_selects_to_what_to_selects()
    {
        var violation = Run("""Rule.Forbid("rule_spa", from: "kind:container[kind=spa]", to: "kind:container[kind=service]", because: "The shop talks to its API through the gateway")""")
            .Should().ContainSingle().Subject;

        violation.RuleId.Should().Be("rule_spa");
        violation.Severity.Should().Be(Severity.Error);
        violation.ElementIds.Should().Equal("cnt_web", "cnt_api");
        violation.LinkIds.Should().Equal("flow_call");
        // Said for the room: the elements by name, the link by id, then why it matters.
        violation.Message.Should().Be(
            $"{Name("cnt_web")} → {Name("cnt_api")} (flow_call) is not allowed — The shop talks to its API through the gateway");

        Run("""Rule.Forbid("rule_spa_db", from: "kind:container[kind=spa]", to: "kind:container[kind=db]")""").Should().BeEmpty();
    }

    [Fact]
    public void Only_reports_each_relationship_into_what_to_selects_from_anything_else()
    {
        var violations = Run("""Rule.Only("rule_api", from: "cnt_gateway", to: "cnt_api", because: "Only payments calls back")""");

        violations.Should().ContainSingle().Which.Should().BeEquivalentTo(new
        {
            RuleId = "rule_api",
            ElementIds = new[] { "cnt_web", "cnt_api" },
            LinkIds = new[] { "flow_call" },
        });
        violations[0].Message.Should().Be($"{Name("cnt_web")} → {Name("cnt_api")} (flow_call) is not allowed — Only payments calls back");
        Run("""Rule.Only("rule_api_bare", from: "cnt_gateway", to: "cnt_api")""")[0].Message
            .Should().EndWith("is not allowed: only what \"cnt_gateway\" selects may relate to what \"cnt_api\" selects", "with no because, the rule says what it is");

        Run("""Rule.Only("rule_gateway", from: "cnt_api", to: "cnt_gateway")""").Should().BeEmpty("only the API calls the gateway");
    }

    [Fact]
    public void Layers_report_a_relationship_that_goes_up_and_let_one_go_down_or_sideways()
    {
        Run("""
                Rule.Layers("rule_down", ["kind:person", "kind:container[kind=spa]", "kind:container[kind=service]", "kind:container[kind=db]"])
        """).Should().BeEmpty("every relationship goes down a layer or stays in one, and the systems are in none");

        var violations = Run("""
                Rule.Layers("rule_up", ["kind:container[kind=db]", "kind:container[kind=service]"], because: "Data on top")
        """);

        violations.Select(v => v.LinkIds.Single()).Should().Equal("flow_persist", "flow_settle");
        violations[0].Message.Should().Be($"{Name("cnt_api")} → {Name("cnt_db")} (flow_persist) goes up the layers, from layer 2 to layer 1 — Data on top");
    }

    [Fact]
    public void An_element_is_in_the_first_layer_that_selects_it()
    {
        // The gateway is a service, so the second layer would take it too, and the API's calls to it
        // would be sideways. The first takes it, so they go up.
        Run("""
                Rule.Layers("rule_first", ["cnt_gateway", "kind:container[kind=service]"])
        """).Select(v => v.LinkIds.Single()).Should().Equal("flow_pay", "flow_refund");
    }

    [Fact]
    public void Require_reports_each_element_without_the_attribute_read_with_tags_and_defaults()
    {
        var violations = Run("""Rule.Require("rule_tech", of: "kind:container", has: "technology", because: "Ops needs to know")""");

        violations.Select(v => v.ElementIds.Single()).Should().Equal("cnt_gateway", "cnt_ledger");
        violations.Should().OnlyContain(v => v.Severity == Severity.Warning && v.LinkIds.Count == 0);
        violations[0].Message.Should().Be($"{Name("cnt_gateway")} (cnt_gateway) has no technology — Ops needs to know");

        Run("""
                Rule.Require("rule_shop_tech", of: "sys_shop.*", has: "technology"),
                Rule.Require("rule_squad", of: "cnt_api", has: "squad"),
                Rule.Require("rule_status", of: "cnt_ledger", has: "status"),
                Rule.Require("rule_kind", of: "kind:container", has: "kind")
        """).Should().BeEmpty("the shop's containers have a technology, the API a squad, the ledger a status, and a container's kind defaults to service");
    }

    [Fact]
    public void Require_over_links_reports_each_link_without_the_attribute()
    {
        var violations = Run("""Rule.Require("rule_flow_tech", of: "link:dataFlow[label=order|payment]", has: "technology")""");

        violations.Should().HaveCount(2);
        violations[0].Should().BeEquivalentTo(new { LinkIds = new[] { "flow_persist" }, ElementIds = new[] { "cnt_api", "cnt_db" } });
        violations[0].Message.Should().Be($"{Name("cnt_api")} → {Name("cnt_db")} (flow_persist) has no technology: every \"link:dataFlow[label=order|payment]\" must have one");

        Run("""Rule.Require("rule_call_tech", of: "link:dataFlow[payload=orders]", has: "technology")""").Should().BeEmpty();
        Run("""Rule.Require("rule_dep_kind", of: "link:dependency", has: "kind")""").Should().BeEmpty("a dependency's kind defaults to uses");
    }

    [Fact]
    public void Via_narrows_the_relationships_a_rule_considers()
    {
        const string forbid = """Rule.Forbid("rule_web_checkout", from: "cnt_web", to: "mod_checkout"{0})""";

        Run(string.Format(forbid, "")).Select(v => v.LinkIds.Single()).Should().Equal("dep_web_checkout");
        Run(string.Format(forbid, ", via: \"dependency\"")).Should().ContainSingle();
        Run(string.Format(forbid, ", via: \"dataFlow\"")).Should().BeEmpty();
    }

    [Fact]
    public void A_relation_claims_nothing_and_is_never_checked()
    {
        Run("""
                Rule.Forbid("rule_admin", from: "per_admin", to: "sys_shop"),
                Rule.Layers("rule_layers", ["sys_shop", "per_admin"])
        """).Should().BeEmpty("rel_manage is a Relation, and the rota flows from HR, which no rule names");
    }

    [Fact]
    public void A_rule_s_severity_is_the_severity_of_its_violations()
    {
        Run("""Rule.Forbid("rule_spa", "kind:container[kind=spa]", "kind:container[kind=service]", severity: "info")""")
            .Should().ContainSingle().Which.Severity.Should().Be(Severity.Info);
        Run("""Rule.Require("rule_tech", "kind:container", "technology", severity: "error")""")
            .Should().OnlyContain(v => v.Severity == Severity.Error);
    }

    [Fact]
    public void A_two_way_flow_is_one_relationship_from_where_it_is_written_from()
    {
        var model = C4Model.Read(C4Model.Source.Replace("\"cnt_api\", \"cnt_db\", \"order\"", "\"cnt_api\", \"cnt_db\", \"order\", \"twoway\""));

        Run("""Rule.Forbid("rule_db_api", from: "cnt_db", to: "cnt_api")""", model).Should().BeEmpty();
        Run("""Rule.Forbid("rule_api_db", from: "cnt_api", to: "cnt_db")""", model).Should().ContainSingle();
    }

    [Fact]
    public void An_id_a_rule_or_the_code_map_names_that_is_not_an_element_is_a_dangling_id()
    {
        var violations = Run("""
                Rule.Only("rule_pay", from: "cnt_ap", to: "sys_payments"),
                Rule.Layers("rule_layers", ["kind:person", "sys_gone.*"]),
                Code.Map("cnt_gone", "src/Gone")
        """).Where(v => v.RuleId == DeclaredRules.DanglingId).Select(v => v.Message).ToList();

        violations.Should().HaveCount(3);
        violations[0].Should().Be("Rules/Probe.cs:5: the from of Rule.Only(\"rule_pay\") names 'cnt_ap', which is not an element, so the rule checks nothing there");
        violations[1].Should().Contain("the layer 2 of Rule.Layers(\"rule_layers\") names 'sys_gone'");
        violations[2].Should().Be("Rules/Probe.cs:7: Code.Map names 'cnt_gone', which is not an element, so its code is compared with nothing");
    }

    [Fact]
    public void A_mistake_in_a_rules_file_is_a_violation_of_its_own()
    {
        var violations = Run("""
                Rule.Forbid("rule_a", "kind:contaner", "b"),
                Rule.Use("c5")
        """);

        violations.Select(v => v.RuleId).Should().Equal(DeclaredRules.BadSelector, DeclaredRules.Unknown);
        violations.Should().OnlyContain(v => v.Severity == Severity.Error && v.ElementIds.Count == 0);
    }

    [Fact]
    public void The_C4_pack_is_checked_only_when_a_rules_file_turns_it_on()
    {
        Run("""Rule.Forbid("rule_none", "per_buyer", "cnt_db")""").Should().BeEmpty();

        var violations = Run("""Rule.Use("c4")""");

        violations.Where(v => v.RuleId == "c4/container-technology").Select(v => v.ElementIds.Single())
            .Should().Equal("cnt_gateway", "cnt_ledger");
        violations.Where(v => v.RuleId == "c4/container-technology").Should().OnlyContain(v => v.Severity == Severity.Warning);
        violations.Where(v => v.RuleId == "c4/described").Select(v => v.ElementIds.Single())
            .Should().Equal("per_buyer", "per_admin", "sys_payments", "sys_mail", "sys_hr", "cnt_web", "cnt_api", "cnt_db", "cnt_gateway", "cnt_ledger");
        violations.Where(v => v.RuleId == "c4/described").Should().OnlyContain(v => v.Severity == Severity.Info);
        violations.Where(v => v.RuleId == "c4/flow-technology").Select(v => v.LinkIds.Single())
            .Should().Equal(["flow_persist", "flow_pay", "flow_refund", "flow_settle", "flow_notify", "flow_confirm"],
                "a flow from or to a person is not asked for a technology");
        violations.Where(v => v.RuleId == "c4/flow-labelled").Should().BeEmpty();
        violations.Single(v => v.RuleId == "c4/described" && v.ElementIds[0] == "sys_hr").Message
            .Should().Be("software system sys_hr has no description; a C4 software system says in a sentence what it is (Description: \"…\")");
    }

    [Fact]
    public void A_flow_without_a_payload_is_unlabelled()
    {
        var model = C4Model.Read(C4Model.Source.Replace("\"cnt_gateway\", \"cnt_ledger\", \"entry\"", "\"cnt_gateway\", \"cnt_ledger\", \"\""));

        Run("""Rule.Use("c4")""", model).Where(v => v.RuleId == "c4/flow-labelled")
            .Should().ContainSingle().Which.Should().BeEquivalentTo(new { Severity = Severity.Warning, LinkIds = new[] { "flow_settle" } });
    }

    [Fact]
    public void A_model_written_the_C4_way_passes_the_pack()
    {
        var model = C4Model.Read("""
            using Stemma.Model;
            public static class Architecture
            {
                public static Model Build()
                {
                    var buyer = new Person("per_buyer", "Buyer", Description: "Buys things");
                    var shop = new SoftwareSystem("sys_shop", "Shop", "Where orders are placed");
                    var web = new Container("cnt_web", "Web", "sys_shop", "spa", "React", "The storefront");
                    var api = new Container("cnt_api", "API", "sys_shop", "service", ".NET 8", "Takes orders");
                    var browse = new DataFlow("flow_browse", "per_buyer", "cnt_web", "browses");
                    var call = new DataFlow("flow_call", "cnt_web", "cnt_api", "orders", Technology: "HTTPS/JSON");
                    return Model.Of(buyer, shop, web, api, browse, call);
                }
            }
            """);

        Run("""Rule.Use("c4")""", model).Should().BeEmpty();
    }

    [Fact]
    public void Stemma_rules_json_switches_a_declared_rule_off_or_changes_its_severity_by_its_id()
    {
        var root = Directory.CreateDirectory(Path.Combine(Path.GetTempPath(), $"stemma-rules-json-{Guid.NewGuid():N}")).FullName;
        try
        {
            Directory.CreateDirectory(Path.Combine(root, "Rules"));
            File.WriteAllText(Path.Combine(root, "Rules", "Probe.cs"), """
                using Stemma.Model;
                public static class Probe
                {
                    public static RuleSet Define() => RuleSet.Of(
                        Rule.Use("c4"),
                        Rule.Forbid("rule_spa", "kind:container[kind=spa]", "kind:container[kind=service]"),
                        Rule.Require("rule_tech", "kind:container", "technology"));
                }
                """);
            File.WriteAllText(Path.Combine(root, "stemma.rules.json"), """
                { "rules": { "rule_spa": { "severity": "info" }, "rule_tech": { "enabled": false }, "c4/described": { "enabled": false } } }
                """);

            var violations = RuleEngine.Default(root).Run(C4Model.Read());

            violations.Should().ContainSingle(v => v.RuleId == "rule_spa").Which.Severity.Should().Be(Severity.Info);
            violations.Should().NotContain(v => v.RuleId == "rule_tech" || v.RuleId == "c4/described");
            violations.Should().Contain(v => v.RuleId == "c4/container-technology", "the rest of the pack is still on");
        }
        finally { Directory.Delete(root, recursive: true); }
    }

    [Fact]
    public async Task A_rules_file_changed_on_disk_changes_what_the_engine_reports()
    {
        var root = Path.Combine(Path.GetTempPath(), $"stemma-rules-live-{Guid.NewGuid():N}");
        Directory.CreateDirectory(Path.Combine(root, "Architecture"));
        Directory.CreateDirectory(Path.Combine(root, "Rules"));
        File.WriteAllText(Path.Combine(root, "Architecture", "Architecture.cs"), C4Model.Source);
        var rulesFile = Path.Combine(root, "Rules", "Probe.cs");
        void WriteRules(string rule) => File.WriteAllText(rulesFile, $$"""
            using Stemma.Model;
            public static class Probe
            {
                public static RuleSet Define() => RuleSet.Of({{rule}});
            }
            """);
        try
        {
            WriteRules("""Rule.Forbid("rule_spa", "kind:container[kind=spa]", "kind:container[kind=service]")""");
            await using (var engine = await StemmaEngine.OpenAsync(root))
            {
                (await engine.RunValidationAsync())
                    .Should().ContainSingle(v => v.RuleId == "rule_spa").Which.LinkIds.Should().Equal("flow_call");

                // Saved by an editor outside Stemma, with no watcher running: the next poll sees it.
                WriteRules("""Rule.Only("rule_gateway_only", from: "cnt_gateway", to: "cnt_api", because: "Payments calls back")""");

                var after = await engine.RunValidationAsync();
                after.Should().NotContain(v => v.RuleId == "rule_spa");
                after.Should().ContainSingle(v => v.RuleId == "rule_gateway_only").Which.Message.Should().EndWith("— Payments calls back");
            }
        }
        finally { Directory.Delete(root, recursive: true); }
    }
}
