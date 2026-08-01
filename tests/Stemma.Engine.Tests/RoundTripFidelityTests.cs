using FluentAssertions;
using Stemma.Engine.Models;
using Stemma.Engine.Operations;
using Stemma.Engine.Workspace;
using Xunit;

namespace Stemma.Engine.Tests;

public class RoundTripFidelityTests
{
    [Fact]
    public async Task RenameType_preserves_unrelated_trivia()
    {
        const string source = """
        // Header comment must survive
        namespace Sample;

        // Customer is the buyer.
        public class Customer
        {
            // Primary email of the customer.
            public string Email { get; set; } = string.Empty;
        }
        """;
        await using var ws = await TestWorkspace.CreateAsync(new() { ["Customer.cs"] = source });
        await using var engine = await StemmaEngine.OpenAsync(ws.RootPath);

        var result = await engine.ApplyAsync(new RenameTypeOp("op1", "Sample.Customer", "Buyer"));
        result.Should().BeOfType<OperationApplied>();

        var newSource = ws.ReadFile("Customer.cs");
        newSource.Should().Contain("// Header comment must survive");
        newSource.Should().Contain("// Customer is the buyer.");
        newSource.Should().Contain("// Primary email of the customer.");
        newSource.Should().Contain("public class Buyer");
        newSource.Should().NotContain("public class Customer");
    }

    [Fact]
    public async Task AddProperty_preserves_existing_members_and_trivia()
    {
        const string source = """
        namespace Sample;

        // A simple class.
        public class Order
        {
            // Existing prop.
            public Guid Id { get; init; }
        }
        """;
        await using var ws = await TestWorkspace.CreateAsync(new() { ["Order.cs"] = source });
        await using var engine = await StemmaEngine.OpenAsync(ws.RootPath);

        var result = await engine.ApplyAsync(new AddPropertyOp("op2", "Sample.Order", "Total", "decimal", Visibility.Public, true, true, false));
        result.Should().BeOfType<OperationApplied>();

        var newSource = ws.ReadFile("Order.cs");
        newSource.Should().Contain("// A simple class.");
        newSource.Should().Contain("// Existing prop.");
        newSource.Should().Contain("public Guid Id { get; init; }");
        newSource.Should().Contain("Total");
    }

    [Fact]
    public async Task RemoveProperty_keeps_other_members_and_comments()
    {
        const string source = """
        namespace Sample;

        public class Order
        {
            public Guid Id { get; init; }
            public string Note { get; set; } = string.Empty;
        }
        """;
        await using var ws = await TestWorkspace.CreateAsync(new() { ["Order.cs"] = source });
        await using var engine = await StemmaEngine.OpenAsync(ws.RootPath);

        var result = await engine.ApplyAsync(new RemovePropertyOp("op3", "Sample.Order", "Note"));
        result.Should().BeOfType<OperationApplied>();

        var newSource = ws.ReadFile("Order.cs");
        newSource.Should().Contain("public Guid Id { get; init; }");
        newSource.Should().NotContain("public string Note");
    }

    [Fact]
    public async Task AddInheritance_links_two_classes()
    {
        const string source = """
        namespace Sample;

        public class Animal
        {
        }

        public class Dog
        {
        }
        """;
        await using var ws = await TestWorkspace.CreateAsync(new() { ["Sample.cs"] = source });
        await using var engine = await StemmaEngine.OpenAsync(ws.RootPath);

        var result = await engine.ApplyAsync(new AddInheritanceOp("op4", "Sample.Dog", "Sample.Animal"));
        result.Should().BeOfType<OperationApplied>();

        var newSource = ws.ReadFile("Sample.cs");
        newSource.Should().Contain("class Dog : Animal");
    }

    [Fact]
    public async Task AddType_creates_new_file_and_compiles()
    {
        await using var ws = await TestWorkspace.CreateAsync(new() { ["Empty.cs"] = "namespace Sample;\n" });
        await using var engine = await StemmaEngine.OpenAsync(ws.RootPath);

        var newFilePath = Path.Combine(Path.GetDirectoryName(ws.ProjectFile)!, "NewClass.cs");
        var result = await engine.ApplyAsync(new AddTypeOp("op5", newFilePath, "Sample", "NewClass", TypeKind: TypeKind.Class, Visibility: Visibility.Public));
        result.Should().BeOfType<OperationApplied>();
        File.Exists(newFilePath).Should().BeTrue();

        engine.Model.AllTypes.Should().Contain(t => t.Name == "NewClass");
    }

    [Fact]
    public async Task RenameProperty_updates_all_references()
    {
        const string source = """
        namespace Sample;

        public class Customer
        {
            public string Email { get; set; } = string.Empty;
        }

        public class CustomerService
        {
            public string GetEmail(Customer c) => c.Email;
        }
        """;
        await using var ws = await TestWorkspace.CreateAsync(new() { ["Sample.cs"] = source });
        await using var engine = await StemmaEngine.OpenAsync(ws.RootPath);

        var result = await engine.ApplyAsync(new RenamePropertyOp("op6", "Sample.Customer", "Email", "PrimaryEmail"));
        result.Should().BeOfType<OperationApplied>();

        var newSource = ws.ReadFile("Sample.cs");
        newSource.Should().Contain("public string PrimaryEmail");
        newSource.Should().Contain("c.PrimaryEmail");
        newSource.Should().NotContain("c.Email");
    }

    [Fact]
    public async Task Compile_gate_rejects_breaking_op()
    {
        const string source = """
        namespace Sample;

        public class A
        {
            public string Name { get; set; } = string.Empty;
        }

        public class B
        {
            public string Use(A a) => a.Name;
        }
        """;
        await using var ws = await TestWorkspace.CreateAsync(new() { ["Sample.cs"] = source });
        await using var engine = await StemmaEngine.OpenAsync(ws.RootPath);
        var before = ws.ReadFile("Sample.cs");

        var result = await engine.ApplyAsync(new RemovePropertyOp("op7", "Sample.A", "Name"));
        result.Should().BeOfType<OperationFailed>();
        ((OperationFailed)result).Reason.Should().Be("WouldBreakBuild");

        var after = ws.ReadFile("Sample.cs");
        after.Should().Be(before);
    }
}
