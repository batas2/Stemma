using FluentAssertions;
using Verso.Engine.Models;
using Verso.Engine.Workspace;
using Xunit;

namespace Verso.Engine.Tests;

public class EngineLoadTests
{
    [Fact]
    public async Task Loads_simple_class()
    {
        await using var ws = await TestWorkspace.CreateAsync(new Dictionary<string, string>
        {
            ["Order.cs"] = """
            namespace Sample.Orders;

            public class Order
            {
                public Guid Id { get; init; }
                public string CustomerName { get; set; } = string.Empty;
            }
            """
        });
        await using var engine = await VersoEngine.OpenAsync(ws.RootPath);

        var order = engine.Model.AllTypes.FirstOrDefault(t => t.Name == "Order");
        order.Should().NotBeNull();
        order!.Namespace.Should().Be("Sample.Orders");
        order.Kind.Should().Be(TypeKind.Class);
        order.Properties.Should().HaveCount(2);
        order.Properties.Single(p => p.Name == "Id").HasInit.Should().BeTrue();
        order.Properties.Single(p => p.Name == "CustomerName").HasSetter.Should().BeTrue();
    }

    [Fact]
    public async Task Loads_interface_and_record()
    {
        await using var ws = await TestWorkspace.CreateAsync(new Dictionary<string, string>
        {
            ["Types.cs"] = """
            namespace Sample;

            public interface IRepo
            {
            }

            public record Money(decimal Amount, string Currency);
            """
        });
        await using var engine = await VersoEngine.OpenAsync(ws.RootPath);

        engine.Model.AllTypes.Should().Contain(t => t.Name == "IRepo" && t.Kind == TypeKind.Interface);
        engine.Model.AllTypes.Should().Contain(t => t.Name == "Money" && t.Kind == TypeKind.Record);
    }
}
