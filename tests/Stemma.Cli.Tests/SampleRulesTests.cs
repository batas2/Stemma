using System.Runtime.CompilerServices;
using FluentAssertions;
using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.CSharp;
using Stemma.Engine.Validation;
using Xunit;

namespace Stemma.Cli.Tests;

/// <summary>
/// The two samples that carry rules, held to what they promise: Dishwise (the C4 sample) passes every
/// rule it declares, and fails the one a shortcut breaks; Stemma's self-model maps its containers to
/// Stemma's own projects and declares every reference between them. And the rules as samples, docs and
/// agents write them compile against Stemma.Model, so a workspace with a project builds.
/// </summary>
public sealed class SampleRulesTests
{
    private static string Sample(string name, [CallerFilePath] string file = "") =>
        Path.GetFullPath(Path.Combine(Path.GetDirectoryName(file)!, "..", "..", "samples", name));

    [Fact]
    public void Dishwise_validates_with_no_errors_and_every_rule_it_declares_holds()
    {
        var declared = DeclaredRules.Read(Sample("FoodDelivery"));
        declared.Problems.Should().BeEmpty();
        declared.Rules.Select(r => r.Id).Should().Equal("rule_card_data", "rule_clients_via_gateway", "rule_own_data", "rule_layers", "rule_owned");
        declared.Uses("c4").Should().BeTrue();

        var findings = WorkspaceCheck.Run(Sample("FoodDelivery"));

        findings.Should().NotContain(f => f.Severity == CheckSeverity.Error);
        findings.Should().NotContain(f => f.Rule.StartsWith("rule/") || f.Rule == "view/mixed-levels",
            "every rule Dishwise declares, the C4 pack included, holds of its model");
    }

    [Fact]
    public void A_copy_of_Dishwise_with_a_client_reading_a_database_breaks_its_gateway_rule()
    {
        var copy = Path.Combine(Path.GetTempPath(), $"stemma-dishwise-{Guid.NewGuid():N}");
        try
        {
            foreach (var dir in new[] { "Architecture", "Views", "Rules" })
            {
                Directory.CreateDirectory(Path.Combine(copy, dir));
                foreach (var file in Directory.GetFiles(Path.Combine(Sample("FoodDelivery"), dir)))
                    File.Copy(file, Path.Combine(copy, dir, Path.GetFileName(file)));
            }
            var model = Path.Combine(copy, "Architecture", "Architecture.cs");
            File.WriteAllText(model, File.ReadAllText(model)
                .Replace("        Tag.For(dispatch,",
                    "        var shortcut = new DataFlow(\"flow_shortcut\", \"cnt_customer_app\", \"cnt_orders_db\", \"order history\", Technology: \"SQL\");\n        Tag.For(dispatch,")
                .Replace("placed, assign, tell,", "placed, assign, tell, shortcut,"));

            var findings = WorkspaceCheck.Run(copy);

            var broken = findings.Where(f => f.Rule.StartsWith("rule/")).Should().ContainSingle().Subject;
            broken.Rule.Should().Be("rule/rule_clients_via_gateway");
            broken.Severity.Should().Be(CheckSeverity.Error);
            broken.Message.Should().StartWith("Customer App → Orders DB (flow_shortcut) is not allowed")
                .And.EndWith("— Every client call is authenticated at the gateway");
        }
        finally { Directory.Delete(copy, recursive: true); }
    }

    [Fact]
    public void The_self_model_declares_every_reference_between_the_projects_it_maps()
    {
        var declared = DeclaredRules.Read(Sample("StemmaArchitecture"));
        declared.Problems.Should().BeEmpty();
        declared.CodeMaps.Select(m => m.ElementId).Should().BeEquivalentTo(["cnt_web", "cnt_cli", "cnt_desktop", "mod_engine", "mod_concepts"]);

        var findings = WorkspaceCheck.Run(Sample("StemmaArchitecture"));

        findings.Should().NotContain(f => f.Severity == CheckSeverity.Error);
        findings.Should().NotContain(f => f.Rule == "conformance/undeclared-dependency" || f.Rule == "conformance/unrealised-dependency"
                                          || f.Rule == "conformance/missing-code" || f.Rule == "conformance/ambiguous-map");
        findings.Should().ContainSingle(f => f.Rule == "conformance/unmapped-project")
            .Which.Message.Should().Contain("tests/Stemma.Engine.Tests/Stemma.Engine.Tests.csproj").And.NotContain("src/");
    }

    /// <summary>
    /// The samples' rules, and the example agents are taught from, compile against Stemma.Model — the
    /// parameter names a rule is written with (from:, to:, because:, of:, has:, via:, severity:) are part
    /// of the API.
    /// </summary>
    [Theory]
    [InlineData("FoodDelivery")]
    [InlineData("StemmaArchitecture")]
    public void A_sample_s_model_views_and_rules_compile_against_Stemma_Model(string sample)
    {
        var sources = new[] { "Architecture", "Views", "Rules" }
            .Select(dir => Path.Combine(Sample(sample), dir))
            .Where(Directory.Exists)
            .SelectMany(dir => Directory.GetFiles(dir, "*.cs"))
            .Select(File.ReadAllText);

        Errors(sources).Should().BeEmpty();
    }

    [Fact]
    public void The_rules_as_agents_are_taught_to_write_them_compile()
    {
        Errors(["""
            using Stemma.Model;

            namespace Shop;

            public static class ShopRules
            {
                public static RuleSet Define() => RuleSet.Of(
                    Rule.Use("c4"),

                    Rule.Only("rule_payments", from: "cnt_api", to: "sys_stripe",
                        because: "Card data stays inside one service (PCI scope)"),

                    Rule.Forbid("rule_ui_db", from: "kind:container[kind=spa|mobile]", to: "kind:container[kind=db]",
                        because: "Front ends reach data through the API"),

                    Rule.Layers("rule_layers",
                        ["kind:container[kind=spa|mobile]", "kind:container[kind=gateway]", "kind:container[kind=service|worker]", "kind:container[kind=db|broker|cache]"],
                        because: "Requests flow down: clients, edge, services, data"),

                    Rule.Require("rule_owned", of: "kind:container", has: "squad", severity: "warning",
                        because: "Every deployable has an owning squad"),

                    Rule.Forbid("rule_no_shared_db", from: "kind:container[kind=service]", to: "kind:container[kind=db]", via: "dependency"),
                    Rule.Require("rule_flow_tech", of: "link:dataFlow", has: "technology"),

                    Code.At("../src"),
                    Code.Map("cnt_api", "Shop.Api/Shop.Api.csproj"),
                    Code.Map("cnt_worker", "Shop.Worker"));
            }
            """]).Should().BeEmpty();
    }

    private static IReadOnlyList<string> Errors(IEnumerable<string> sources)
    {
        var references = ((string)AppContext.GetData("TRUSTED_PLATFORM_ASSEMBLIES")!).Split(Path.PathSeparator)
            .Where(p => p.Length > 0 && !Path.GetFileName(p).StartsWith("Stemma.", StringComparison.Ordinal))
            .Append(typeof(Stemma.Model.Rule).Assembly.Location)
            .Select(p => MetadataReference.CreateFromFile(p));
        var compilation = CSharpCompilation.Create("Probe",
            sources.Select(s => CSharpSyntaxTree.ParseText(s, new CSharpParseOptions(LanguageVersion.Latest))),
            references,
            new CSharpCompilationOptions(OutputKind.DynamicallyLinkedLibrary, nullableContextOptions: NullableContextOptions.Enable));
        return compilation.GetDiagnostics()
            .Where(d => d.Severity == DiagnosticSeverity.Error)
            .Select(d => d.ToString())
            .ToList();
    }
}
