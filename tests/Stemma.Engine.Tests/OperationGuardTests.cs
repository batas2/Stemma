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
