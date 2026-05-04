using FluentAssertions;
using Verso.Engine.ArchModel;
using Verso.Engine.Validation;
using Verso.Engine.Workspace;
using Xunit;

namespace Verso.Engine.Tests;

/// <summary>
/// Three fixtures per seed rule (Q96 = A): clean (rule passes), violating (rule fires),
/// edge case (rule's boundary behaviour). Six rules × 3 fixtures = 18 tests.
/// </summary>
public class ValidationFixtureTests
{
    private static async Task<TestArchWorkspace> CreateAsync(string buildBody)
    {
        var modelProj = Path.GetFullPath(Path.Combine(AppContext.BaseDirectory, "..", "..", "..", "..", "..", "src", "Verso.Model", "Verso.Model.csproj"));
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
            using Verso.Model;
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

    private static async Task<IReadOnlyList<Violation>> RunAsync(string buildBody)
    {
        await using var ws = await CreateAsync(buildBody);
        await using var engine = await VersoEngine.OpenAsync(ws.RootPath);
        return await engine.RunValidationAsync();
    }

    // ============================================================================
    // Rule: link-endpoints-exist
    // ============================================================================

    [Fact]
    public async Task LinkEndpoints_clean()
    {
        var v = await RunAsync("""
            var a = new Module("mod_a", "A");
            var b = new Module("mod_b", "B");
            var f = new DataFlow("flow_1", "mod_a", "mod_b", "X");
        """);
        v.Should().NotContain(x => x.RuleId == "link-endpoints-exist");
    }

    [Fact]
    public async Task LinkEndpoints_violating_missing_target()
    {
        var v = await RunAsync("""
            var a = new Module("mod_a", "A");
            var f = new DataFlow("flow_1", "mod_a", "mod_missing", "X");
        """);
        v.Should().Contain(x => x.RuleId == "link-endpoints-exist" && x.Severity == Severity.Error);
    }

    [Fact]
    public async Task LinkEndpoints_edge_self_loop()
    {
        // Self-loops are valid — both endpoints exist.
        var v = await RunAsync("""
            var a = new Module("mod_a", "A");
            var f = new DataFlow("flow_1", "mod_a", "mod_a", "Loopback");
        """);
        v.Should().NotContain(x => x.RuleId == "link-endpoints-exist");
    }

    // ============================================================================
    // Rule: module-has-at-most-one-context
    // ============================================================================

    [Fact]
    public async Task ModuleContext_clean()
    {
        var v = await RunAsync("""
            var ctx = new BoundedContext("ctx_1", "C");
            var a = new Module("mod_a", "A", "ctx_1");
        """);
        v.Should().NotContain(x => x.RuleId == "module-has-at-most-one-context");
    }

    [Fact]
    public async Task ModuleContext_violating_unknown_context()
    {
        var v = await RunAsync("""
            var a = new Module("mod_a", "A", "ctx_missing");
        """);
        v.Should().Contain(x => x.RuleId == "module-has-at-most-one-context");
    }

    [Fact]
    public async Task ModuleContext_edge_no_context_reference()
    {
        // Module without a contextId attribute is not a violation of THIS rule (it's a
        // separate rule, no-orphan-modules). Confirm the boundary is respected.
        var v = await RunAsync("""
            var a = new Module("mod_a", "A");
        """);
        v.Should().NotContain(x => x.RuleId == "module-has-at-most-one-context");
    }

    // ============================================================================
    // Rule: no-orphan-modules
    // ============================================================================

    [Fact]
    public async Task NoOrphan_clean()
    {
        var v = await RunAsync("""
            var ctx = new BoundedContext("ctx_1", "C");
            var a = new Module("mod_a", "A", "ctx_1");
        """);
        v.Should().NotContain(x => x.RuleId == "no-orphan-modules");
    }

    [Fact]
    public async Task NoOrphan_violating_module_without_context()
    {
        var v = await RunAsync("""
            var a = new Module("mod_a", "A");
        """);
        v.Should().Contain(x => x.RuleId == "no-orphan-modules" && x.Severity == Severity.Info);
    }

    [Fact]
    public async Task NoOrphan_edge_non_module_elements_unaffected()
    {
        // The rule only fires for Module kind. Capabilities without a context don't trigger it.
        var v = await RunAsync("""
            var c = new Capability("cap_1", "Discover");
        """);
        v.Should().NotContain(x => x.RuleId == "no-orphan-modules");
    }

    // ============================================================================
    // Rule: no-circular-dataflows
    // ============================================================================

    [Fact]
    public async Task NoCircular_clean_acyclic()
    {
        var v = await RunAsync("""
            var a = new Module("mod_a", "A");
            var b = new Module("mod_b", "B");
            var c = new Module("mod_c", "C");
            var f1 = new DataFlow("flow_1", "mod_a", "mod_b", "X");
            var f2 = new DataFlow("flow_2", "mod_b", "mod_c", "Y");
        """);
        v.Should().NotContain(x => x.RuleId == "no-circular-dataflows");
    }

    [Fact]
    public async Task NoCircular_violating_two_node_cycle()
    {
        var v = await RunAsync("""
            var a = new Module("mod_a", "A");
            var b = new Module("mod_b", "B");
            var f1 = new DataFlow("flow_1", "mod_a", "mod_b", "X");
            var f2 = new DataFlow("flow_2", "mod_b", "mod_a", "Y");
        """);
        v.Should().Contain(x => x.RuleId == "no-circular-dataflows");
    }

    [Fact]
    public async Task NoCircular_edge_dependency_link_not_checked()
    {
        // Dependency cycles are legitimate (modules reference each other); the rule only
        // applies to DataFlows.
        var v = await RunAsync("""
            var a = new Module("mod_a", "A");
            var b = new Module("mod_b", "B");
            var d1 = new Dependency("dep_1", "mod_a", "mod_b", "uses");
            var d2 = new Dependency("dep_2", "mod_b", "mod_a", "uses");
        """);
        v.Should().NotContain(x => x.RuleId == "no-circular-dataflows");
    }

    // ============================================================================
    // Rule: bounded-context-has-name
    // ============================================================================

    [Fact]
    public async Task BcName_clean()
    {
        var v = await RunAsync("""
            var ctx = new BoundedContext("ctx_1", "Buyer");
        """);
        v.Should().NotContain(x => x.RuleId == "bounded-context-has-name");
    }

    [Fact]
    public async Task BcName_violating_blank_name()
    {
        var v = await RunAsync("""
            var ctx = new BoundedContext("ctx_1", "   ");
        """);
        v.Should().Contain(x => x.RuleId == "bounded-context-has-name");
    }

    [Fact]
    public async Task BcName_edge_module_blank_name_unaffected()
    {
        // Rule only flags BoundedContexts. A module with a blank name is left alone.
        var v = await RunAsync("""
            var m = new Module("mod_a", "  ");
        """);
        v.Should().NotContain(x => x.RuleId == "bounded-context-has-name");
    }

    // ============================================================================
    // Rule: deprecated-element-no-incoming-flows
    // ============================================================================

    [Fact]
    public async Task DeprecatedNoIncoming_clean_target_is_current()
    {
        var v = await RunAsync("""
            var a = new Module("mod_a", "A");
            var b = new Module("mod_b", "B");
            var f = new DataFlow("flow_1", "mod_a", "mod_b", "X");
            Tag.For(b, lifecycle: new Lifecycle(Status: "current"));
        """);
        v.Should().NotContain(x => x.RuleId == "deprecated-element-no-incoming-flows");
    }

    [Fact]
    public async Task DeprecatedNoIncoming_violating_flow_to_deprecated()
    {
        var v = await RunAsync("""
            var a = new Module("mod_a", "A");
            var b = new Module("mod_b", "B");
            var f = new DataFlow("flow_1", "mod_a", "mod_b", "X");
            Tag.For(b, lifecycle: new Lifecycle(Status: "deprecated"));
        """);
        v.Should().Contain(x => x.RuleId == "deprecated-element-no-incoming-flows");
    }

    [Fact]
    public async Task DeprecatedNoIncoming_edge_outgoing_flow_from_deprecated_unaffected()
    {
        // Deprecated elements are allowed to emit flows during transition; only incoming
        // flows are flagged.
        var v = await RunAsync("""
            var a = new Module("mod_a", "A");
            var b = new Module("mod_b", "B");
            var f = new DataFlow("flow_1", "mod_a", "mod_b", "X");
            Tag.For(a, lifecycle: new Lifecycle(Status: "deprecated"));
        """);
        v.Should().NotContain(x => x.RuleId == "deprecated-element-no-incoming-flows");
    }
}
