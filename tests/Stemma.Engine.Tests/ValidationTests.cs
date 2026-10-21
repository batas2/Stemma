using FluentAssertions;
using Stemma.Engine.ArchModel;
using Stemma.Engine.Validation;
using Stemma.Engine.Workspace;
using Xunit;

namespace Stemma.Engine.Tests;

public class ValidationTests
{
    private static async Task<TestArchWorkspace> CreateAsync(string buildBody)
    {
        var modelProj = Path.GetFullPath(Path.Combine(AppContext.BaseDirectory, "..", "..", "..", "..", "..", "src", "Stemma.Model", "Stemma.Model.csproj"));
        var csproj = $"""
            <Project Sdk="Microsoft.NET.Sdk">
              <PropertyGroup>
                <TargetFramework>net8.0</TargetFramework>
                <Nullable>enable</Nullable>
                <ImplicitUsings>enable</ImplicitUsings>
                <LangVersion>latest</LangVersion>
              </PropertyGroup>
              <ItemGroup>
                <ProjectReference Include="{modelProj}" />
              </ItemGroup>
            </Project>
            """;
        var arch = $$"""
            using Stemma.Model;
            namespace Sample;
            public static class Architecture
            {
                public static Model Build()
                {
                    {{buildBody}}
                    return Model.Of();
                }
            }
            """;
        return await TestArchWorkspace.CreateAsync(csproj, arch);
    }

    [Fact]
    public async Task LinkEndpointsExist_clean_model_passes()
    {
        await using var ws = await CreateAsync("""
            var modA = new Module("mod_001", "A");
            var modB = new Module("mod_002", "B");
            var f = new DataFlow("flow_001", "mod_001", "mod_002", "X");
        """);
        await using var engine = await StemmaEngine.OpenAsync(ws.RootPath);
        var violations = await engine.RunValidationAsync();
        violations.Should().NotContain(v => v.RuleId == "link-endpoints-exist");
    }

    [Fact]
    public async Task ModuleHasAtMostOneContext_flags_unknown_context()
    {
        await using var ws = await CreateAsync("""
            var modA = new Module("mod_001", "A", "ctx_missing");
        """);
        await using var engine = await StemmaEngine.OpenAsync(ws.RootPath);
        var violations = await engine.RunValidationAsync();
        violations.Should().Contain(v => v.RuleId == "module-has-at-most-one-context");
    }

    [Fact]
    public async Task NoOrphanModules_flags_module_without_context()
    {
        await using var ws = await CreateAsync("""
            var modA = new Module("mod_001", "A");
        """);
        await using var engine = await StemmaEngine.OpenAsync(ws.RootPath);
        var violations = await engine.RunValidationAsync();
        var orphan = violations.FirstOrDefault(v => v.RuleId == "no-orphan-modules");
        orphan.Should().NotBeNull();
        orphan!.Severity.Should().Be(Severity.Info);
    }

    [Fact]
    public async Task NoCircularDataFlows_detects_cycle()
    {
        await using var ws = await CreateAsync("""
            var ctx = new BoundedContext("ctx_001", "C");
            var a = new Module("mod_a", "A", "ctx_001");
            var b = new Module("mod_b", "B", "ctx_001");
            var f1 = new DataFlow("flow_1", "mod_a", "mod_b", "X");
            var f2 = new DataFlow("flow_2", "mod_b", "mod_a", "Y");
        """);
        await using var engine = await StemmaEngine.OpenAsync(ws.RootPath);
        var violations = await engine.RunValidationAsync();
        violations.Should().Contain(v => v.RuleId == "no-circular-dataflows");
    }

    private static ArchModel.ArchModel Flows(params (string Id, string From, string To)[] flows) => new(
        "Architecture.cs",
        flows.SelectMany(f => new[] { f.From, f.To }).Distinct()
            .Select(id => new ArchElement(id, id, ArchElementKind.Module, new Dictionary<string, string?>())).ToList(),
        flows.Select(f => new ArchLink(f.Id, f.From, f.To, ArchLinkKind.DataFlow, new Dictionary<string, string?> { ["payload"] = "x" })).ToList(),
        []);

    [Fact]
    public void NoCircularDataFlows_reports_the_flows_on_the_cycle_and_not_the_way_into_it()
    {
        // a → b → c → b: the cycle is b → c → b. The flow from a only leads into it, and was reported
        // with it, so the list named a flow nobody had to change.
        var violations = new NoCircularDataFlows().Check(Flows(("f_ab", "a", "b"), ("f_bc", "b", "c"), ("f_cb", "c", "b"))).ToList();

        violations.Should().ContainSingle().Which.LinkIds.Should().BeEquivalentTo(["f_bc", "f_cb"]);
    }

    [Fact]
    public void NoCircularDataFlows_reports_each_cycle_on_its_own_and_a_flow_on_itself()
    {
        var violations = new NoCircularDataFlows().Check(Flows(
            ("f_ab", "a", "b"), ("f_ba", "b", "a"),
            ("f_bc", "b", "c"),
            ("f_cd", "c", "d"), ("f_dc", "d", "c"),
            ("f_ee", "e", "e"))).ToList();

        violations.Select(v => v.LinkIds.Order().ToArray()).Should().BeEquivalentTo(new[]
        {
            new[] { "f_ab", "f_ba" },
            new[] { "f_cd", "f_dc" },
            new[] { "f_ee" },
        });
    }

    [Fact]
    public void NoCircularDataFlows_is_quiet_when_nothing_comes_back()
    {
        new NoCircularDataFlows().Check(Flows(("f_ab", "a", "b"), ("f_bc", "b", "c"), ("f_ac", "a", "c"))).Should().BeEmpty();
    }

    [Fact]
    public async Task DeprecatedElementHasNoIncomingFlows_flags_incoming_to_deprecated()
    {
        await using var ws = await CreateAsync("""
            var ctx = new BoundedContext("ctx_001", "C");
            var a = new Module("mod_a", "A", "ctx_001");
            var b = new Module("mod_b", "B", "ctx_001");
            var f1 = new DataFlow("flow_1", "mod_a", "mod_b", "X");
            Tag.For(b, lifecycle: new Lifecycle(Status: "deprecated"));
        """);
        await using var engine = await StemmaEngine.OpenAsync(ws.RootPath);
        var violations = await engine.RunValidationAsync();
        violations.Should().Contain(v => v.RuleId == "deprecated-element-no-incoming-flows");
    }

    [Fact]
    public async Task RulesConfig_disables_a_rule()
    {
        await using var ws = await CreateAsync("""
            var modA = new Module("mod_001", "A");
        """);
        var configPath = Path.Combine(ws.RootPath, "stemma.rules.json");
        await File.WriteAllTextAsync(configPath, """
            { "rules": { "no-orphan-modules": { "enabled": false } } }
            """);
        await using var engine = await StemmaEngine.OpenAsync(ws.RootPath);
        var violations = await engine.RunValidationAsync();
        violations.Should().NotContain(v => v.RuleId == "no-orphan-modules");
    }

    [Fact]
    public async Task RulesConfig_overrides_severity()
    {
        await using var ws = await CreateAsync("""
            var modA = new Module("mod_001", "A");
        """);
        var configPath = Path.Combine(ws.RootPath, "stemma.rules.json");
        await File.WriteAllTextAsync(configPath, """
            { "rules": { "no-orphan-modules": { "severity": "error" } } }
            """);
        await using var engine = await StemmaEngine.OpenAsync(ws.RootPath);
        var violations = await engine.RunValidationAsync();
        var orphan = violations.FirstOrDefault(v => v.RuleId == "no-orphan-modules");
        orphan.Should().NotBeNull();
        orphan!.Severity.Should().Be(Severity.Error);
    }
}
