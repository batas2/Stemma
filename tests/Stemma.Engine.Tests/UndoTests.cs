using FluentAssertions;
using Stemma.Engine.ArchModel;
using Stemma.Engine.Operations;
using Stemma.Engine.Workspace;
using Xunit;

namespace Stemma.Engine.Tests;

/// <summary>
/// Undo is judged the way the fidelity suite judges an edit: by the bytes on disk. "The element is
/// back" is not enough when it came back at the bottom of the file without the comment that sat
/// above it — that is a second edit, not the reversal of the first.
/// </summary>
public sealed class UndoTests
{
    private const string Source = """
        using Stemma.Model;

        namespace Scratch;

        public static class Architecture
        {
            public static Model Build()
            {
                var ctx = new BoundedContext("ctx_001", "Ordering");

                // Checkout is the slow one.
                var modCheckout = new Module("mod_001", "Checkout", "ctx_001"); // owned by Core
                var riskSlow = new Risk("risk_001", "Checkout is slow", "mod_001");
                var flow = new Relation("rel_001", "mod_001", "ctx_001", "lives in");

                // ── Tags ──
                Tag.For(modCheckout, lifecycle: new Lifecycle(Status: "current"));

                return Model.Of(ctx, modCheckout, riskSlow, flow);
            }
        }
        """;

    private static async Task<(string Root, string File)> CreateAsync()
    {
        var root = Path.Combine(Path.GetTempPath(), $"stemma-undo-{Guid.NewGuid():N}");
        Directory.CreateDirectory(Path.Combine(root, "Architecture"));
        var file = Path.Combine(root, "Architecture", "Architecture.cs");
        await File.WriteAllTextAsync(file, Source);
        return (root, file);
    }

    private static void Applied(OperationResult r)
    {
        if (r is OperationFailed f) throw new Xunit.Sdk.XunitException($"{f.Reason}: {f.Message}");
    }

    [Fact]
    public async Task Undo_puts_a_removed_element_back_where_it_was()
    {
        var (root, file) = await CreateAsync();
        try
        {
            await using var engine = await StemmaEngine.OpenAsync(root);
            Applied(await engine.ApplyAsync(new RemoveElementOp("op", "risk_001")));
            (await File.ReadAllTextAsync(file)).Should().NotContain("risk_001");

            Applied(await engine.UndoAsync("undo"));

            (await File.ReadAllTextAsync(file)).Should().Be(Source,
                "undoing a removal means the declaration returns to its own line, not to the end of the method");
        }
        finally { Directory.Delete(root, recursive: true); }
    }

    [Fact]
    public async Task Undo_puts_a_cleared_tag_back_where_it_was()
    {
        var (root, file) = await CreateAsync();
        try
        {
            await using var engine = await StemmaEngine.OpenAsync(root);
            Applied(await engine.ApplyAsync(new SetLifecycleOp("op", "mod_001", null, null, null, null)));
            Applied(await engine.UndoAsync("undo"));

            (await File.ReadAllTextAsync(file)).Should().Be(Source);
        }
        finally { Directory.Delete(root, recursive: true); }
    }

    [Fact]
    public async Task Undo_walks_back_several_edits_in_order()
    {
        var (root, file) = await CreateAsync();
        try
        {
            await using var engine = await StemmaEngine.OpenAsync(root);
            Applied(await engine.ApplyAsync(new RenameElementOp("op1", "mod_001", "Basket")));
            Applied(await engine.ApplyAsync(new SetLinkAttributeOp("op2", "rel_001", "label", "is part of")));
            Applied(await engine.ApplyAsync(new AddElementOp("op3", ArchElementKind.Module, "Pricing", ContextId: "ctx_001")));

            Applied(await engine.UndoAsync("u3"));
            Applied(await engine.UndoAsync("u2"));
            Applied(await engine.UndoAsync("u1"));

            (await File.ReadAllTextAsync(file)).Should().Be(Source);
            engine.Undo.CanUndo.Should().BeFalse();
            engine.Undo.RedoDepth.Should().Be(3);
        }
        finally { Directory.Delete(root, recursive: true); }
    }

    [Fact]
    public async Task Redo_reproduces_exactly_what_undo_took_back()
    {
        var (root, file) = await CreateAsync();
        try
        {
            await using var engine = await StemmaEngine.OpenAsync(root);
            Applied(await engine.ApplyAsync(new RemoveElementOp("op1", "risk_001")));
            Applied(await engine.ApplyAsync(new RenameElementOp("op2", "mod_001", "Basket")));
            var edited = await File.ReadAllTextAsync(file);

            Applied(await engine.UndoAsync("u2"));
            Applied(await engine.UndoAsync("u1"));
            Applied(await engine.RedoAsync("r1"));
            Applied(await engine.RedoAsync("r2"));

            (await File.ReadAllTextAsync(file)).Should().Be(edited);
            engine.Undo.CanRedo.Should().BeFalse();
        }
        finally { Directory.Delete(root, recursive: true); }
    }

    [Fact]
    public async Task A_new_edit_after_undo_discards_the_redo_branch()
    {
        var (root, _) = await CreateAsync();
        try
        {
            await using var engine = await StemmaEngine.OpenAsync(root);
            Applied(await engine.ApplyAsync(new RenameElementOp("op1", "mod_001", "Basket")));
            Applied(await engine.UndoAsync("u1"));
            Applied(await engine.ApplyAsync(new RenameElementOp("op2", "ctx_001", "Sales")));

            engine.Undo.CanRedo.Should().BeFalse();
            (await engine.RedoAsync("r")).Should().BeOfType<OperationFailed>()
                .Which.Reason.Should().Be("NothingToRedo");
        }
        finally { Directory.Delete(root, recursive: true); }
    }

    [Fact]
    public async Task Undo_after_the_file_changed_outside_Stemma_keeps_the_outside_edit()
    {
        // The exact reversal is only safe while the file is exactly what the edit left. Once someone
        // else has written to it, putting the old bytes back would erase their change, so undo falls
        // back to the inverse operation — which re-declares what was removed and touches nothing else.
        var (root, file) = await CreateAsync();
        try
        {
            await using var engine = await StemmaEngine.OpenAsync(root);
            engine.StartWatching();
            Applied(await engine.ApplyAsync(new RemoveElementOp("op", "risk_001")));

            await Task.Delay(TimeSpan.FromSeconds(2)); // past the window in which a write is our own echo
            const string marker = "// ── Tags, edited in an IDE ──";
            await File.WriteAllTextAsync(file, (await File.ReadAllTextAsync(file)).Replace("// ── Tags ──", marker));
            (await EngineHasSeenAsync(engine, file, marker)).Should().BeTrue("the watcher should take the outside edit in");

            Applied(await engine.UndoAsync("undo"));

            var after = await File.ReadAllTextAsync(file);
            after.Should().Contain("// ── Tags, edited in an IDE ──");
            var restored = (await engine.ReadArchModelAsync())!.Elements.Single(e => e.Id == "risk_001");
            restored.Name.Should().Be("Checkout is slow");
            restored.Attributes["aboutId"].Should().Be("mod_001", "what a Risk is about is part of what was removed");
        }
        finally { Directory.Delete(root, recursive: true); }
    }

    /// <summary>
    /// Waits on what the engine believes the file says, not on the watcher's event: the event also
    /// fires for the engine's own write when it arrives late, and is no evidence the edit was seen.
    /// </summary>
    private static async Task<bool> EngineHasSeenAsync(StemmaEngine engine, string file, string text)
    {
        var deadline = DateTime.UtcNow + TimeSpan.FromSeconds(10);
        while (DateTime.UtcNow < deadline)
        {
            var doc = engine.Solution.Projects.SelectMany(p => p.Documents)
                .Single(d => string.Equals(d.FilePath, file, StringComparison.OrdinalIgnoreCase));
            if ((await doc.GetTextAsync()).ToString().Contains(text)) return true;
            await Task.Delay(100);
        }
        return false;
    }

    [Fact]
    public void The_fallback_for_removing_a_relation_keeps_its_label()
    {
        var before = new ArchModel.ArchModel("Architecture.cs",
            [new ArchElement("a", "A", ArchElementKind.Concept, new Dictionary<string, string?>()),
             new ArchElement("b", "B", ArchElementKind.Concept, new Dictionary<string, string?>())],
            [new ArchLink("rel_001", "a", "b", ArchLinkKind.Relation, new Dictionary<string, string?> { ["label"] = "becomes" })],
            []);

        var inverse = UndoStack.BuildInverse(new RemoveLinkOp("op", "rel_001"), before);

        inverse.Should().BeOfType<RestoreLinkOp>().Which.Label.Should().Be("becomes");
    }
}
