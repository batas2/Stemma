using FluentAssertions;
using Stemma.Engine.ArchModel;
using Stemma.Engine.Workspace;
using Xunit;

namespace Stemma.Engine.Tests;

/// <summary>
/// Fidelity fixtures for the `Concept` element kind (ADR-0018) — minimal, realistic, pathological.
///
/// `Concept` is the vocabulary's deliberate poor relation: a named thing in an argument, asserting
/// nothing about a system. Its whole value is that it stops an essay's argument having to declare
/// itself a bounded context, so the tests are as much about what it *does not* acquire as about what
/// it round-trips.
/// </summary>
public class ConceptElementTests
{
    private const string ProjectFile = """
        <Project Sdk="Microsoft.NET.Sdk">
          <PropertyGroup>
            <TargetFramework>net8.0</TargetFramework>
            <Nullable>enable</Nullable>
            <ImplicitUsings>enable</ImplicitUsings>
            <LangVersion>latest</LangVersion>
          </PropertyGroup>
          <ItemGroup>
            <ProjectReference Include="STEMMA_MODEL_PATH" />
          </ItemGroup>
        </Project>
        """;

    private static async Task<TestArchWorkspace> CreateAsync(string buildBody)
    {
        var modelProj = Path.GetFullPath(Path.Combine(AppContext.BaseDirectory, "..", "..", "..", "..", "..", "src", "Stemma.Model", "Stemma.Model.csproj"));
        var csproj = ProjectFile.Replace("STEMMA_MODEL_PATH", modelProj);
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

    // ---- minimal ------------------------------------------------------------------------------

    [Fact]
    public async Task Reads_a_single_concept()
    {
        await using var ws = await CreateAsync("""
            var c = new Concept("con_001", "Nobody to ask");
        """);
        await using var engine = await StemmaEngine.OpenAsync(ws.RootPath);
        var arch = await engine.ReadArchModelAsync();

        arch.Should().NotBeNull();
        arch!.Elements.Should().ContainSingle();
        arch.Elements[0].Kind.Should().Be(ArchElementKind.Concept);
        arch.Elements[0].Id.Should().Be("con_001");
        arch.Elements[0].Name.Should().Be("Nobody to ask");
    }

    [Fact]
    public async Task A_concept_carries_no_structural_attributes()
    {
        // The point of the kind. If it ever acquires a contextId it has stopped being neutral and
        // has become a Module with extra steps.
        await using var ws = await CreateAsync("""
            var c = new Concept("con_001", "Nobody to ask");
        """);
        await using var engine = await StemmaEngine.OpenAsync(ws.RootPath);
        var arch = await engine.ReadArchModelAsync();

        var attrs = arch!.Elements[0].Attributes;
        attrs.Keys.Should().NotIntersectWith(new[] { "contextId", "systemId", "aboutId", "role", "kind" });
    }

    [Fact]
    public async Task Adds_a_concept_and_reads_it_back()
    {
        await using var ws = await CreateAsync("""
            var c = new Concept("con_001", "Nobody to ask");
        """);
        await using var engine = await StemmaEngine.OpenAsync(ws.RootPath);

        var result = await engine.ApplyAsync(new AddElementOp("op1", ArchElementKind.Concept, "An agent's diff"));
        result.Should().NotBeNull();

        var arch = await engine.ReadArchModelAsync();
        arch!.Elements.Should().Contain(e => e.Kind == ArchElementKind.Concept && e.Name == "An agent's diff");
    }

    [Fact]
    public async Task Generated_ids_use_their_own_prefix_so_a_figure_is_greppable()
    {
        await using var ws = await CreateAsync("""
            var m = new Module("mod_001", "Something");
        """);
        await using var engine = await StemmaEngine.OpenAsync(ws.RootPath);
        await engine.ApplyAsync(new AddElementOp("op1", ArchElementKind.Concept, "A claim"));

        var arch = await engine.ReadArchModelAsync();
        arch!.Elements.Single(e => e.Kind == ArchElementKind.Concept).Id.Should().StartWith("con_");
    }

    // ---- realistic ----------------------------------------------------------------------------

    [Fact]
    public async Task Concepts_link_to_each_other_like_any_other_element()
    {
        // An argument is a graph. Whether `Dependency` is the honest word for an arrow between two
        // ideas is deferred in ADR-0018; that it works is not.
        await using var ws = await CreateAsync("""
            var a = new Concept("con_human", "A colleague's diff");
            var b = new Concept("con_agent", "An agent's diff");
            var d = new Dependency("dep_001", "con_human", "con_agent", "becomes");
        """);
        await using var engine = await StemmaEngine.OpenAsync(ws.RootPath);
        var arch = await engine.ReadArchModelAsync();

        arch!.Elements.Should().HaveCount(2);
        arch.Links.Should().ContainSingle(l => l.FromId == "con_human" && l.ToId == "con_agent");
    }

    [Fact]
    public async Task Concepts_coexist_with_structural_kinds_without_disturbing_them()
    {
        await using var ws = await CreateAsync("""
            var ctx = new BoundedContext("ctx_001", "Sales");
            var mod = new Module("mod_001", "Checkout", "ctx_001");
            var con = new Concept("con_001", "The thing nobody owns");
        """);
        await using var engine = await StemmaEngine.OpenAsync(ws.RootPath);
        var arch = await engine.ReadArchModelAsync();

        arch!.Elements.Should().HaveCount(3);
        arch.Elements.Single(e => e.Id == "mod_001").Attributes["contextId"].Should().Be("ctx_001");
    }

    [Fact]
    public async Task Renaming_a_concept_preserves_surrounding_trivia()
    {
        await using var ws = await CreateAsync("""
            // The argument, not the architecture.
            var a = new Concept("con_001", "Nobody to ask");
            // A second thought.
            var b = new Concept("con_002", "Tests, contracts, decision records");
        """);
        await using var engine = await StemmaEngine.OpenAsync(ws.RootPath);

        await engine.ApplyAsync(new RenameElementOp("op1", "con_001", "No one to ask"));

        var source = await ws.ReadArchAsync();
        source.Should().Contain("// The argument, not the architecture.");
        source.Should().Contain("// A second thought.");
        source.Should().Contain("\"No one to ask\"");
        source.Should().NotContain("\"Nobody to ask\"");
    }

    [Fact]
    public async Task Removing_a_concept_leaves_the_rest_of_the_file_alone()
    {
        await using var ws = await CreateAsync("""
            // Keep me.
            var keep = new Concept("con_keep", "Still here");
            var drop = new Concept("con_drop", "Going away");
        """);
        await using var engine = await StemmaEngine.OpenAsync(ws.RootPath);

        await engine.ApplyAsync(new RemoveElementOp("op1", "con_drop"));

        var source = await ws.ReadArchAsync();
        source.Should().Contain("// Keep me.");
        source.Should().Contain("con_keep");
        source.Should().NotContain("con_drop");
    }

    // ---- Relation (ADR-0019) ------------------------------------------------------------------

    [Fact]
    public async Task Reads_a_relation_with_its_label()
    {
        await using var ws = await CreateAsync("""
            var a = new Concept("con_a", "an agent's diff");
            var b = new Concept("con_b", "nobody to ask");
            var r = new Relation("rel_001", "con_a", "con_b", "becomes");
        """);
        await using var engine = await StemmaEngine.OpenAsync(ws.RootPath);
        var arch = await engine.ReadArchModelAsync();

        var link = arch!.Links.Should().ContainSingle().Subject;
        link.Kind.Should().Be(ArchLinkKind.Relation);
        link.Attributes["label"].Should().Be("becomes");
    }

    [Fact]
    public async Task A_relation_without_a_label_is_a_legitimate_arrow()
    {
        // Unlike a Dependency, which falls back to "uses", an unlabelled Relation draws a bare
        // arrow — which is a thing arguments genuinely want.
        await using var ws = await CreateAsync("""
            var a = new Concept("con_a", "One");
            var b = new Concept("con_b", "Two");
            var r = new Relation("rel_001", "con_a", "con_b");
        """);
        await using var engine = await StemmaEngine.OpenAsync(ws.RootPath);
        var arch = await engine.ReadArchModelAsync();

        arch!.Links.Should().ContainSingle(l => l.Kind == ArchLinkKind.Relation);
    }

    [Fact]
    public async Task Relations_coexist_with_flows_and_dependencies()
    {
        await using var ws = await CreateAsync("""
            var m1 = new Module("mod_a", "A");
            var m2 = new Module("mod_b", "B");
            var f = new DataFlow("flow_1", "mod_a", "mod_b", "OrderPlaced");
            var d = new Dependency("dep_1", "mod_b", "mod_a", "reads");
            var r = new Relation("rel_1", "mod_a", "mod_b", "answered by");
        """);
        await using var engine = await StemmaEngine.OpenAsync(ws.RootPath);
        var arch = await engine.ReadArchModelAsync();

        arch!.Links.Should().HaveCount(3);
        arch.Links.Select(l => l.Kind).Distinct().Should().HaveCount(3);
        arch.Links.Single(l => l.Kind == ArchLinkKind.DataFlow).Attributes["payload"].Should().Be("OrderPlaced");
        arch.Links.Single(l => l.Kind == ArchLinkKind.Dependency).Attributes["kind"].Should().Be("reads");
        arch.Links.Single(l => l.Kind == ArchLinkKind.Relation).Attributes["label"].Should().Be("answered by");
    }

    [Fact]
    public async Task Adding_a_relation_writes_source_that_reads_back_and_leaves_trivia_alone()
    {
        await using var ws = await CreateAsync("""
            // Two ideas.
            var a = new Concept("con_a", "One");
            var b = new Concept("con_b", "Two");
        """);
        await using var engine = await StemmaEngine.OpenAsync(ws.RootPath);

        await engine.ApplyAsync(new AddLinkOp("op1", ArchLinkKind.Relation, "con_a", "con_b"));

        var source = await ws.ReadArchAsync();
        source.Should().Contain("// Two ideas.");
        source.Should().Contain("new Relation(");

        var arch = await engine.ReadArchModelAsync();
        arch!.Links.Should().ContainSingle(l => l.Kind == ArchLinkKind.Relation && l.FromId == "con_a");
    }

    [Fact]
    public async Task Generated_relation_ids_use_their_own_prefix()
    {
        await using var ws = await CreateAsync("""
            var a = new Concept("con_a", "One");
            var b = new Concept("con_b", "Two");
        """);
        await using var engine = await StemmaEngine.OpenAsync(ws.RootPath);
        await engine.ApplyAsync(new AddLinkOp("op1", ArchLinkKind.Relation, "con_a", "con_b"));

        var arch = await engine.ReadArchModelAsync();
        arch!.Links.Single().Id.Should().StartWith("rel_");
    }

    [Fact]
    public async Task A_relation_label_with_punctuation_round_trips()
    {
        await using var ws = await CreateAsync("""
            var a = new Concept("con_a", "One");
            var b = new Concept("con_b", "Two");
            var r = new Relation("rel_1", "con_a", "con_b", "\"answers\", eventually");
        """);
        await using var engine = await StemmaEngine.OpenAsync(ws.RootPath);
        var arch = await engine.ReadArchModelAsync();

        arch!.Links.Single().Attributes["label"].Should().Be("\"answers\", eventually");
    }

    // ---- pathological -------------------------------------------------------------------------

    [Fact]
    public async Task A_prose_name_with_punctuation_and_quotes_round_trips()
    {
        // Argument diagrams put sentences in boxes; a name is not an identifier.
        await using var ws = await CreateAsync("""
            var c = new Concept("con_001", "Why this, and not something \"simpler\"?");
        """);
        await using var engine = await StemmaEngine.OpenAsync(ws.RootPath);
        var arch = await engine.ReadArchModelAsync();

        arch!.Elements[0].Name.Should().Be("Why this, and not something \"simpler\"?");
    }

    [Fact]
    public async Task A_rename_to_a_name_needing_escapes_writes_source_that_reads_back()
    {
        await using var ws = await CreateAsync("""
            var c = new Concept("con_001", "Plain");
        """);
        await using var engine = await StemmaEngine.OpenAsync(ws.RootPath);

        await engine.ApplyAsync(new RenameElementOp("op1", "con_001", "A \"quoted\" claim, with a comma"));

        var arch = await engine.ReadArchModelAsync();
        arch!.Elements[0].Name.Should().Be("A \"quoted\" claim, with a comma");
    }

    [Fact]
    public async Task A_concept_among_every_other_kind_does_not_perturb_the_others()
    {
        await using var ws = await CreateAsync("""
            var per = new Person("per_001", "Passenger", "external");
            var sys = new SoftwareSystem("sys_001", "Platform");
            var cnt = new Container("cnt_001", "API", "sys_001", "service");
            var ctx = new BoundedContext("ctx_001", "Sales");
            var mod = new Module("mod_001", "Checkout", "ctx_001");
            var cap = new Capability("cap_001", "Sell", "ctx_001");
            var uc  = new UseCase("uc_001", "Buy a ticket");
            var q   = new Question("q_001", "What breaks?", "mod_001");
            var asm = new Assumption("asm_001", "Traffic is flat", "mod_001");
            var rsk = new Risk("risk_001", "Key rotation is manual", "mod_001");
            var con = new Concept("con_001", "The argument itself");
        """);
        await using var engine = await StemmaEngine.OpenAsync(ws.RootPath);
        var arch = await engine.ReadArchModelAsync();

        arch!.Elements.Should().HaveCount(11);
        arch.Elements.Select(e => e.Kind).Distinct().Should().HaveCount(11);
        arch.Elements.Single(e => e.Id == "cnt_001").Attributes["kind"].Should().Be("service");
        arch.Elements.Single(e => e.Id == "q_001").Attributes["aboutId"].Should().Be("mod_001");
    }

    [Fact]
    public async Task Adding_a_concept_to_a_file_with_awkward_formatting_keeps_it_awkward()
    {
        // Fidelity means the diff contains only the intended change, including in a file nobody
        // would format this way on purpose.
        await using var ws = await CreateAsync("""
            var a = new Concept("con_001", "One");     // trailing comment
                var b   =   new Concept( "con_002" ,  "Two" ) ;
        """);
        await using var engine = await StemmaEngine.OpenAsync(ws.RootPath);

        await engine.ApplyAsync(new AddElementOp("op1", ArchElementKind.Concept, "Three"));

        var source = await ws.ReadArchAsync();
        source.Should().Contain("// trailing comment");
        source.Should().Contain("var b   =   new Concept( \"con_002\" ,  \"Two\" ) ;");
        source.Should().Contain("\"Three\"");
    }
}
