using FluentAssertions;
using Verso.Engine.Discovery;
using Verso.Engine.Workspace;
using Xunit;

namespace Verso.Engine.Tests;

public class RecommenderTests
{
    [Fact]
    public async Task Layered_fixture_proposes_layered_architecture_view()
    {
        await using var ws = await TestWorkspace.CreateAsync(new()
        {
            ["Domain/Order.cs"] = "namespace Sample.Domain; public class Order { }",
            ["Application/Place.cs"] = "namespace Sample.Application; public class Place { }",
            ["Infrastructure/Repo.cs"] = "namespace Sample.Infrastructure; public class Repo { }",
        });
        await using var engine = await VersoEngine.OpenAsync(ws.RootPath);
        var bundle = await new DiscoveryService().RunAsync(engine.Model, engine.Solution);

        bundle.Recommendations.Should().Contain(r => r.Source == "layered-architecture");
    }

    [Fact]
    public async Task Recommendations_are_sorted_descending_by_value_score()
    {
        await using var ws = await TestWorkspace.CreateAsync(new()
        {
            ["A.cs"] = "namespace Sample; public class A { }",
            ["B.cs"] = "namespace Sample; public class B { }",
        });
        await using var engine = await VersoEngine.OpenAsync(ws.RootPath);
        var bundle = await new DiscoveryService().RunAsync(engine.Model, engine.Solution);
        var scores = bundle.Recommendations.Select(r => r.ValueScore).ToList();
        scores.Should().BeInDescendingOrder();
    }
}
