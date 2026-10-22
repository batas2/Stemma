using System.Reflection;
using FluentAssertions;
using Stemma.Engine.ArchModel;
using Stemma.Engine.Validation;
using Xunit;

namespace Stemma.Engine.Tests;

/// <summary>
/// Rules are read off the syntax tree of the files in a Rules folder, never run (ADR-0028). These hold
/// the reader to every way a rule is written, and to its promise that a rule it cannot read is said to
/// be unread — a rule silently skipped is a constraint the architect believes is checked and is not.
/// </summary>
public sealed class DeclaredRulesReaderTests : IDisposable
{
    private readonly string _root = Directory.CreateDirectory(
        Path.Combine(Path.GetTempPath(), $"stemma-rules-{Guid.NewGuid():N}")).FullName;

    public void Dispose() => Directory.Delete(_root, recursive: true);

    private void Write(string relative, string content)
    {
        var path = Path.Combine(_root, relative);
        Directory.CreateDirectory(Path.GetDirectoryName(path)!);
        File.WriteAllText(path, content);
    }

    private void Rules(string body, string file = "Rules/Platform.cs") => Write(file, $$"""
        using Stemma.Model;
        namespace Probe;
        public static class Platform
        {
            public static RuleSet Define() => RuleSet.Of(
        {{body}});
        }
        """);

    private DeclaredRules Read() => DeclaredRules.Read(_root);

    [Fact]
    public void Every_rule_kind_is_read_positional_or_named()
    {
        Rules("""
                Rule.Use("c4"),
                Rule.Forbid("rule_a", "kind:container[kind=spa]", "kind:container[kind=db]", "Through the API", "dataFlow", "warning"),
                Rule.Only("rule_b", from: "cnt_pay", to: "sys_stripe", because: "PCI", severity: "info"),
                Rule.Layers("rule_c", ["kind:person", "kind:container"], via: "dependency"),
                Rule.Require("rule_d", of: "link:dataFlow", has: "technology"),
                Rule.Require(has: "squad", id: "rule_e", of: "kind:container")
        """);

        var read = Read();

        read.Problems.Should().BeEmpty();
        read.Files.Should().Equal("Rules/Platform.cs");
        read.Packs.Should().ContainSingle().Which.Pack.Should().Be("c4");
        read.Rules.Should().HaveCount(5);
        read.Rules[0].Should().BeEquivalentTo(new
        {
            Kind = DeclaredRuleKind.Forbid, Id = "rule_a", From = "kind:container[kind=spa]", To = "kind:container[kind=db]",
            Because = "Through the API", Via = (ArchLinkKind?)ArchLinkKind.DataFlow, Severity = Severity.Warning, File = "Rules/Platform.cs",
        });
        read.Rules[1].Should().BeEquivalentTo(new { Kind = DeclaredRuleKind.Only, From = "cnt_pay", To = "sys_stripe", Because = "PCI", Via = (ArchLinkKind?)null, Severity = Severity.Info });
        read.Rules[2].Should().BeEquivalentTo(new { Kind = DeclaredRuleKind.Layers, Layers = new[] { "kind:person", "kind:container" }, Via = (ArchLinkKind?)ArchLinkKind.Dependency, Severity = Severity.Error });
        read.Rules[3].Should().BeEquivalentTo(new { Kind = DeclaredRuleKind.Require, Of = "link:dataFlow", Has = "technology", Severity = Severity.Warning });
        read.Rules[4].Should().BeEquivalentTo(new { Id = "rule_e", Of = "kind:container", Has = "squad" });
    }

    [Fact]
    public void Layers_are_read_from_every_way_of_writing_a_list_and_arguments_from_constants()
    {
        Write("Rules/Layering.cs", """
            using Stemma.Model;
            namespace Probe;
            public static class Layering
            {
                private const string Top = "kind:person";
                private const string Reason = "Requests flow " + "down";

                public static RuleSet Define() => RuleSet.Of(
                    Rule.Layers("rule_new", new[] { Top, "kind:container" }, Reason),
                    Rule.Layers("rule_typed", new string[] { "kind:person", $"kind:{"container"}" }),
                    Rule.Layers("rule_collection", [
                        "kind:person",
                        "kind:container",
                    ]));
            }
            """);

        var read = Read();

        read.Problems.Should().BeEmpty();
        read.Rules.Select(r => r.Layers).Should().AllBeEquivalentTo(new[] { "kind:person", "kind:container" });
        read.Rules[0].Because.Should().Be("Requests flow down");
    }

    [Fact]
    public void The_code_map_is_read_with_the_rules()
    {
        Rules("""
                Code.At("../src"),
                Code.Map("cnt_api", "Shop.Api/Shop.Api.csproj"),
                Code.Map(id: "cnt_worker", path: "Shop.Worker")
        """);

        var read = Read();

        read.Problems.Should().BeEmpty();
        read.CodeRoots.Should().ContainSingle().Which.Path.Should().Be("../src");
        read.CodeMaps.Select(m => (m.ElementId, m.Path)).Should().Equal(("cnt_api", "Shop.Api/Shop.Api.csproj"), ("cnt_worker", "Shop.Worker"));
    }

    [Fact]
    public void Only_files_in_a_Rules_folder_inside_the_workspace_are_rules_files()
    {
        Rules("""Rule.Use("c4")""", "Rules/Top.cs");
        Rules("""Rule.Use("c4")""", "src/Rules/Nested.cs");
        Rules("""Rule.Forbid("rule_view", "a", "b")""", "Views/NotRules.cs");
        Rules("""Rule.Forbid("rule_model", "a", "b")""", "Architecture/Architecture.cs");
        Rules("""Rule.Forbid("rule_obj", "a", "b")""", "obj/Rules/Stale.cs");
        Rules("""Rule.Forbid("rule_dot", "a", "b")""", ".git/Rules/Hidden.cs");

        var read = Read();

        read.Files.Should().Equal("Rules/Top.cs", "src/Rules/Nested.cs");
        read.Rules.Should().BeEmpty();

        // A workspace kept in ~/Rules/shop: the folder above it does not make its files rules files.
        var shop = Path.Combine(Path.GetTempPath(), "Rules", "shop");
        DeclaredRules.IsRulesFile(shop, Path.Combine(shop, "Architecture", "Architecture.cs")).Should().BeFalse();
        DeclaredRules.IsRulesFile(shop, Path.Combine(shop, "Rules", "Platform.cs")).Should().BeTrue();
        DeclaredRules.IsRulesFile(shop, Path.Combine(Path.GetTempPath(), "Rules", "Other.cs")).Should().BeFalse();
    }

    [Fact]
    public void A_workspace_without_rules_declares_nothing()
    {
        Write("Architecture/Architecture.cs", "public static class Architecture { }");
        Read().Should().BeSameAs(DeclaredRules.None);
    }

    [Fact]
    public void An_argument_that_is_not_a_literal_or_a_constant_is_unreadable_and_the_rule_is_not_checked()
    {
        Rules("""
                Rule.Forbid(Ids.Next(), "a", "b"),
                Rule.Only("rule_only", Selectors.Apps, "b"),
                Rule.Layers("rule_layers", Layering.All),
                Rule.Layers("rule_item", ["kind:person", Layering.Bottom()]),
                Rule.Use(Packs.C4)
        """);

        var read = Read();

        read.Rules.Should().BeEmpty();
        read.Packs.Should().BeEmpty();
        var problems = read.Problems.Should().HaveCount(5).And.OnlyContain(p => p.Rule == DeclaredRules.Unreadable && p.Severity == Severity.Error).And.Subject.ToList();
        problems[0].Message.Should().StartWith("Rules/Platform.cs:6: the id of Rule.Forbid is written as `Ids.Next()`");
        problems[1].Message.Should().Contain("the from of Rule.Only(\"rule_only\") is written as `Selectors.Apps`");
        problems[2].Message.Should().Contain("the layers of Rule.Layers(\"rule_layers\") are written as `Layering.All`");
        problems[3].Message.Should().Contain("the layers of Rule.Layers(\"rule_item\")");
        problems[4].Message.Should().Contain("the pack of Rule.Use is written as `Packs.C4`");
        problems.Should().OnlyContain(p => p.Message.Contains("not checked") || p.Message.Contains("not checked."));
    }

    [Fact]
    public void An_unreadable_because_keeps_the_rule_and_is_a_warning()
    {
        Rules("""Rule.Forbid("rule_a", "a", "b", because: Reasons.Pci())""");

        var read = Read();

        read.Rules.Should().ContainSingle().Which.Because.Should().BeNull();
        read.Problems.Should().ContainSingle(p => p.Rule == DeclaredRules.Unreadable && p.Severity == Severity.Warning)
            .Which.Message.Should().Contain("give no reason");
    }

    [Fact]
    public void A_missing_argument_and_a_rule_built_by_hand_are_unreadable()
    {
        Rules("""
                Rule.Forbid("rule_a", from: "a"),
                new ArchitectureRule(ArchitectureRuleKind.Forbid, "rule_b", "a", "b")
        """);

        var read = Read();

        read.Rules.Should().BeEmpty();
        read.Problems.Select(p => p.Message).Should().Contain(m => m.Contains("Rule.Forbid(\"rule_a\") has no to"))
            .And.Contain(m => m.Contains("this ArchitectureRule is constructed directly"));
    }

    [Fact]
    public void A_selector_that_cannot_be_read_is_a_bad_selector_with_the_character_where_it_goes_wrong()
    {
        Rules("""
                Rule.Forbid("rule_kind", "kind:contaner", "b"),
                Rule.Forbid("rule_neighbours", "->cnt_api", "b"),
                Rule.Only("rule_link", "a", "link:dataFlow"),
                Rule.Layers("rule_layer", ["kind:person", "kind:container[kind=db"]),
                Rule.Require("rule_relation", "link:relation", "label")
        """);

        var read = Read();

        read.Rules.Should().BeEmpty();
        var messages = read.Problems.Should().HaveCount(5).And.OnlyContain(p => p.Rule == DeclaredRules.BadSelector).And.Subject.Select(p => p.Message).ToList();
        messages[0].Should().Contain("the from of Rule.Forbid(\"rule_kind\"), \"kind:contaner\", is not a selector: unknown kind 'contaner'").And.Contain("(character 6)");
        messages[1].Should().Contain("-> is not allowed here").And.Contain("(character 1)");
        messages[2].Should().Contain("selects links, which only a Require's of may");
        messages[3].Should().Contain("the layer 2 of Rule.Layers(\"rule_layer\")").And.Contain("never closed");
        messages[4].Should().Contain("a relation claims nothing");
    }

    [Fact]
    public void What_Stemma_does_not_know_is_unknown()
    {
        Rules("""
                Rule.Allow("rule_a", "a", "b"),
                Rule.Use("c5"),
                Rule.Forbid("rule_via", "a", "b", via: "calls"),
                Rule.Forbid("rule_severity", "a", "b", severity: "fatal"),
                Rule.Require("rule_has", "kind:container", "ownr"),
                Rule.Require("rule_link_has", "link:dataFlow", "squadron"),
                Rule.Forbid("rule_param", "a", "b", becuse: "typo"),
                Code.Place("cnt_a", "src")
        """);

        var read = Read();

        read.Rules.Should().BeEmpty();
        read.Packs.Should().BeEmpty();
        var messages = read.Problems.Should().HaveCount(8).And.OnlyContain(p => p.Rule == DeclaredRules.Unknown).And.Subject.Select(p => p.Message).ToList();
        messages[0].Should().Contain("Rule.Allow is not something Stemma knows (known: Rule.Forbid, Rule.Only, Rule.Layers, Rule.Require, Rule.Use)");
        messages[1].Should().Contain("Rule.Use(\"c5\") names no pack Stemma has (known: c4)");
        messages[2].Should().Contain("via \"calls\", which is not dataFlow or dependency");
        messages[3].Should().Contain("severity \"fatal\", which is not error, warning or info");
        messages[4].Should().Contain("requires \"ownr\", which no element has");
        messages[5].Should().Contain("requires \"squadron\", which no link has");
        messages[6].Should().Contain("Rule.Forbid has no parameter 'becuse'");
        messages[7].Should().Contain("Code.Place is not something Stemma knows (known: Code.At, Code.Map)");
    }

    [Fact]
    public void An_id_declared_twice_or_taken_by_a_built_in_rule_and_a_second_Code_At_are_duplicates()
    {
        Rules("""
                Rule.Forbid("rule_a", "a", "b"),
                Rule.Forbid("no-circular-dataflows", "a", "b"),
                Code.At("../src")
        """, "Rules/One.cs");
        Rules("""
                Rule.Only("rule_a", "a", "b"),
                Code.At("../lib")
        """, "Rules/Two.cs");

        var read = Read();

        read.Rules.Should().HaveCount(3, "a duplicate is still checked; it is the id that cannot be told apart");
        var messages = read.Problems.Should().HaveCount(3).And.OnlyContain(p => p.Rule == DeclaredRules.DuplicateId).And.Subject.Select(p => p.Message).ToList();
        messages.Should().Contain(m => m.StartsWith("Rules/Two.cs:6: the rule id 'rule_a' is declared again here, first at Rules/One.cs:6"));
        messages.Should().Contain(m => m.Contains("'no-circular-dataflows' is the id of a built-in rule"));
        messages.Should().Contain(m => m.StartsWith("Rules/Two.cs:7: Code.At is written again here, first at Rules/One.cs:8"));
    }

    [Fact]
    public void A_rules_file_changed_on_disk_is_read_again()
    {
        Rules("""Rule.Forbid("rule_a", "a", "b")""");
        Read().Rules.Should().ContainSingle(r => r.Id == "rule_a");

        Rules("""Rule.Forbid("rule_renamed", "a", "b")""");
        Read().Rules.Should().ContainSingle(r => r.Id == "rule_renamed");
    }

    [Fact]
    public void Trees_already_parsed_are_read_by_the_same_rule()
    {
        var tree = Microsoft.CodeAnalysis.CSharp.CSharpSyntaxTree.ParseText("""
            public static class R { public static RuleSet Define() => RuleSet.Of(Rule.Use("c4")); }
            """).GetRoot();

        var read = DeclaredRules.ReadFrom(_root, [(Path.Combine(_root, "Rules", "R.cs"), tree), (Path.Combine(_root, "Views", "V.cs"), tree)]);

        read.Files.Should().Equal("Rules/R.cs");
        read.Packs.Should().ContainSingle();
    }

    /// <summary>The reader reads Rule and Code by parameter name and position: it must agree with Stemma.Model on both.</summary>
    [Fact]
    public void The_reader_knows_the_parameters_Stemma_Model_declares()
    {
        foreach (var type in new[] { typeof(Stemma.Model.Rule), typeof(Stemma.Model.Code) })
        {
            foreach (var method in type.GetMethods(BindingFlags.Public | BindingFlags.Static | BindingFlags.DeclaredOnly))
            {
                var shape = DeclaredRules.Shapes[$"{type.Name}.{method.Name}"];
                var parameters = method.GetParameters();
                shape.Parameters.Should().Equal(parameters.Select(p => p.Name), $"{type.Name}.{method.Name} takes them in this order");
                shape.Required.Should().Equal(parameters.Where(p => !p.HasDefaultValue).Select(p => p.Name));
            }
        }
        DeclaredRules.Shapes.Keys.Should().HaveCount(
            typeof(Stemma.Model.Rule).GetMethods(BindingFlags.Public | BindingFlags.Static | BindingFlags.DeclaredOnly).Length
            + typeof(Stemma.Model.Code).GetMethods(BindingFlags.Public | BindingFlags.Static | BindingFlags.DeclaredOnly).Length);
    }
}
