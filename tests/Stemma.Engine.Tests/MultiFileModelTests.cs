using FluentAssertions;
using Stemma.Engine.ArchModel;
using Stemma.Engine.Operations;
using Stemma.Engine.Workspace;
using Xunit;

namespace Stemma.Engine.Tests;

/// <summary>
/// A model split over several files under <c>Architecture/</c> is one model. Every operation that
/// looks something up — an element to link to, an id that is free — has to look across all of them,
/// and the model it reads has to be assembled by the same rule whether it is read live or as it was
/// at a past revision.
/// </summary>
public sealed class MultiFileModelTests
{
    private const string Primary = """
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

    private const string Payments = """
        using Stemma.Model;

        namespace Scratch;

        public static class PaymentsArchitecture
        {
            public static Model Build()
            {
                var modPay = new Module("mod_pay", "Pay");
                var flow = new DataFlow("flow_001", "mod_pay", "ctx_001", "Money");

                return Model.Of(modPay, flow);
            }
        }

        """;

    private static async Task<string> CreateAsync(params (string Name, string Text)[] files)
    {
        var root = Path.Combine(Path.GetTempPath(), $"stemma-multi-{Guid.NewGuid():N}");
        Directory.CreateDirectory(Path.Combine(root, "Architecture"));
        foreach (var (name, text) in files)
            await File.WriteAllTextAsync(Path.Combine(root, "Architecture", name), text);
        return root;
    }

    private static void Applied(OperationResult r)
    {
        if (r is OperationFailed f) throw new Xunit.Sdk.XunitException($"{f.Reason}: {f.Message}");
    }

    [Fact]
    public async Task A_model_in_one_file_drops_a_duplicate_id_as_the_history_read_does()
    {
        // The read of a past revision always merged, the live one only when there were two files: a
        // model declaring an id twice compared with itself showed a change that was not there.
        var root = await CreateAsync(("Architecture.cs", Primary.Replace(
            "        var modA = new Module(\"mod_a\", \"A\");\n",
            "        var modA = new Module(\"mod_a\", \"A\");\n        var modAgain = new Module(\"mod_a\", \"A again\");\n")
            .Replace("Model.Of(ctx, modA)", "Model.Of(ctx, modA, modAgain)")));
        try
        {
            await using var engine = await StemmaEngine.OpenAsync(root);
            var live = (await engine.ReadArchModelAsync())!;

            live.Elements.Where(e => e.Id == "mod_a").Should().ContainSingle().Which.Name.Should().Be("A",
                "the first declaration of an id is the one that counts, in every read");
        }
        finally { Directory.Delete(root, recursive: true); }
    }

    [Fact]
    public async Task A_link_can_end_at_an_element_declared_in_another_model_file()
    {
        var root = await CreateAsync(("Architecture.cs", Primary), ("Payments.cs", Payments));
        try
        {
            await using var engine = await StemmaEngine.OpenAsync(root);

            var result = await engine.ApplyAsync(new AddLinkOp("op", ArchLinkKind.DataFlow, "mod_a", "mod_pay", Payload: "Invoice"));

            result.Should().BeOfType<OperationApplied>("the element is in the model, whichever file declares it");
            var link = (await engine.ReadArchModelAsync())!.Links.Single(l => l.FromId == "mod_a");
            link.ToId.Should().Be("mod_pay");
        }
        finally { Directory.Delete(root, recursive: true); }
    }

    [Fact]
    public async Task The_fallback_undo_of_a_removal_puts_the_element_back_in_its_own_file_with_its_tag()
    {
        // It was re-declared in Architecture.cs, whichever file it came from, and without its
        // lifecycle and owner.
        var payments = Payments
            .Replace("        var flow = new DataFlow(",
                "        Tag.For(modPay, lifecycle: new Lifecycle(Status: \"target\"), ownership: new Ownership(Squad: \"Core\"));\n        var flow = new DataFlow(");
        var root = await CreateAsync(("Architecture.cs", Primary), ("Payments.cs", payments));
        var primaryPath = Path.Combine(root, "Architecture", "Architecture.cs");
        var paymentsPath = Path.Combine(root, "Architecture", "Payments.cs");
        try
        {
            await using var engine = await StemmaEngine.OpenAsync(root);
            Applied(await engine.ApplyAsync(new RemoveElementOp("op", "mod_pay")));
            await File.AppendAllTextAsync(paymentsPath, "// edited outside\n");
            (await engine.ApplyAsync(new SetLinkAttributeOp("probe", "flow_001", "payload", "Cash"))).Should().BeOfType<OperationFailed>()
                .Which.Reason.Should().Be("ChangedOnDisk");

            Applied(await engine.UndoAsync("undo"));

            (await File.ReadAllTextAsync(primaryPath)).Should().Be(Primary, "the element never lived here");
            var after = await File.ReadAllTextAsync(paymentsPath);
            after.Should().Contain("new Module(\"mod_pay\", \"Pay\")").And.EndWith("// edited outside\n");
            var tag = (await engine.ReadArchModelAsync())!.Tags.Should().ContainSingle(t => t.TargetId == "mod_pay").Subject;
            tag.Lifecycle!.Status.Should().Be("target");
            tag.Ownership!.Squad.Should().Be("Core");
        }
        finally { Directory.Delete(root, recursive: true); }
    }

    [Fact]
    public async Task A_new_link_never_takes_an_id_another_model_file_declares()
    {
        // The new link took flow_001, which Payments.cs already declared; removing it by that id then
        // removed whichever came first, and the other one reappeared.
        var root = await CreateAsync(("Architecture.cs", Primary), ("Payments.cs", Payments));
        try
        {
            await using var engine = await StemmaEngine.OpenAsync(root);

            var result = await engine.ApplyAsync(new AddLinkOp("op", ArchLinkKind.DataFlow, "ctx_001", "mod_a", Payload: "Order"));

            var id = result.Should().BeOfType<OperationApplied>().Which.Deltas.OfType<LinkAdded>().Single().Id;
            id.Should().NotBe("flow_001");
            var links = (await engine.ReadArchModelAsync())!.Links;
            links.Should().HaveCount(2);
            links.Should().ContainSingle(l => l.Id == "flow_001").Which.FromId.Should().Be("mod_pay");
        }
        finally { Directory.Delete(root, recursive: true); }
    }
}
