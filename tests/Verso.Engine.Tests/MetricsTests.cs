using FluentAssertions;
using Verso.Engine.Discovery;
using Verso.Engine.Workspace;
using Xunit;

namespace Verso.Engine.Tests;

public class MetricsTests
{
    [Fact]
    public async Task Layered_fixture_yields_known_shape()
    {
        // Domain has only inbound edges (high stability). Infrastructure has only outbound (high I).
        await using var ws = await TestWorkspace.CreateAsync(new()
        {
            ["Domain/Order.cs"] = "namespace Sample.Domain; public class Order { }",
            ["Domain/Customer.cs"] = "namespace Sample.Domain; public class Customer { }",
            ["Application/PlaceOrder.cs"] = """
                namespace Sample.Application;
                using Sample.Domain;
                public class PlaceOrder { public Order Place(Customer c) => new Order(); }
                """,
            ["Infrastructure/Repo.cs"] = """
                namespace Sample.Infrastructure;
                using Sample.Application;
                public class Repo { public PlaceOrder Build() => new PlaceOrder(); }
                """,
        });
        await using var engine = await VersoEngine.OpenAsync(ws.RootPath);
        var bundle = await new DiscoveryService().RunAsync(engine.Model, engine.Solution);

        var domain = bundle.Metrics.Modules.First(m => m.ModuleName == "Domain");
        var infra = bundle.Metrics.Modules.First(m => m.ModuleName == "Infrastructure");

        // Domain: zero efferent edges (it depends on nothing), only inbound → I = 0
        domain.Ce.Should().Be(0);
        domain.Instability.Should().Be(0);

        // Infrastructure: only outbound, so Ca = 0 and I = 1
        infra.Ca.Should().Be(0);
        infra.Instability.Should().Be(1);
    }

    [Fact]
    public async Task Distance_from_main_sequence_is_within_unit_interval()
    {
        await using var ws = await TestWorkspace.CreateAsync(new()
        {
            ["Foo.cs"] = "namespace Sample; public class Foo { }",
        });
        await using var engine = await VersoEngine.OpenAsync(ws.RootPath);
        var bundle = await new DiscoveryService().RunAsync(engine.Model, engine.Solution);
        bundle.Metrics.Modules.All(m =>
            m.DistanceFromMainSequence >= 0 && m.DistanceFromMainSequence <= 1.001).Should().BeTrue();
    }
}
