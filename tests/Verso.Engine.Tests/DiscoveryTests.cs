using FluentAssertions;
using Verso.Engine.Discovery;
using Verso.Engine.Workspace;
using Xunit;

namespace Verso.Engine.Tests;

public class DiscoveryTests
{
    [Fact]
    public async Task Run_emits_modules_namespaces_projects_for_layered_workspace()
    {
        await using var ws = await TestWorkspace.CreateAsync(new()
        {
            ["Domain/Order.cs"] = """
                namespace Sample.Domain;
                public class Order { public Guid Id { get; init; } }
                """,
            ["Domain/Customer.cs"] = """
                namespace Sample.Domain;
                public class Customer { public string Name { get; set; } = string.Empty; }
                """,
            ["Application/PlaceOrder.cs"] = """
                namespace Sample.Application;
                public class PlaceOrder { }
                """,
            ["Infrastructure/OrderRepo.cs"] = """
                namespace Sample.Infrastructure;
                public class OrderRepo { }
                """,
        });
        await using var engine = await VersoEngine.OpenAsync(ws.RootPath);
        var service = new DiscoveryService();

        var bundle = await service.RunAsync(engine.Model, engine.Solution);

        bundle.Discovered.Modules.Should().HaveCountGreaterOrEqualTo(3);
        bundle.Discovered.Modules.Select(m => m.Name)
            .Should().Contain(new[] { "Domain", "Application", "Infrastructure" });
        bundle.Discovered.Projects.Should().HaveCount(1);
        bundle.Discovered.Namespaces.Should().HaveCountGreaterOrEqualTo(3);
        bundle.Discovered.Modules.All(m => m.Confidence > 0).Should().BeTrue();
    }

    [Fact]
    public async Task Sidecar_round_trip_persists_and_reloads()
    {
        await using var ws = await TestWorkspace.CreateAsync(new()
        {
            ["Foo.cs"] = "namespace Sample; public class Foo { }",
        });
        await using var engine = await VersoEngine.OpenAsync(ws.RootPath);
        var service = new DiscoveryService();
        var fresh = await service.RunAsync(engine.Model, engine.Solution);
        var cached = service.ReadCached(engine.Model.RootPath);
        cached.Should().NotBeNull();
        cached!.Discovered.Modules.Should().HaveCount(fresh.Discovered.Modules.Count);
    }

    [Fact]
    public async Task Module_pin_overrides_namespace_heuristic()
    {
        await using var ws = await TestWorkspace.CreateAsync(new()
        {
            ["Foo/A.cs"] = "namespace Sample.Foo; public class A { }",
            ["Foo/B.cs"] = "namespace Sample.Foo; public class B { }",
            ["verso.discovery.json"] = """
                { "modulePins": [ { "folderOrNamespace": "Sample.Foo", "moduleName": "Pinned Foo" } ] }
                """,
        });
        // The pin file lives at workspace root, not inside the project subfolder.
        File.Move(
            Path.Combine(Path.GetDirectoryName(ws.ProjectFile)!, "verso.discovery.json"),
            Path.Combine(ws.RootPath, "verso.discovery.json"));

        await using var engine = await VersoEngine.OpenAsync(ws.RootPath);
        var bundle = await new DiscoveryService().RunAsync(engine.Model, engine.Solution);
        bundle.Discovered.Modules.Should().Contain(m => m.Name == "Pinned Foo");
    }
}
