using FluentAssertions;
using Stemma.Engine.ArchModel;
using Stemma.Engine.Operations;
using Stemma.Engine.Workspace;
using Xunit;

namespace Stemma.Engine.Tests;

/// <summary>
/// An id the engine generates is one nothing names yet. Removing an element leaves its links, its
/// layout, its notes and its comments behind on purpose — they are references, and the UI shows them
/// detached — so an id that was free in the model alone was not free: a new element given it
/// inherited all of them, and a link that had been left pointing at nothing pointed at the new box.
/// </summary>
public sealed class GeneratedIdTests
{
    private const string Source = """
        using Stemma.Model;

        namespace Scratch;

        public static class Architecture
        {
            public static Model Build()
            {
                var ctx = new BoundedContext("ctx_001", "Ordering");
                var modA = new Module("mod_a", "A");

                return Model.Of(ctx, modA);
            }
        }

        """;

    private static async Task<string> CreateAsync(string source = Source)
    {
        var root = Path.Combine(Path.GetTempPath(), $"stemma-ids-{Guid.NewGuid():N}");
        Directory.CreateDirectory(Path.Combine(root, "Architecture"));
        await File.WriteAllTextAsync(Path.Combine(root, "Architecture", "Architecture.cs"), source);
        return root;
    }

    private static string AddedId(OperationResult result) =>
        result.Should().BeOfType<OperationApplied>().Which.Deltas
            .Select(d => d switch { ElementAdded e => e.Id, LinkAdded l => l.Id, _ => null })
            .OfType<string>().Single();

    [Fact]
    public async Task A_new_element_does_not_take_the_id_of_a_removed_one_its_links_still_name()
    {
        var root = await CreateAsync();
        try
        {
            await using var engine = await StemmaEngine.OpenAsync(root);
            var billing = AddedId(await engine.ApplyAsync(new AddElementOp("o1", ArchElementKind.Module, "Billing")));
            AddedId(await engine.ApplyAsync(new AddLinkOp("o2", ArchLinkKind.DataFlow, billing, "mod_a", Payload: "Invoice")));
            (await engine.ApplyAsync(new RemoveElementOp("o3", billing))).Should().BeOfType<OperationApplied>();

            var marketing = AddedId(await engine.ApplyAsync(new AddElementOp("o4", ArchElementKind.Module, "Marketing")));

            marketing.Should().NotBe(billing, "the link Billing left behind still names its id");
            var model = (await engine.ReadArchModelAsync())!;
            model.Links.Should().ContainSingle().Which.FromId.Should().Be(billing, "the detached link stays detached");
            model.Links.Should().NotContain(l => l.FromId == marketing || l.ToId == marketing);
        }
        finally { Directory.Delete(root, recursive: true); }
    }

    [Fact]
    public async Task A_new_element_does_not_take_an_id_the_layout_comments_or_a_view_still_name()
    {
        var root = await CreateAsync();
        try
        {
            // Left behind by elements removed earlier: a style and a note, a comment, a view member.
            await File.WriteAllTextAsync(Path.Combine(root, "stemma.layout.json"), """
                {
                  "version": 1,
                  "nodeStyles": { "mod_001": { "fill": "#ffcc00" } },
                  "notes": { "mod_002": "Kept for the audit." }
                }
                """);
            await File.WriteAllTextAsync(Path.Combine(root, "comments.stemma.json"), """
                {
                  "version": 1,
                  "comments": [
                    { "id": "cmt_1", "targetKind": "element", "targetId": "mod_003", "author": "ada",
                      "createdAt": "2026-10-01T09:00:00Z", "body": "Who owns this?", "resolved": false, "thread": [] }
                  ]
                }
                """);
            Directory.CreateDirectory(Path.Combine(root, "Views"));
            await File.WriteAllTextAsync(Path.Combine(root, "Views", "Checkout.cs"), """
                using Stemma.Model;

                namespace Scratch;

                public static class Checkout
                {
                    public static View Define() => new(Id: "view_checkout", Name: "Checkout", BaseView: "all", ElementIds: ["mod_a", "mod_004"]);
                }
                """);
            await using var engine = await StemmaEngine.OpenAsync(root);

            var id = AddedId(await engine.ApplyAsync(new AddElementOp("op", ArchElementKind.Module, "Pricing")));

            id.Should().Be("mod_005");
        }
        finally { Directory.Delete(root, recursive: true); }
    }

    [Fact]
    public async Task A_new_link_does_not_take_an_id_the_layout_still_names()
    {
        var root = await CreateAsync();
        try
        {
            await File.WriteAllTextAsync(Path.Combine(root, "stemma.layout.json"), """
                { "version": 1, "edgeStyles": { "flow_001": { "stroke": "#ff0000" } } }
                """);
            await using var engine = await StemmaEngine.OpenAsync(root);

            var id = AddedId(await engine.ApplyAsync(new AddLinkOp("op", ArchLinkKind.DataFlow, "ctx_001", "mod_a", Payload: "Order")));

            id.Should().Be("flow_002");
        }
        finally { Directory.Delete(root, recursive: true); }
    }

    [Fact]
    public async Task Redoing_an_add_brings_back_the_same_id_even_once_the_layout_names_it()
    {
        // The new element is placed on the canvas before it is undone, so the layout names its id by
        // the time it is redone. Redo is the same edit again, not a new element that misses its box.
        var root = await CreateAsync();
        try
        {
            await using var engine = await StemmaEngine.OpenAsync(root);
            var id = AddedId(await engine.ApplyAsync(new AddElementOp("op", ArchElementKind.Module, "Pricing")));
            await File.WriteAllTextAsync(Path.Combine(root, "stemma.layout.json"),
                $$"""{ "version": 1, "views": { "all": { "nodes": { "{{id}}": { "x": 10, "y": 20 } } } } }""");

            (await engine.UndoAsync("undo")).Should().BeOfType<OperationApplied>();
            var redone = await engine.RedoAsync("redo");

            AddedId(redone).Should().Be(id);
            (await engine.ReadArchModelAsync())!.Elements.Should().ContainSingle(e => e.Name == "Pricing").Which.Id.Should().Be(id);
        }
        finally { Directory.Delete(root, recursive: true); }
    }
}
