using FluentAssertions;
using Verso.Engine.ArchModel;
using Verso.Engine.Workspace;
using Xunit;

namespace Verso.Engine.Tests;

public class ArchModelTests
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
            <ProjectReference Include="VERSO_MODEL_PATH" />
          </ItemGroup>
        </Project>
        """;

    private static async Task<TestArchWorkspace> CreateAsync(string buildBody)
    {
        var modelProj = Path.GetFullPath(Path.Combine(AppContext.BaseDirectory, "..", "..", "..", "..", "..", "src", "Verso.Model", "Verso.Model.csproj"));
        var csproj = ProjectFile.Replace("VERSO_MODEL_PATH", modelProj);
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
    public async Task Reads_modules_and_dataflow_from_dsl()
    {
        await using var ws = await CreateAsync("""
            var ctx = new BoundedContext("ctx_001", "Buyer");
            var modA = new Module("mod_001", "Onboarding", "ctx_001");
            var modB = new Module("mod_002", "Risk", "ctx_001");
            var flow = new DataFlow("flow_001", "mod_001", "mod_002", "OnboardedSupplier");
        """);
        await using var engine = await VersoEngine.OpenAsync(ws.RootPath);
        var arch = await engine.ReadArchModelAsync();
        arch.Should().NotBeNull();
        arch!.Elements.Should().HaveCount(3);
        arch.Elements.Should().Contain(e => e.Kind == ArchElementKind.BoundedContext && e.Id == "ctx_001");
        arch.Elements.Should().Contain(e => e.Kind == ArchElementKind.Module && e.Name == "Onboarding");
        arch.Links.Should().HaveCount(1);
        arch.Links[0].Kind.Should().Be(ArchLinkKind.DataFlow);
        arch.Links[0].FromId.Should().Be("mod_001");
        arch.Links[0].ToId.Should().Be("mod_002");
    }

    [Fact]
    public async Task AddElement_appends_local_and_returns_in_model()
    {
        await using var ws = await CreateAsync("""
            var ctx = new BoundedContext("ctx_001", "Buyer");
        """);
        await using var engine = await VersoEngine.OpenAsync(ws.RootPath);
        var result = await engine.ApplyAsync(new AddElementOp("op1", ArchElementKind.Module, "Onboarding", ContextId: "ctx_001"));
        if (result is Operations.OperationFailed f)
            throw new Xunit.Sdk.XunitException($"Failed: reason={f.Reason}, message={f.Message}, diags={string.Join(" | ", f.Diagnostics ?? [])}\nFile: {await ws.ReadArchAsync()}");
        result.Should().BeOfType<Operations.OperationApplied>();

        var newSource = await ws.ReadArchAsync();
        newSource.Should().Contain("var ctx = new BoundedContext(\"ctx_001\", \"Buyer\")");
        newSource.Should().Contain("new Module(\"mod_");
        newSource.Should().Contain("\"Onboarding\"");
        newSource.Should().Contain("\"ctx_001\"");
    }

    [Fact]
    public async Task RenameElement_changes_name_and_preserves_id()
    {
        await using var ws = await CreateAsync("""
            var ctx = new BoundedContext("ctx_001", "Old Name");
        """);
        await using var engine = await VersoEngine.OpenAsync(ws.RootPath);
        var result = await engine.ApplyAsync(new RenameElementOp("op1", "ctx_001", "New Name"));
        result.Should().BeOfType<Operations.OperationApplied>();

        var newSource = await ws.ReadArchAsync();
        newSource.Should().Contain("\"ctx_001\"");
        newSource.Should().Contain("\"New Name\"");
        newSource.Should().NotContain("\"Old Name\"");
    }

    [Fact]
    public async Task RemoveElement_drops_local_and_return_arg()
    {
        await using var ws = await CreateAsync("""
            var ctx = new BoundedContext("ctx_001", "Buyer");
            var mod = new Module("mod_001", "Onboarding", "ctx_001");
        """);
        await using var engine = await VersoEngine.OpenAsync(ws.RootPath);
        var result = await engine.ApplyAsync(new RemoveElementOp("op1", "mod_001"));
        result.Should().BeOfType<Operations.OperationApplied>();

        var newSource = await ws.ReadArchAsync();
        newSource.Should().NotContain("mod_001");
        newSource.Should().Contain("ctx_001");
    }

    [Fact]
    public async Task AddLink_writes_dataflow_after_validating_endpoints()
    {
        await using var ws = await CreateAsync("""
            var ctx = new BoundedContext("ctx_001", "Buyer");
            var modA = new Module("mod_001", "A", "ctx_001");
            var modB = new Module("mod_002", "B", "ctx_001");
        """);
        await using var engine = await VersoEngine.OpenAsync(ws.RootPath);
        var result = await engine.ApplyAsync(new AddLinkOp("op1", ArchLinkKind.DataFlow, "mod_001", "mod_002", Payload: "Event"));
        result.Should().BeOfType<Operations.OperationApplied>();

        var newSource = await ws.ReadArchAsync();
        newSource.Should().Contain("new DataFlow(\"flow_");
        newSource.Should().Contain("\"mod_001\"");
        newSource.Should().Contain("\"mod_002\"");
        newSource.Should().Contain("\"Event\"");
    }

    [Fact]
    public async Task AddLink_refuses_when_endpoint_missing()
    {
        await using var ws = await CreateAsync("""
            var modA = new Module("mod_001", "A");
        """);
        await using var engine = await VersoEngine.OpenAsync(ws.RootPath);
        var result = await engine.ApplyAsync(new AddLinkOp("op1", ArchLinkKind.DataFlow, "mod_001", "mod_999", Payload: "Event"));
        result.Should().BeOfType<Operations.OperationFailed>();
        ((Operations.OperationFailed)result).Reason.Should().Be("ToNotFound");
    }

    [Fact]
    public async Task SetLinkAttribute_updates_payload_and_preserves_endpoints()
    {
        await using var ws = await CreateAsync("""
            var modA = new Module("mod_001", "A");
            var modB = new Module("mod_002", "B");
            var flow = new DataFlow("flow_001", "mod_001", "mod_002", "OldPayload");
        """);
        await using var engine = await VersoEngine.OpenAsync(ws.RootPath);
        var result = await engine.ApplyAsync(new SetLinkAttributeOp("op1", "flow_001", "payload", "NewPayload"));
        if (result is Operations.OperationFailed f)
            throw new Xunit.Sdk.XunitException($"Failed: {f.Reason} {f.Message}");
        result.Should().BeOfType<Operations.OperationApplied>();

        var newSource = await ws.ReadArchAsync();
        newSource.Should().Contain("\"NewPayload\"");
        newSource.Should().NotContain("\"OldPayload\"");
        newSource.Should().Contain("\"mod_001\"");
        newSource.Should().Contain("\"mod_002\"");
    }

    [Fact]
    public async Task Mermaid_module_map_groups_modules_under_context()
    {
        await using var ws = await CreateAsync("""
            var ctx = new BoundedContext("ctx_001", "Buyer");
            var modA = new Module("mod_001", "A", "ctx_001");
            var modB = new Module("mod_002", "B", "ctx_001");
            var flow = new DataFlow("flow_001", "mod_001", "mod_002", "Event");
        """);
        await using var engine = await VersoEngine.OpenAsync(ws.RootPath);
        var arch = await engine.ReadArchModelAsync();
        arch.Should().NotBeNull();
        var mermaid = MermaidExporter.Export(arch!, ArchViewKind.ModuleMap);
        mermaid.Should().Contain("subgraph ctx_001");
        mermaid.Should().Contain("mod_001[\"A\"]");
        mermaid.Should().Contain("mod_001 -->|Event| mod_002");
    }
}

public sealed class TestArchWorkspace : IAsyncDisposable
{
    public string RootPath { get; }
    public string ArchPath { get; }

    private TestArchWorkspace(string root, string archPath)
    {
        RootPath = root;
        ArchPath = archPath;
    }

    public static async Task<TestArchWorkspace> CreateAsync(string csproj, string archContent)
    {
        var root = Path.Combine(Path.GetTempPath(), $"verso-arch-{Guid.NewGuid():N}");
        Directory.CreateDirectory(root);
        Directory.CreateDirectory(Path.Combine(root, "Architecture"));
        await File.WriteAllTextAsync(Path.Combine(root, "Sample.csproj"), csproj);
        var archPath = Path.Combine(root, "Architecture", "Architecture.cs");
        await File.WriteAllTextAsync(archPath, archContent);
        return new TestArchWorkspace(root, archPath);
    }

    public Task<string> ReadArchAsync() => File.ReadAllTextAsync(ArchPath);

    public ValueTask DisposeAsync()
    {
        try { Directory.Delete(RootPath, recursive: true); } catch { }
        return ValueTask.CompletedTask;
    }
}
