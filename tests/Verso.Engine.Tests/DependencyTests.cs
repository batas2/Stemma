using FluentAssertions;
using Verso.Engine.Discovery;
using Verso.Engine.Workspace;
using Xunit;

namespace Verso.Engine.Tests;

public class DependencyTests
{
    [Fact]
    public async Task Detects_inheritance_and_implementation()
    {
        await using var ws = await TestWorkspace.CreateAsync(new()
        {
            ["IThing.cs"] = "namespace Sample; public interface IThing { }",
            ["BaseThing.cs"] = "namespace Sample; public class BaseThing { }",
            ["Thing.cs"] = "namespace Sample; public class Thing : BaseThing, IThing { }",
        });
        await using var engine = await VersoEngine.OpenAsync(ws.RootPath);
        var bundle = await new DiscoveryService().RunAsync(engine.Model, engine.Solution);

        bundle.Discovered.Edges.Should().Contain(e => e.Kind == EdgeKind.Inherits);
        bundle.Discovered.Edges.Should().Contain(e => e.Kind == EdgeKind.Implements);
    }

    [Fact]
    public async Task Detects_constructor_injection()
    {
        await using var ws = await TestWorkspace.CreateAsync(new()
        {
            ["IClock.cs"] = "namespace Sample; public interface IClock { }",
            ["Service.cs"] = """
                namespace Sample;
                public class Service
                {
                    private readonly IClock _clock;
                    public Service(IClock clock) { _clock = clock; }
                }
                """,
        });
        await using var engine = await VersoEngine.OpenAsync(ws.RootPath);
        var bundle = await new DiscoveryService().RunAsync(engine.Model, engine.Solution);

        bundle.Discovered.Edges.Should().Contain(e => e.Kind == EdgeKind.Injects && !e.External);
    }

    [Fact]
    public async Task Detects_object_creation()
    {
        await using var ws = await TestWorkspace.CreateAsync(new()
        {
            ["Thing.cs"] = "namespace Sample; public class Thing { }",
            ["Maker.cs"] = """
                namespace Sample;
                public class Maker { public Thing Make() { return new Thing(); } }
                """,
        });
        await using var engine = await VersoEngine.OpenAsync(ws.RootPath);
        var bundle = await new DiscoveryService().RunAsync(engine.Model, engine.Solution);

        bundle.Discovered.Edges.Should().Contain(e => e.Kind == EdgeKind.Instantiates);
    }

    [Fact]
    public async Task Phantom_external_marks_unresolved_targets()
    {
        // A reference to an unresolved type ('SomeExternalThing' has no declaration in this workspace)
        // should produce a structural edge with External=true.
        await using var ws = await TestWorkspace.CreateAsync(new()
        {
            ["Foo.cs"] = """
                namespace Sample;
                public class Foo : SomeExternalThing { }
                """,
        });
        await using var engine = await VersoEngine.OpenAsync(ws.RootPath);
        var bundle = await new DiscoveryService().RunAsync(engine.Model, engine.Solution);
        bundle.Discovered.Edges.Should().Contain(e => e.External && e.ToTypeId.StartsWith("external:"));
    }
}
