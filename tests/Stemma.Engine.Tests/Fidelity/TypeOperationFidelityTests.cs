using FluentAssertions;
using Stemma.Engine.Models;
using Stemma.Engine.Operations;
using Stemma.Engine.Workspace;
using Xunit;

namespace Stemma.Engine.Tests.Fidelity;

/// <summary>
/// The fidelity suite for the type operations — the class-level half of the catalog, which the
/// canvas does not drive today but the operation protocol accepts. Same rule as the architecture
/// operations: the whole file compared, then undone and redone byte for byte.
/// </summary>
public sealed class TypeOperationFidelityTests
{
    public static TheoryData<string, string> Cases()
    {
        var data = new TheoryData<string, string>();
        foreach (var (fixture, cases) in TypeFidelityCases.All)
            foreach (var c in cases)
                data.Add(fixture, c.Name);
        return data;
    }

    [Theory]
    [MemberData(nameof(Cases))]
    public async Task A_type_operation_changes_only_its_target_and_undo_puts_back_every_byte(string fixture, string operation)
    {
        var c = TypeFidelityCases.Find(fixture, operation);
        await using var ws = await FixtureWorkspace.CreateForTypesAsync(fixture);
        var before = ws.ReadArch();
        var expected = Fidelity.Expect(before, c.Edits);

        await using var engine = await StemmaEngine.OpenAsync(ws.RootPath);

        (await engine.ApplyAsync(c.Op(ws.ArchPath))).ShouldBeApplied();
        ws.ReadArch().ShouldBeExactly(expected, "an operation may change only the text it targets");

        (await engine.UndoAsync("undo")).ShouldBeApplied();
        ws.ReadArch().ShouldBeExactly(before, "undo has to put back every byte the operation changed");

        (await engine.RedoAsync("redo")).ShouldBeApplied();
        ws.ReadArch().ShouldBeExactly(expected, "redo has to reproduce the operation exactly");
    }

    [Fact]
    public async Task Adding_a_type_in_a_new_file_writes_that_file_and_touches_no_other()
    {
        await using var ws = await FixtureWorkspace.CreateForTypesAsync("realistic");
        var before = ws.ReadArch();
        var newFile = Path.Combine(ws.RootPath, "Domain", "Payment.cs");
        await using var engine = await StemmaEngine.OpenAsync(ws.RootPath);

        (await engine.ApplyAsync(new AddTypeOp("op", newFile, "Fixture", "Payment", TypeKind.Record, Visibility.Internal))).ShouldBeApplied();

        ws.ReadArch().ShouldBeExactly(before, "no other file is the new type's business");
        (await File.ReadAllTextAsync(newFile)).Should().Be("namespace Fixture;\n\ninternal record Payment\n{\n}\n");

        (await engine.UndoAsync("undo")).ShouldBeApplied();
        File.Exists(newFile).Should().BeFalse("undoing the add removes the file it created");
    }

    [Fact]
    public async Task Removing_the_base_class_of_a_type_that_only_implements_interfaces_is_refused()
    {
        // Its first base-list entry is an interface. Removing "the inheritance" by position would
        // remove that instead.
        await using var ws = await FixtureWorkspace.CreateForTypesAsync("minimal");
        await File.WriteAllTextAsync(ws.ArchPath, (await File.ReadAllTextAsync(ws.ArchPath)).Replace("public class Invoice\n", "public class Invoice : IPriced\n"));
        await using var engine = await StemmaEngine.OpenAsync(ws.RootPath);

        var result = await engine.ApplyAsync(new RemoveInheritanceOp("op", "Fixture.Invoice"));

        result.Should().BeOfType<OperationFailed>().Which.Reason.Should().Be("NoBaseClass");
        (await File.ReadAllTextAsync(ws.ArchPath)).Should().Contain("public class Invoice : IPriced\n");
    }
}
