using FluentAssertions;
using Stemma.Engine.ArchModel;
using Stemma.Engine.Operations;
using Stemma.Engine.Workspace;
using Xunit;

namespace Stemma.Engine.Tests;

/// <summary>
/// What the writer refuses, and the edge cases the three fidelity fixtures do not reach. Each test
/// states the whole line it expects, because a fragment check is how the declaration rebuild went
/// unnoticed: the new literal was there, and so was everything except the comment it replaced.
/// </summary>
public sealed class DslWriterContractTests
{
    private static async Task<(string Root, string File)> CreateAsync(string body)
    {
        var root = Path.Combine(Path.GetTempPath(), $"stemma-writer-{Guid.NewGuid():N}");
        Directory.CreateDirectory(Path.Combine(root, "Architecture"));
        var file = Path.Combine(root, "Architecture", "Architecture.cs");
        await File.WriteAllTextAsync(file, $$"""
            using Stemma.Model;

            namespace Scratch;

            public static class Architecture
            {
                public static Model Build()
                {
            {{body}}
                }
            }
            """);
        return (root, file);
    }

    private static async Task<(OperationResult Result, string Source)> ApplyAsync(string body, OperationBase op)
    {
        var (root, file) = await CreateAsync(body);
        try
        {
            await using var engine = await StemmaEngine.OpenAsync(root);
            var result = await engine.ApplyAsync(op);
            return (result, await File.ReadAllTextAsync(file));
        }
        finally { Directory.Delete(root, recursive: true); }
    }

    [Fact]
    public async Task An_attribute_the_kind_does_not_have_is_refused_rather_than_ignored()
    {
        var (result, source) = await ApplyAsync("""
                    var mod = new Module("mod_001", "Checkout");
                    return Model.Of(mod);
            """, new SetElementAttributeOp("op", "mod_001", "aboutId", "mod_001"));

        result.Should().BeOfType<OperationFailed>().Which.Reason.Should().Be("UnknownAttribute");
        source.Should().Contain("        var mod = new Module(\"mod_001\", \"Checkout\");\n");
    }

    [Fact]
    public async Task A_positional_attribute_that_later_arguments_depend_on_cannot_be_cleared()
    {
        // Removing the payload would move "twoway" into the payload's place.
        var (result, source) = await ApplyAsync("""
                    var a = new Module("mod_a", "A");
                    var b = new Module("mod_b", "B");
                    var flow = new DataFlow("flow_001", "mod_a", "mod_b", "Order", "twoway");
                    return Model.Of(a, b, flow);
            """, new SetLinkAttributeOp("op", "flow_001", "payload", null));

        result.Should().BeOfType<OperationFailed>().Which.Reason.Should().Be("AttributeRequired");
        source.Should().Contain("new DataFlow(\"flow_001\", \"mod_a\", \"mod_b\", \"Order\", \"twoway\");");
    }

    [Fact]
    public async Task Clearing_a_positional_lifecycle_field_that_others_follow_writes_null_in_its_place()
    {
        var (result, source) = await ApplyAsync("""
                    var mod = new Module("mod_001", "Checkout");
                    Tag.For(mod, lifecycle: new Lifecycle("current", "Q4 2026"));
                    return Model.Of(mod);
            """, new SetLifecycleOp("op", "mod_001", null, "Q4 2026", null, null));

        result.Should().BeOfType<OperationApplied>();
        source.Should().Contain("        Tag.For(mod, lifecycle: new Lifecycle(null, \"Q4 2026\"));\n");
    }

    [Fact]
    public async Task Clearing_every_field_of_a_positional_lifecycle_removes_it_and_keeps_the_ownership()
    {
        // Fields were cleared first to last, so the status became a null holding the phase's place
        // before the phase went, and new Lifecycle(null) was left behind.
        var (result, source) = await ApplyAsync("""
                    var mod = new Module("mod_001", "Checkout");
                    Tag.For(mod, lifecycle: new Lifecycle("Active", "Build"), ownership: new Ownership(Squad: "Core"));
                    return Model.Of(mod);
            """, new SetLifecycleOp("op", "mod_001", null, null, null, null));

        result.Should().BeOfType<OperationApplied>();
        source.Should().Contain("        Tag.For(mod, ownership: new Ownership(Squad: \"Core\"));\n");
    }

    [Fact]
    public async Task A_null_written_by_hand_before_a_field_that_stays_is_left_alone()
    {
        var (result, source) = await ApplyAsync("""
                    var mod = new Module("mod_001", "Checkout");
                    Tag.For(mod, lifecycle: new Lifecycle("current", null, "2026-01-01"));
                    return Model.Of(mod);
            """, new SetLifecycleOp("op", "mod_001", "target", null, "2026-01-01", null));

        result.Should().BeOfType<OperationApplied>();
        source.Should().Contain("        Tag.For(mod, lifecycle: new Lifecycle(\"target\", null, \"2026-01-01\"));\n");
    }

    [Fact]
    public async Task Clearing_the_last_field_takes_the_nulls_that_only_held_its_place()
    {
        var (result, source) = await ApplyAsync("""
                    var mod = new Module("mod_001", "Checkout");
                    Tag.For(mod, lifecycle: new Lifecycle("current", null, "2026-01-01"));
                    return Model.Of(mod);
            """, new SetLifecycleOp("op", "mod_001", "current", null, null, null));

        result.Should().BeOfType<OperationApplied>();
        source.Should().Contain("        Tag.For(mod, lifecycle: new Lifecycle(\"current\"));\n");
    }

    [Fact]
    public async Task A_positional_tag_part_is_read_and_edited_in_place()
    {
        var (result, source) = await ApplyAsync("""
                    var mod = new Module("mod_001", "Checkout");
                    Tag.For(mod, new Lifecycle(Status: "current"), new Ownership(Squad: "Core"));
                    return Model.Of(mod);
            """, new SetOwnershipOp("op", "mod_001", "Payments", null));

        result.Should().BeOfType<OperationApplied>();
        source.Should().Contain("        Tag.For(mod, new Lifecycle(Status: \"current\"), new Ownership(Squad: \"Payments\"));\n");
    }

    [Fact]
    public async Task Adding_a_lifecycle_to_a_tag_that_only_has_ownership_puts_it_first()
    {
        var (result, source) = await ApplyAsync("""
                    var mod = new Module("mod_001", "Checkout");
                    Tag.For(mod, ownership: new Ownership(Squad: "Core"));
                    return Model.Of(mod);
            """, new SetLifecycleOp("op", "mod_001", "target", null, null, null));

        result.Should().BeOfType<OperationApplied>();
        source.Should().Contain("        Tag.For(mod, lifecycle: new Lifecycle(Status: \"target\"), ownership: new Ownership(Squad: \"Core\"));\n");
    }

    [Fact]
    public async Task Removing_a_tagged_link_takes_its_tag_with_it()
    {
        // Links are tagged too (a flow that is only a target). Leaving the tag would name a variable
        // that no longer exists, and the compile gate would refuse the removal.
        var (result, source) = await ApplyAsync("""
                    var a = new Module("mod_a", "A");
                    var b = new Module("mod_b", "B");
                    var flow = new DataFlow("flow_001", "mod_a", "mod_b", "Order");
                    Tag.For(flow, lifecycle: new Lifecycle(Status: "target"));
                    return Model.Of(a, b, flow);
            """, new RemoveLinkOp("op", "flow_001"));

        result.Should().BeOfType<OperationApplied>();
        source.Should().NotContain("flow").And.Contain("        return Model.Of(a, b);\n");
    }

    [Fact]
    public async Task Removing_a_declaration_between_blank_lines_leaves_one_blank_line()
    {
        var (result, source) = await ApplyAsync("""
                    var a = new Module("mod_a", "A");

                    var b = new Module("mod_b", "B");

                    var c = new Module("mod_c", "C");
                    return Model.Of(a, b, c);
            """, new RemoveElementOp("op", "mod_b"));

        result.Should().BeOfType<OperationApplied>();
        source.Should().Contain("        var a = new Module(\"mod_a\", \"A\");\n\n        var c = new Module(\"mod_c\", \"C\");\n");
    }

    [Fact]
    public async Task Renaming_onto_a_variable_that_is_taken_keeps_the_old_variable()
    {
        var (result, source) = await ApplyAsync("""
                    var modBasket = new Module("mod_a", "Basket");
                    var modCheckout = new Module("mod_b", "Checkout");
                    return Model.Of(modBasket, modCheckout);
            """, new RenameElementOp("op", "mod_b", "Basket"));

        result.Should().BeOfType<OperationApplied>();
        source.Should().Contain("        var modCheckout = new Module(\"mod_b\", \"Basket\");\n");
    }

    [Fact]
    public async Task Renaming_a_link_is_refused_rather_than_writing_the_name_over_where_it_starts()
    {
        // A link's second argument is where it starts, not a name: the rename once wrote
        // new DataFlow("flow_x", "Orders placed", …) and the flow no longer started anywhere.
        var (result, source) = await ApplyAsync("""
                    var a = new Module("mod_a", "A");
                    var b = new Module("mod_b", "B");
                    var flowX = new DataFlow("flow_x", "mod_a", "mod_b", "Order");
                    return Model.Of(a, b, flowX);
            """, new RenameElementOp("op", "flow_x", "Orders placed"));

        result.Should().BeOfType<OperationFailed>().Which.Reason.Should().Be("NotAnElement");
        source.Should().Contain("        var flowX = new DataFlow(\"flow_x\", \"mod_a\", \"mod_b\", \"Order\");\n")
            .And.Contain("return Model.Of(a, b, flowX);");
    }

    [Fact]
    public async Task Renaming_a_concept_gives_its_variable_the_concept_prefix()
    {
        var (result, source) = await ApplyAsync("""
                    var conFidelity = new Concept("con_001", "Fidelity");
                    return Model.Of(conFidelity);
            """, new RenameElementOp("op", "con_001", "Trust"));

        result.Should().BeOfType<OperationApplied>();
        source.Should().Contain("        var conTrust = new Concept(\"con_001\", \"Trust\");\n")
            .And.Contain("return Model.Of(conTrust);");
    }

    [Fact]
    public async Task A_comment_beside_a_replaced_literal_stays_beside_it()
    {
        var (result, source) = await ApplyAsync("""
                    var ctxA = new BoundedContext("ctx_001", "Ordering");
                    var ctxB = new BoundedContext("ctx_002", "Billing");
                    var mod = new Module("mod_001", "Checkout", /* until the split */ "ctx_001");
                    return Model.Of(ctxA, ctxB, mod);
            """, new SetElementContextOp("op", "mod_001", "ctx_002"));

        result.Should().BeOfType<OperationApplied>();
        source.Should().Contain("        var mod = new Module(\"mod_001\", \"Checkout\", /* until the split */ \"ctx_002\");\n");
    }

    [Fact]
    public async Task Clearing_an_argument_takes_a_comment_inside_it_along()
    {
        var (result, source) = await ApplyAsync("""
                    var ctx = new BoundedContext("ctx_001", "Ordering");
                    var mod = new Module("mod_001", "Checkout", /* until the split */ "ctx_001");
                    return Model.Of(ctx, mod);
            """, new SetElementContextOp("op", "mod_001", null));

        // The comment sat between the comma and the literal: it was the argument's own.
        result.Should().BeOfType<OperationApplied>();
        source.Should().Contain("        var mod = new Module(\"mod_001\", \"Checkout\");\n");
    }
}
