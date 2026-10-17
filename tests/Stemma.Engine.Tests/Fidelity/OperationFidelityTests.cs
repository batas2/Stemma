using FluentAssertions;
using Stemma.Engine.Workspace;
using Xunit;

namespace Stemma.Engine.Tests.Fidelity;

/// <summary>
/// The fidelity suite (<c>.doc/engineering/testing.md</c>): every operation in the catalog, against a
/// minimal, a realistic and a pathological fixture, asserting the whole file rather than a fragment
/// of it. A <c>Contains</c> check passes while a comment two lines up disappears; comparing every
/// byte is the only form of this test that can see that.
/// </summary>
public sealed class OperationFidelityTests
{
    public static TheoryData<string, string> Cases()
    {
        var data = new TheoryData<string, string>();
        foreach (var (fixture, cases) in FidelityCases.All)
            foreach (var c in cases)
                data.Add(fixture, c.Name);
        return data;
    }

    [Theory]
    [MemberData(nameof(Cases))]
    public async Task An_operation_changes_only_its_target_and_undo_puts_back_every_byte(string fixture, string operation)
    {
        var c = FidelityCases.Find(fixture, operation);
        await using var ws = await FixtureWorkspace.CreateAsync(fixture);
        var before = ws.ReadArch();
        var expected = Fidelity.Expect(before, c.Edits);

        await using var engine = await StemmaEngine.OpenAsync(ws.RootPath);

        (await engine.ApplyAsync(c.Op)).ShouldBeApplied();
        ws.ReadArch().ShouldBeExactly(expected, "an operation may change only the text it targets");

        (await engine.UndoAsync("undo")).ShouldBeApplied();
        ws.ReadArch().ShouldBeExactly(before, "undo has to put back every byte the operation changed");

        (await engine.RedoAsync("redo")).ShouldBeApplied();
        ws.ReadArch().ShouldBeExactly(expected, "redo has to reproduce the operation exactly");
    }

    [Theory]
    [InlineData("minimal")]
    [InlineData("realistic")]
    [InlineData("pathological")]
    public async Task Every_fixture_reads_as_the_same_model(string fixture)
    {
        // The cases only mean the same thing across fixtures if the fixtures do. Named arguments, a
        // verbatim id and a declaration split over five lines are all still the same six elements.
        await using var ws = await FixtureWorkspace.CreateAsync(fixture);
        await using var engine = await StemmaEngine.OpenAsync(ws.RootPath);
        var arch = await engine.ReadArchModelAsync();

        arch.Should().NotBeNull();
        arch!.Elements.Select(e => (e.Id, e.Name)).Should().BeEquivalentTo(new[]
        {
            ("ctx_ordering", "Ordering"), ("ctx_billing", "Billing"), ("mod_checkout", "Checkout"),
            ("mod_invoicing", "Invoicing"), ("risk_latency", "Checkout is slow"),
        });
        arch.Elements.Single(e => e.Id == "mod_checkout").Attributes["contextId"].Should().Be("ctx_ordering");
        arch.Links.Should().ContainSingle(l => l.Id == "flow_orders" && l.FromId == "mod_checkout" && l.ToId == "mod_invoicing");
        arch.Links[0].Attributes["payload"].Should().Be("Order");
        arch.Tags.Should().ContainSingle(t => t.TargetId == "mod_checkout").Which.Lifecycle!.Status.Should().Be("current");
    }
}
