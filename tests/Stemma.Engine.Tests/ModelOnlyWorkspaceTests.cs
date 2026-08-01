using FluentAssertions;
using Stemma.Engine.ArchModel;
using Stemma.Engine.Operations;
using Stemma.Engine.Workspace;
using Xunit;

namespace Stemma.Engine.Tests;

/// <summary>
/// The SDK-free load path (ADR-0016). These tests deliberately create workspaces with no .sln and no
/// .csproj, which is exactly what the from-scratch scaffold produces — so if MSBuild were still
/// required, every one of them would fail.
/// </summary>
public sealed class ModelOnlyWorkspaceTests
{
    private const string MinimalModel = """
        using Stemma.Model;

        namespace Scratch;

        public static class Architecture
        {
            public static Model Build()
            {
                // a deliberate comment, and blank lines below

                var ctx = new BoundedContext("ctx_001", "Ordering");

                return Model.Of(ctx);
            }
        }
        """;

    private static async Task<string> CreateModelOnlyWorkspaceAsync(string source = MinimalModel)
    {
        var root = Path.Combine(Path.GetTempPath(), $"stemma-modelonly-{Guid.NewGuid():N}");
        Directory.CreateDirectory(Path.Combine(root, "Architecture"));
        await File.WriteAllTextAsync(Path.Combine(root, "Architecture", "Architecture.cs"), source);
        return root;
    }

    [Fact]
    public async Task A_workspace_with_no_project_file_is_detected_as_model_only()
    {
        var root = await CreateModelOnlyWorkspaceAsync();
        try
        {
            ModelWorkspaceLoader.DetectKind(root).Should().Be(WorkspaceKind.ModelOnly);
        }
        finally { Directory.Delete(root, recursive: true); }
    }

    [Fact]
    public async Task An_empty_directory_is_detected_as_nothing_to_open()
    {
        var root = Path.Combine(Path.GetTempPath(), $"stemma-empty-{Guid.NewGuid():N}");
        Directory.CreateDirectory(root);
        try
        {
            ModelWorkspaceLoader.DetectKind(root).Should().Be(WorkspaceKind.None);
        }
        finally { Directory.Delete(root, recursive: true); }
    }

    [Fact]
    public async Task Model_only_workspace_opens_and_reads_its_elements()
    {
        var root = await CreateModelOnlyWorkspaceAsync();
        try
        {
            await using var engine = await StemmaEngine.OpenAsync(root);
            var arch = await engine.ReadArchModelAsync();

            arch.Should().NotBeNull();
            arch!.Elements.Should().ContainSingle(e => e.Id == "ctx_001" && e.Name == "Ordering");
        }
        finally { Directory.Delete(root, recursive: true); }
    }

    [Fact]
    public async Task Adding_an_element_writes_through_to_disk()
    {
        var root = await CreateModelOnlyWorkspaceAsync();
        var file = Path.Combine(root, "Architecture", "Architecture.cs");
        try
        {
            await using (var engine = await StemmaEngine.OpenAsync(root))
            {
                var result = await engine.ApplyAsync(
                    new AddElementOp($"op_{Guid.NewGuid():N}", ArchElementKind.Module, "Pricing", ContextId: "ctx_001"));
                result.Should().BeOfType<OperationApplied>();
            }

            // The point of FileBackedWorkspace: the edit is on disk, not just in memory.
            var onDisk = await File.ReadAllTextAsync(file);
            onDisk.Should().Contain("Pricing");
        }
        finally { Directory.Delete(root, recursive: true); }
    }

    [Fact]
    public async Task Round_trip_preserves_comments_and_blank_lines()
    {
        var root = await CreateModelOnlyWorkspaceAsync();
        var file = Path.Combine(root, "Architecture", "Architecture.cs");
        var before = await File.ReadAllTextAsync(file);
        try
        {
            await using (var engine = await StemmaEngine.OpenAsync(root))
            {
                await engine.ApplyAsync(
                    new AddElementOp($"op_{Guid.NewGuid():N}", ArchElementKind.Module, "Pricing", ContextId: "ctx_001"));
            }

            var after = await File.ReadAllTextAsync(file);

            after.Should().Contain("// a deliberate comment, and blank lines below");
            after.Should().Contain("        var ctx = new BoundedContext(\"ctx_001\", \"Ordering\");");
            after.Split('\n').Count(l => l.Trim().Length == 0)
                .Should().Be(before.Split('\n').Count(l => l.Trim().Length == 0),
                    "blank lines are trivia and must survive the rewrite");

            // The only line allowed to change is the Model.Of(...) call that now lists the new
            // element; everything else must be untouched.
            var changed = before.Split('\n').Select(l => l.TrimEnd())
                .Where(l => l.Length > 0 && !after.Contains(l))
                .ToList();
            changed.Should().ContainSingle().Which.Should().Contain("return Model.Of(");
        }
        finally { Directory.Delete(root, recursive: true); }
    }

    [Fact]
    public async Task File_encoding_and_bom_survive_a_write()
    {
        var root = await CreateModelOnlyWorkspaceAsync();
        var file = Path.Combine(root, "Architecture", "Architecture.cs");
        // rewrite the fixture with a BOM, the way Visual Studio would have saved it
        await File.WriteAllBytesAsync(file,
                new System.Text.UTF8Encoding(encoderShouldEmitUTF8Identifier: true).GetPreamble()
                    .Concat(System.Text.Encoding.UTF8.GetBytes(MinimalModel)).ToArray());
        try
        {
            await using (var engine = await StemmaEngine.OpenAsync(root))
            {
                await engine.ApplyAsync(
                    new AddElementOp($"op_{Guid.NewGuid():N}", ArchElementKind.Module, "Pricing", ContextId: "ctx_001"));
            }

            var bytes = await File.ReadAllBytesAsync(file);
            bytes.Take(3).Should().Equal(new byte[] { 0xEF, 0xBB, 0xBF }, "the byte-order mark must round-trip");
        }
        finally { Directory.Delete(root, recursive: true); }
    }

    [Fact]
    public async Task Renaming_an_element_works_without_a_project_system()
    {
        // Rename is the one operation that needs a Compilation, so it is the one that proves the
        // metadata references assembled from the host runtime are sufficient.
        var root = await CreateModelOnlyWorkspaceAsync();
        try
        {
            await using var engine = await StemmaEngine.OpenAsync(root);
            var result = await engine.ApplyAsync(
                new RenameElementOp($"op_{Guid.NewGuid():N}", "ctx_001", "Fulfilment"));

            result.Should().BeOfType<OperationApplied>();
            var arch = await engine.ReadArchModelAsync();
            arch!.Elements.Should().ContainSingle(e => e.Id == "ctx_001" && e.Name == "Fulfilment");
        }
        finally { Directory.Delete(root, recursive: true); }
    }
}
