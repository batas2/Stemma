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
    public async Task SetLifecycle_inserts_tag_and_RoundTrips()
    {
        await using var ws = await CreateAsync("""
            var modA = new Module("mod_001", "A");
        """);
        await using var engine = await VersoEngine.OpenAsync(ws.RootPath);

        var result = await engine.ApplyAsync(new SetLifecycleOp("op1", "mod_001", "current", "Q4 2026", null, null));
        if (result is Operations.OperationFailed f)
            throw new Xunit.Sdk.XunitException($"Failed: {f.Reason} {f.Message}\n{await ws.ReadArchAsync()}");
        result.Should().BeOfType<Operations.OperationApplied>();

        var src = await ws.ReadArchAsync();
        src.Should().Contain("Tag.For(modA");
        src.Should().Contain("Status: \"current\"");
        src.Should().Contain("Phase: \"Q4 2026\"");

        var arch = await engine.ReadArchModelAsync();
        arch.Should().NotBeNull();
        var tag = arch!.Tags.FirstOrDefault(t => t.TargetId == "mod_001");
        tag.Should().NotBeNull();
        tag!.Lifecycle.Should().NotBeNull();
        tag.Lifecycle!.Status.Should().Be("current");
    }

    [Fact]
    public async Task SetOwnership_inserts_tag_alongside_lifecycle()
    {
        await using var ws = await CreateAsync("""
            var modA = new Module("mod_001", "A");
        """);
        await using var engine = await VersoEngine.OpenAsync(ws.RootPath);

        await engine.ApplyAsync(new SetLifecycleOp("op1", "mod_001", "target", null, null, null));
        var result = await engine.ApplyAsync(new SetOwnershipOp("op2", "mod_001", "Onboarding Squad", "Buyer"));
        if (result is Operations.OperationFailed f)
            throw new Xunit.Sdk.XunitException($"Failed: {f.Reason} {f.Message}\n{await ws.ReadArchAsync()}");

        var src = await ws.ReadArchAsync();
        src.Should().Contain("Status: \"target\"");
        src.Should().Contain("Squad: \"Onboarding Squad\"");
        src.Should().Contain("Domain: \"Buyer\"");
    }

    [Fact]
    public async Task RenameElement_realigns_variable_name()
    {
        await using var ws = await CreateAsync("""
            var modOnboarding = new Module("mod_001", "Onboarding");
            var flow = new DataFlow("flow_001", "mod_001", "mod_001", "X");
            Tag.For(modOnboarding, lifecycle: new Lifecycle(Status: "current"));
        """);
        await using var engine = await VersoEngine.OpenAsync(ws.RootPath);

        var result = await engine.ApplyAsync(new RenameElementOp("op1", "mod_001", "Procurement"));
        if (result is Operations.OperationFailed f)
            throw new Xunit.Sdk.XunitException($"Failed: {f.Reason} {f.Message}\n{await ws.ReadArchAsync()}");
        result.Should().BeOfType<Operations.OperationApplied>();

        var src = await ws.ReadArchAsync();
        src.Should().Contain("var modProcurement = new Module");
        src.Should().Contain("\"Procurement\"");
        src.Should().NotContain("modOnboarding");
        src.Should().Contain("Tag.For(modProcurement");
    }

    [Fact]
    public async Task UndoStack_reverses_RenameElement()
    {
        await using var ws = await CreateAsync("""
            var modA = new Module("mod_001", "Onboarding");
        """);
        await using var engine = await VersoEngine.OpenAsync(ws.RootPath);

        await engine.ApplyAsync(new RenameElementOp("op1", "mod_001", "Procurement"));
        engine.Undo.CanUndo.Should().BeTrue();

        var undo = await engine.UndoAsync("undo1");
        if (undo is Operations.OperationFailed f)
            throw new Xunit.Sdk.XunitException($"Undo failed: {f.Reason} {f.Message}");

        var src = await ws.ReadArchAsync();
        src.Should().Contain("\"Onboarding\"");
        src.Should().NotContain("\"Procurement\"");
        engine.Undo.CanRedo.Should().BeTrue();
        engine.Undo.CanUndo.Should().BeFalse();
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
    public async Task UndoStack_reverses_AddElement_via_RemoveElement()
    {
        await using var ws = await CreateAsync("""
            var ctx = new BoundedContext("ctx_001", "C");
        """);
        await using var engine = await VersoEngine.OpenAsync(ws.RootPath);
        var add = await engine.ApplyAsync(new AddElementOp("op1", ArchElementKind.Module, "Onboarding", ContextId: "ctx_001"));
        if (add is Operations.OperationFailed f) throw new Xunit.Sdk.XunitException($"Add failed: {f.Reason} {f.Message}");
        engine.Undo.CanUndo.Should().BeTrue();

        var arch = await engine.ReadArchModelAsync();
        arch!.Elements.Should().Contain(e => e.Name == "Onboarding");

        var undo = await engine.UndoAsync("undo1");
        if (undo is Operations.OperationFailed f2) throw new Xunit.Sdk.XunitException($"Undo failed: {f2.Reason} {f2.Message}");

        var afterUndo = await engine.ReadArchModelAsync();
        afterUndo!.Elements.Should().NotContain(e => e.Name == "Onboarding");
    }

    [Fact]
    public async Task UndoStack_reverses_RemoveElement_via_RestoreElement()
    {
        await using var ws = await CreateAsync("""
            var ctx = new BoundedContext("ctx_001", "C");
            var a = new Module("mod_a", "A", "ctx_001");
        """);
        await using var engine = await VersoEngine.OpenAsync(ws.RootPath);
        var remove = await engine.ApplyAsync(new RemoveElementOp("op1", "mod_a"));
        if (remove is Operations.OperationFailed f) throw new Xunit.Sdk.XunitException($"Remove failed: {f.Reason} {f.Message}");

        var afterRemove = await engine.ReadArchModelAsync();
        afterRemove!.Elements.Should().NotContain(e => e.Id == "mod_a");

        var undo = await engine.UndoAsync("undo1");
        if (undo is Operations.OperationFailed f2) throw new Xunit.Sdk.XunitException($"Undo failed: {f2.Reason} {f2.Message}");

        var afterUndo = await engine.ReadArchModelAsync();
        var restored = afterUndo!.Elements.FirstOrDefault(e => e.Id == "mod_a");
        restored.Should().NotBeNull();
        restored!.Name.Should().Be("A");
        restored.Attributes["contextId"].Should().Be("ctx_001");
    }

    [Fact]
    public async Task UndoStack_reverses_RemoveLink_via_RestoreLink()
    {
        await using var ws = await CreateAsync("""
            var a = new Module("mod_a", "A");
            var b = new Module("mod_b", "B");
            var f = new DataFlow("flow_1", "mod_a", "mod_b", "Event");
        """);
        await using var engine = await VersoEngine.OpenAsync(ws.RootPath);
        var remove = await engine.ApplyAsync(new RemoveLinkOp("op1", "flow_1"));
        if (remove is Operations.OperationFailed f) throw new Xunit.Sdk.XunitException($"Remove failed: {f.Reason} {f.Message}");

        var undo = await engine.UndoAsync("undo1");
        if (undo is Operations.OperationFailed f2) throw new Xunit.Sdk.XunitException($"Undo failed: {f2.Reason} {f2.Message}");

        var arch = await engine.ReadArchModelAsync();
        var restored = arch!.Links.FirstOrDefault(l => l.Id == "flow_1");
        restored.Should().NotBeNull();
        restored!.Attributes["payload"].Should().Be("Event");
    }

    [Fact]
    public async Task MultiFile_reader_aggregates_elements_across_files()
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
        var primary = """
            using Verso.Model;
            namespace Sample;
            public static class Architecture
            {
                public static Model Build()
                {
                    var ctx = new BoundedContext("ctx_001", "Buyer");
                    var modA = new Module("mod_001", "A", "ctx_001");
                    return Model.Of(ctx, modA);
                }
            }
            """;
        var secondary = """
            using Verso.Model;
            namespace Sample;
            public static class FlowsArchitecture
            {
                public static Model Build()
                {
                    var modB = new Module("mod_002", "B", "ctx_001");
                    var f = new DataFlow("flow_001", "mod_001", "mod_002", "Event");
                    return Model.Of(modB, f);
                }
            }
            """;
        var root = Path.Combine(Path.GetTempPath(), $"verso-multi-{Guid.NewGuid():N}");
        Directory.CreateDirectory(Path.Combine(root, "Architecture"));
        await File.WriteAllTextAsync(Path.Combine(root, "Sample.csproj"), csproj);
        await File.WriteAllTextAsync(Path.Combine(root, "Architecture", "Architecture.cs"), primary);
        await File.WriteAllTextAsync(Path.Combine(root, "Architecture", "Flows.cs"), secondary);
        try
        {
            await using var engine = await VersoEngine.OpenAsync(root);
            var arch = await engine.ReadArchModelAsync();
            arch.Should().NotBeNull();
            arch!.Elements.Should().Contain(e => e.Id == "mod_001");
            arch.Elements.Should().Contain(e => e.Id == "mod_002");
            arch.Links.Should().Contain(l => l.Id == "flow_001");
        }
        finally { try { Directory.Delete(root, recursive: true); } catch { } }
    }

    [Fact]
    public async Task MultiFile_writer_routes_op_to_correct_file()
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
        var primary = """
            using Verso.Model;
            namespace Sample;
            public static class Architecture
            {
                public static Model Build()
                {
                    var ctx = new BoundedContext("ctx_001", "Buyer");
                    return Model.Of(ctx);
                }
            }
            """;
        var secondary = """
            using Verso.Model;
            namespace Sample;
            public static class ModulesArchitecture
            {
                public static Model Build()
                {
                    var modA = new Module("mod_001", "A", "ctx_001");
                    return Model.Of(modA);
                }
            }
            """;
        var root = Path.Combine(Path.GetTempPath(), $"verso-multi-{Guid.NewGuid():N}");
        Directory.CreateDirectory(Path.Combine(root, "Architecture"));
        await File.WriteAllTextAsync(Path.Combine(root, "Sample.csproj"), csproj);
        await File.WriteAllTextAsync(Path.Combine(root, "Architecture", "Architecture.cs"), primary);
        var modulesPath = Path.Combine(root, "Architecture", "Modules.cs");
        await File.WriteAllTextAsync(modulesPath, secondary);
        try
        {
            await using var engine = await VersoEngine.OpenAsync(root);
            var result = await engine.ApplyAsync(new RenameElementOp("op1", "mod_001", "Onboarding"));
            if (result is Operations.OperationFailed f) throw new Xunit.Sdk.XunitException($"{f.Reason} {f.Message}");

            var primaryAfter = await File.ReadAllTextAsync(Path.Combine(root, "Architecture", "Architecture.cs"));
            var secondaryAfter = await File.ReadAllTextAsync(modulesPath);
            primaryAfter.Should().NotContain("\"Onboarding\"");
            secondaryAfter.Should().Contain("\"Onboarding\"");
        }
        finally { try { Directory.Delete(root, recursive: true); } catch { } }
    }

    [Fact]
    public async Task ViewsAdapter_round_trips_a_view_definition()
    {
        var view = new ArchView("view_abc", "Buyer Journey", "moduleMap", new[] { "mod_001", "mod_002" });
        var (path, content) = ViewsAdapter.Render("/tmp", "Sample", view);
        path.Should().EndWith(Path.Combine("Views", "BuyerJourney.cs"));
        content.Should().Contain("public static class BuyerJourney");
        content.Should().Contain("Id: \"view_abc\"");
        content.Should().Contain("\"mod_001\"");

        // Round-trip: parse the rendered C# and recover the view.
        var tree = Microsoft.CodeAnalysis.CSharp.CSharpSyntaxTree.ParseText(content);
        var roundTripped = ViewsAdapter.ReadAllFrom(new[] { ("/tmp/Views/BuyerJourney.cs", (Microsoft.CodeAnalysis.SyntaxNode)tree.GetRoot()) });
        roundTripped.Should().HaveCount(1);
        roundTripped[0].Id.Should().Be("view_abc");
        roundTripped[0].Name.Should().Be("Buyer Journey");
        roundTripped[0].BaseView.Should().Be("moduleMap");
        roundTripped[0].ElementIds.Should().BeEquivalentTo(new[] { "mod_001", "mod_002" });
    }

    [Fact]
    public async Task DrawioExporter_emits_valid_mxgraph_xml()
    {
        await using var ws = await CreateAsync("""
            var ctx = new BoundedContext("ctx_001", "Buyer");
            var a = new Module("mod_a", "Onboarding", "ctx_001");
            var b = new Module("mod_b", "Risk", "ctx_001");
            var flow = new DataFlow("flow_1", "mod_a", "mod_b", "OnboardedSupplier");
        """);
        await using var engine = await VersoEngine.OpenAsync(ws.RootPath);
        var arch = await engine.ReadArchModelAsync();
        var xml = DrawioExporter.Export(arch!);
        xml.Should().StartWith("<?xml");
        xml.Should().Contain("<mxfile");
        xml.Should().Contain("<mxGraphModel");
        xml.Should().Contain("id=\"mod_a\"");
        xml.Should().Contain("id=\"flow_1\"");
        xml.Should().Contain("OnboardedSupplier");
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
