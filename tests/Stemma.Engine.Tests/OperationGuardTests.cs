using FluentAssertions;
using Stemma.Engine.Operations;
using Stemma.Engine.Workspace;
using Stemma.Engine.Models;
using Xunit;

namespace Stemma.Engine.Tests;

/// <summary>
/// An operation's own values become C# text and file locations. A path outside the workspace was once
/// a write anywhere on disk — an existing file appended to — and a "name" was pasted into the file as
/// given. Both are refused before anything is written.
/// </summary>
public sealed class OperationGuardTests
{
    private const string Source = """
        namespace Sample;

        public class Customer
        {
            public string Email { get; set; } = string.Empty;
        }
        """;

    [Fact]
    public async Task A_type_cannot_be_added_to_a_file_outside_the_workspace()
    {
        await using var ws = await TestWorkspace.CreateAsync(new() { ["Customer.cs"] = Source });
        await using var engine = await StemmaEngine.OpenAsync(ws.RootPath);
        var outside = Path.Combine(Path.GetDirectoryName(ws.RootPath)!, $"victim-{Guid.NewGuid():N}.cs");
        try
        {
            File.WriteAllText(outside, "// someone else's file\n");
            var result = await engine.ApplyAsync(new AddTypeOp("op1", outside, "Evil", "Y", TypeKind.Class, Visibility.Public));
            result.Should().BeOfType<OperationFailed>().Which.Reason.Should().Be("OutsideWorkspace");
            File.ReadAllText(outside).Should().Be("// someone else's file\n");

            var climbing = await engine.ApplyAsync(new AddTypeOp("op2", Path.Combine(ws.RootPath, "..", "escape", "Evil.cs"), "Evil", "Y", TypeKind.Class, Visibility.Public));
            climbing.Should().BeOfType<OperationFailed>().Which.Reason.Should().Be("OutsideWorkspace");
        }
        finally
        {
            File.Delete(outside);
        }
    }

    [Theory]
    [InlineData("Y { } public class Z", "Sample")]
    [InlineData("Y", "Sample; using System")]
    [InlineData("", "Sample")]
    public async Task A_type_name_or_namespace_that_is_not_one_is_refused(string name, string ns)
    {
        await using var ws = await TestWorkspace.CreateAsync(new() { ["Customer.cs"] = Source });
        await using var engine = await StemmaEngine.OpenAsync(ws.RootPath);
        var before = ws.ReadFile("Customer.cs");

        var result = await engine.ApplyAsync(new AddTypeOp("op1", Path.Combine(ws.RootPath, "Added.cs"), ns, name, TypeKind.Class, Visibility.Public));

        result.Should().BeOfType<OperationFailed>().Which.Reason.Should().Be("InvalidName");
        File.Exists(Path.Combine(ws.RootPath, "Added.cs")).Should().BeFalse();
        ws.ReadFile("Customer.cs").Should().Be(before);
    }

    [Fact]
    public async Task A_file_the_workspace_does_not_hold_is_not_overwritten()
    {
        await using var ws = await TestWorkspace.CreateAsync(new() { ["Customer.cs"] = Source });
        await using var engine = await StemmaEngine.OpenAsync(ws.RootPath);
        var kept = Path.Combine(ws.RootPath, "obj", "Keep.cs");
        Directory.CreateDirectory(Path.GetDirectoryName(kept)!);
        File.WriteAllText(kept, "// build output\n");

        var result = await engine.ApplyAsync(new AddTypeOp("op1", kept, "Sample", "Y", TypeKind.Class, Visibility.Public));

        result.Should().BeOfType<OperationFailed>().Which.Reason.Should().Be("OutsideWorkspace");
        File.ReadAllText(kept).Should().Be("// build output\n");
    }

    [Fact]
    public async Task A_type_for_a_namespace_the_file_does_not_declare_is_refused_before_anything_is_written()
    {
        // It was written into the file's own namespace, then not found under the one asked for, and
        // reported AddTypeFailed with the file already changed.
        await using var ws = await TestWorkspace.CreateAsync(new() { ["Customer.cs"] = Source });
        await using var engine = await StemmaEngine.OpenAsync(ws.RootPath);
        var before = ws.ReadFile("Customer.cs");

        var result = await engine.ApplyAsync(new AddTypeOp("op1", Path.Combine(Path.GetDirectoryName(ws.ProjectFile)!, "Customer.cs"),
            "Billing", "Invoice", TypeKind.Class, Visibility.Public));

        result.Should().BeOfType<OperationFailed>().Which.Reason.Should().Be("NamespaceNotInFile");
        ws.ReadFile("Customer.cs").Should().Be(before);
        engine.Undo.CanUndo.Should().BeFalse();
    }

    [Fact]
    public async Task A_type_in_a_file_outside_every_project_folder_is_refused_before_anything_is_written()
    {
        // The project does not compile a file outside its folder: the type was there for this session
        // and gone the next time the workspace was opened.
        await using var ws = await TestWorkspace.CreateAsync(new() { ["Customer.cs"] = Source });
        await using var engine = await StemmaEngine.OpenAsync(ws.RootPath);
        var loose = Path.Combine(ws.RootPath, "Loose.cs");

        var result = await engine.ApplyAsync(new AddTypeOp("op1", loose, "Sample", "Loose", TypeKind.Class, Visibility.Public));

        result.Should().BeOfType<OperationFailed>().Which.Reason.Should().Be("NoProject");
        File.Exists(loose).Should().BeFalse();
    }

    [Fact]
    public async Task A_relative_path_is_a_file_in_the_workspace_not_beside_the_process()
    {
        var root = Path.Combine(Path.GetTempPath(), $"stemma-guard-{Guid.NewGuid():N}");
        Directory.CreateDirectory(Path.Combine(root, "Architecture"));
        await File.WriteAllTextAsync(Path.Combine(root, "Architecture", "Architecture.cs"),
            "using Stemma.Model;\n\nnamespace Scratch;\n\npublic static class Architecture\n{\n    public static Model Build() => Model.Of();\n}\n");
        var stray = Path.Combine(Environment.CurrentDirectory, "Domain", "Invoice.cs");
        try
        {
            await using var engine = await StemmaEngine.OpenAsync(root);

            var result = await engine.ApplyAsync(new AddTypeOp("op1", Path.Combine("Domain", "Invoice.cs"), "Scratch", "Invoice", TypeKind.Class, Visibility.Public));

            result.Should().BeOfType<OperationApplied>();
            File.Exists(Path.Combine(root, "Domain", "Invoice.cs")).Should().BeTrue();
            File.Exists(stray).Should().BeFalse("the path was checked against the workspace, and is written there");
        }
        finally
        {
            Directory.Delete(root, recursive: true);
            if (File.Exists(stray)) File.Delete(stray);
        }
    }

    [Fact]
    public async Task A_generated_file_is_never_written()
    {
        await using var ws = await TestWorkspace.CreateAsync(new() { ["Customer.cs"] = Source });
        await using var engine = await StemmaEngine.OpenAsync(ws.RootPath);
        var result = await engine.ApplyAsync(new AddTypeOp("op1", Path.Combine(ws.RootPath, "Model.g.cs"), "Sample", "Y", TypeKind.Class, Visibility.Public));
        result.Should().BeOfType<OperationFailed>().Which.Reason.Should().Be("GeneratedFile");
    }

    [Fact]
    public async Task A_property_or_a_rename_that_is_not_a_name_is_refused()
    {
        await using var ws = await TestWorkspace.CreateAsync(new() { ["Customer.cs"] = Source });
        await using var engine = await StemmaEngine.OpenAsync(ws.RootPath);
        var before = ws.ReadFile("Customer.cs");

        (await engine.ApplyAsync(new AddPropertyOp("op1", "Sample.Customer", "X { get; } public void Run() {} int Y", "int", Visibility.Public, true, true, false)))
            .Should().BeOfType<OperationFailed>().Which.Reason.Should().Be("InvalidName");
        (await engine.ApplyAsync(new AddPropertyOp("op2", "Sample.Customer", "Age", "int { get; } int Z", Visibility.Public, true, true, false)))
            .Should().BeOfType<OperationFailed>().Which.Reason.Should().Be("InvalidName");
        (await engine.ApplyAsync(new RenameTypeOp("op3", "Sample.Customer", "Buyer : System.IDisposable")))
            .Should().BeOfType<OperationFailed>().Which.Reason.Should().Be("InvalidName");
        ws.ReadFile("Customer.cs").Should().Be(before);

        // The ordinary case still works.
        (await engine.ApplyAsync(new AddPropertyOp("op4", "Sample.Customer", "Age", "System.Collections.Generic.List<int>?", Visibility.Public, true, true, false)))
            .Should().BeOfType<OperationApplied>();
    }
}
