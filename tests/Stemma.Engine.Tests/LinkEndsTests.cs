using FluentAssertions;
using Stemma.Engine.ArchModel;
using Stemma.Engine.Operations;
using Stemma.Engine.Workspace;
using Xunit;

namespace Stemma.Engine.Tests;

/// <summary>
/// <c>SetLinkEnds</c> (B-028): what it refuses, and what it keeps that removing a link and adding it
/// again did not. The byte-for-byte edit is the fidelity suite's (<c>Fidelity/FidelityCases.cs</c>).
/// </summary>
public sealed class LinkEndsTests
{
    private const string Source = """
        using Stemma.Model;

        namespace Scratch;

        public static class Architecture
        {
            private const string Store = "cnt_store";

            public static Model Build()
            {
                var cntWeb = new Container("cnt_web", "Web", "sys_shop", "spa");
                var cntApi = new Container("cnt_api", "API", "sys_shop");
                var cntStore = new Container("cnt_store", "Store", "sys_shop", "db");
                var flowOrders = new DataFlow("flow_orders", "cnt_web", "cnt_api", "Order", Technology: "AMQP");
                var flowPersist = new DataFlow("flow_persist", "cnt_api", Store, "Order");
                Tag.For(flowOrders, lifecycle: new Lifecycle(Status: "current"));

                return Model.Of(cntWeb, cntApi, cntStore, flowOrders, flowPersist);
            }
        }

        """;

    private static async Task<(string Root, string File)> CreateAsync(string source = Source)
    {
        var root = Path.Combine(Path.GetTempPath(), $"stemma-ends-{Guid.NewGuid():N}");
        Directory.CreateDirectory(Path.Combine(root, "Architecture"));
        var file = Path.Combine(root, "Architecture", "Architecture.cs");
        await File.WriteAllTextAsync(file, source);
        return (root, file);
    }

    private static OperationFailed Refused(OperationResult r) =>
        r.Should().BeOfType<OperationFailed>().Subject;

    [Fact]
    public async Task A_reversed_link_keeps_its_id_its_technology_and_its_tag()
    {
        var (root, _) = await CreateAsync();
        try
        {
            await using var engine = await StemmaEngine.OpenAsync(root);
            (await engine.ApplyAsync(new SetLinkEndsOp("op", "flow_orders", "cnt_api", "cnt_web"))).Should().BeOfType<OperationApplied>();

            var arch = (await engine.ReadArchModelAsync())!;
            var link = arch.Links.Single(l => l.Id == "flow_orders");
            (link.FromId, link.ToId).Should().Be(("cnt_api", "cnt_web"));
            link.Attributes["technology"].Should().Be("AMQP", "removing and adding the link again lost it");
            arch.Tags.Single(t => t.TargetId == "flow_orders").Lifecycle!.Status.Should().Be("current");
            arch.Links.Should().HaveCount(2, "the link is moved, not copied");
        }
        finally { Directory.Delete(root, recursive: true); }
    }

    [Theory]
    [InlineData("flow_nope", "cnt_web", "cnt_api", "LinkNotFound")]
    [InlineData("flow_orders", "cnt_nope", "cnt_api", "FromNotFound")]
    [InlineData("flow_orders", "cnt_web", "cnt_nope", "ToNotFound")]
    [InlineData("flow_orders", "cnt_web", "cnt_api", "RewriteFailed")]
    [InlineData("cnt_web", "cnt_api", "cnt_store", "LinkNotFound")]
    public async Task What_it_refuses_writes_nothing(string linkId, string from, string to, string reason)
    {
        var (root, file) = await CreateAsync();
        try
        {
            await using var engine = await StemmaEngine.OpenAsync(root);
            Refused(await engine.ApplyAsync(new SetLinkEndsOp("op", linkId, from, to))).Reason.Should().Be(reason);
            (await File.ReadAllTextAsync(file)).Should().Be(Source);
        }
        finally { Directory.Delete(root, recursive: true); }
    }

    [Fact]
    public async Task An_end_written_as_a_constant_is_not_replaced_but_the_other_end_can_move()
    {
        var (root, file) = await CreateAsync();
        try
        {
            await using var engine = await StemmaEngine.OpenAsync(root);
            Refused(await engine.ApplyAsync(new SetLinkEndsOp("op", "flow_persist", "cnt_api", "cnt_web"))).Reason.Should().Be("NotALiteral");
            (await File.ReadAllTextAsync(file)).Should().Be(Source);

            // The constant already says cnt_store, so only the start is written.
            (await engine.ApplyAsync(new SetLinkEndsOp("op2", "flow_persist", "cnt_web", "cnt_store"))).Should().BeOfType<OperationApplied>();
            (await File.ReadAllTextAsync(file)).Should().Be(Source.Replace(
                "new DataFlow(\"flow_persist\", \"cnt_api\", Store,", "new DataFlow(\"flow_persist\", \"cnt_web\", Store,"));
        }
        finally { Directory.Delete(root, recursive: true); }
    }

    [Fact]
    public async Task One_end_moves_when_the_other_is_a_constant_only_the_compilation_can_read()
    {
        // The end is Ids.Api, declared in another file: the model reads it once the workspace is
        // compiled, and the syntax tree alone cannot. Moving the start is no reason to look at the end.
        var source = Source.Replace("new DataFlow(\"flow_orders\", \"cnt_web\", \"cnt_api\",", "new DataFlow(\"flow_orders\", \"cnt_web\", Ids.Api,");
        var (root, file) = await CreateAsync(source);
        Directory.CreateDirectory(Path.Combine(root, "Domain"));
        await File.WriteAllTextAsync(Path.Combine(root, "Domain", "Ids.cs"), "public static class Ids\n{\n    public const string Api = \"cnt_api\";\n}\n");
        try
        {
            await using var engine = await StemmaEngine.OpenAsync(root);
            engine.StartWatching();
            var deadline = DateTime.UtcNow + TimeSpan.FromSeconds(20);
            // Until then the link is left out: an end that cannot be read leaves nothing to connect.
            while (DateTime.UtcNow < deadline && (await engine.ReadArchModelAsync())!.Links.FirstOrDefault(l => l.Id == "flow_orders")?.ToId != "cnt_api")
                await Task.Delay(100);
            (await engine.ReadArchModelAsync())!.Links.Single(l => l.Id == "flow_orders").ToId.Should().Be("cnt_api");

            (await engine.ApplyAsync(new SetLinkEndsOp("op", "flow_orders", "cnt_store", "cnt_api"))).Should().BeOfType<OperationApplied>();
            (await File.ReadAllTextAsync(file)).Should().Be(source.Replace("new DataFlow(\"flow_orders\", \"cnt_web\", Ids.Api,", "new DataFlow(\"flow_orders\", \"cnt_store\", Ids.Api,"));
        }
        finally { Directory.Delete(root, recursive: true); }
    }

    [Theory]
    [InlineData("fromId")]
    [InlineData("toId")]
    public async Task SetLinkAttribute_does_not_move_an_end(string attribute)
    {
        // It used to: the end was written without checking that it named anything.
        var (root, file) = await CreateAsync();
        try
        {
            await using var engine = await StemmaEngine.OpenAsync(root);
            Refused(await engine.ApplyAsync(new SetLinkAttributeOp("op", "flow_orders", attribute, "cnt_nope"))).Reason.Should().Be("UnknownAttribute");
            (await File.ReadAllTextAsync(file)).Should().Be(Source);
        }
        finally { Directory.Delete(root, recursive: true); }
    }

    [Fact]
    public async Task A_link_in_another_model_file_is_moved_there_to_an_end_declared_here()
    {
        var root = Path.Combine(Path.GetTempPath(), $"stemma-ends-{Guid.NewGuid():N}");
        Directory.CreateDirectory(Path.Combine(root, "Architecture"));
        await File.WriteAllTextAsync(Path.Combine(root, "Architecture", "Architecture.cs"), Source);
        const string payments = """
            using Stemma.Model;

            namespace Scratch;

            public static class PaymentsArchitecture
            {
                public static Model Build()
                {
                    var modPay = new Module("mod_pay", "Pay");
                    var flowPay = new DataFlow("flow_pay", "mod_pay", "cnt_api", "Money");

                    return Model.Of(modPay, flowPay);
                }
            }

            """;
        var paymentsFile = Path.Combine(root, "Architecture", "Payments.cs");
        await File.WriteAllTextAsync(paymentsFile, payments);
        try
        {
            await using var engine = await StemmaEngine.OpenAsync(root);
            (await engine.ApplyAsync(new SetLinkEndsOp("op", "flow_pay", "mod_pay", "cnt_store"))).Should().BeOfType<OperationApplied>();

            (await File.ReadAllTextAsync(paymentsFile)).Should().Be(payments.Replace("\"mod_pay\", \"cnt_api\"", "\"mod_pay\", \"cnt_store\""));
            (await File.ReadAllTextAsync(Path.Combine(root, "Architecture", "Architecture.cs"))).Should().Be(Source);
        }
        finally { Directory.Delete(root, recursive: true); }
    }

    [Fact]
    public async Task The_fallback_undo_puts_the_old_ends_back_and_keeps_an_outside_edit()
    {
        var (root, file) = await CreateAsync();
        try
        {
            await using var engine = await StemmaEngine.OpenAsync(root);
            engine.StartWatching();
            (await engine.ApplyAsync(new SetLinkEndsOp("op", "flow_orders", "cnt_api", "cnt_web"))).Should().BeOfType<OperationApplied>();

            await Task.Delay(TimeSpan.FromSeconds(2));
            const string marker = "// edited in an IDE";
            await File.WriteAllTextAsync(file, (await File.ReadAllTextAsync(file)).Replace("        return Model.Of(", $"        {marker}\n        return Model.Of("));
            (await EngineHasSeenAsync(engine, file, marker)).Should().BeTrue("the watcher should take the outside edit in");

            (await engine.UndoAsync("undo")).Should().BeOfType<OperationApplied>();

            var after = await File.ReadAllTextAsync(file);
            after.Should().Contain(marker, "the exact reversal would erase an edit made since");
            var link = (await engine.ReadArchModelAsync())!.Links.Single(l => l.Id == "flow_orders");
            (link.FromId, link.ToId).Should().Be(("cnt_web", "cnt_api"));
        }
        finally { Directory.Delete(root, recursive: true); }
    }

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
}
