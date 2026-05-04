using FluentAssertions;
using Verso.Engine.Adapters;
using Verso.Engine.ArchModel;
using Verso.Engine.Operations;
using Verso.Engine.Workspace;
using Xunit;

namespace Verso.Engine.Tests;

public class DecisionTests
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

    [Fact]
    public async Task AddDecision_writes_local_and_creates_narrative_file()
    {
        await using var ws = await CreateAsync("""
            var modA = new Module("mod_001", "Onboarding");
        """);
        await using var engine = await VersoEngine.OpenAsync(ws.RootPath);
        var result = await engine.ApplyAsync(new AddDecisionOp("op1", "Onboarding routes through Risk first"));
        if (result is OperationFailed f) throw new Xunit.Sdk.XunitException($"{f.Reason} {f.Message}");

        var src = await ws.ReadArchAsync();
        src.Should().Contain("new Decision(\"dec_001\"");
        src.Should().Contain("\"Onboarding routes through Risk first\"");

        var arch = await engine.ReadArchModelAsync();
        arch.Should().NotBeNull();
        arch!.Decisions.Should().NotBeNull();
        arch.Decisions!.Should().HaveCount(1);

        var narrativeFolder = Path.Combine(ws.RootPath, "Decisions");
        Directory.Exists(narrativeFolder).Should().BeTrue();
        var narrativeFiles = Directory.GetFiles(narrativeFolder, "*.md");
        narrativeFiles.Should().HaveCount(1);
        var content = await File.ReadAllTextAsync(narrativeFiles[0]);
        content.Should().Contain("---");
        content.Should().Contain("id: dec_001");
        content.Should().Contain("status: proposed");
        content.Should().Contain("## Context");
    }

    [Fact]
    public async Task SetDecisionStatus_updates_argument_and_frontmatter()
    {
        await using var ws = await CreateAsync("""
            var dec = new Decision("dec_001", "Test", "proposed");
        """);
        // Pre-create the narrative file so the engine can update it.
        var folder = Path.Combine(ws.RootPath, "Decisions");
        Directory.CreateDirectory(folder);
        var path = Path.Combine(folder, "dec_001-test.md");
        await File.WriteAllTextAsync(path, """
            ---
            id: dec_001
            title: Test
            status: proposed
            ---

            ## Context
            Body here.
            """);

        await using var engine = await VersoEngine.OpenAsync(ws.RootPath);
        var result = await engine.ApplyAsync(new SetDecisionStatusOp("op1", "dec_001", "accepted"));
        if (result is OperationFailed f) throw new Xunit.Sdk.XunitException($"{f.Reason} {f.Message}");

        var src = await ws.ReadArchAsync();
        src.Should().Contain("\"accepted\"");
        var md = await File.ReadAllTextAsync(path);
        md.Should().Contain("status: accepted");
        md.Should().Contain("## Context");
    }

    [Fact]
    public async Task AddDecisionConcerns_appends_DSL_call_and_reads_back()
    {
        await using var ws = await CreateAsync("""
            var modA = new Module("mod_001", "Onboarding");
            var dec = new Decision("dec_001", "Onboarding routes through Risk", "accepted");
        """);
        await using var engine = await VersoEngine.OpenAsync(ws.RootPath);
        var result = await engine.ApplyAsync(new AddDecisionConcernsOp("op1", "dec_001", "mod_001"));
        if (result is OperationFailed f) throw new Xunit.Sdk.XunitException($"{f.Reason} {f.Message}");

        var src = await ws.ReadArchAsync();
        src.Should().Contain("Decision.Concerns(dec, modA)");
        var arch = await engine.ReadArchModelAsync();
        arch!.DecisionConcerns!.Should().Contain(c => c.DecisionId == "dec_001" && c.ElementId == "mod_001");
    }

    [Fact]
    public void MarkdownAdapter_round_trip_preserves_frontmatter_order()
    {
        var input = """
            ---
            id: dec_001
            title: Test
            status: accepted
            date: 2026-04-12
            ---

            ## Context

            Some body content with **bold** and a [link](http://example.com).

            - bullet 1
            - bullet 2
            """;
        var doc = MarkdownAdapter.Parse(input);
        doc.FrontmatterOrdered.Select(kv => kv.Key)
            .Should().BeEquivalentTo(new[] { "id", "title", "status", "date" }, o => o.WithStrictOrdering());
        doc.Get("status").Should().Be("accepted");
        doc.Body.Should().Contain("## Context");
        doc.Body.Should().Contain("bullet 2");
    }

    [Fact]
    public void MarkdownAdapter_set_value_round_trips()
    {
        var input = """
            ---
            id: dec_001
            status: proposed
            ---

            body
            """;
        var doc = MarkdownAdapter.Parse(input);
        doc.Set("status", "accepted");
        var rendered = MarkdownAdapter.Render(doc);
        rendered.Should().Contain("status: accepted");
        rendered.Should().Contain("body");

        var reread = MarkdownAdapter.Parse(rendered);
        reread.Get("status").Should().Be("accepted");
    }
}
