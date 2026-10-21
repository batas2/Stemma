using FluentAssertions;
using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.CSharp;
using Stemma.Engine.ArchModel;
using Stemma.Engine.Validation;
using Xunit;

namespace Stemma.Engine.Tests;

/// <summary>
/// What the reader takes from an Architecture.cs, for the ways people actually write one. The
/// fidelity suite holds the writer to the file; these hold the reader to it — a declaration the
/// reader misses is a box missing from the canvas, and nothing says why.
/// </summary>
public sealed class DslReaderTests
{
    private static ArchModel.ArchModel? Read(string source) =>
        DslReader.TryRead("/tmp/Architecture.cs", CSharpSyntaxTree.ParseText(source).GetRoot());

    [Fact]
    public void The_model_is_read_from_the_static_build_that_returns_a_model_not_from_a_helper_above_it()
    {
        // A helper with a Build() of its own, declared first, was taken for the model: the canvas
        // showed nothing, and an edit would have landed in the helper's method body.
        var model = Read("""
            using Stemma.Model;
            public static class Helpers { public static object Build() { var x = new Module("mod_h", "Helper"); return x; } }
            public class Builder { public Model Build() { var y = new Module("mod_i", "Instance"); return Model.Of(y); } }
            public static class Architecture
            {
                public static Model Build()
                {
                    var a = new Module("mod_a", "A");
                    return Model.Of(a);
                }
            }
            """);

        model.Should().NotBeNull();
        model!.Elements.Select(e => e.Id).Should().Equal("mod_a");
    }

    [Fact]
    public void The_class_named_Architecture_is_preferred_over_another_model_builder_in_the_same_file()
    {
        var model = Read("""
            using Stemma.Model;
            public static class Scratch { public static Model Build() { var s = new Module("mod_s", "Scratch"); return Model.Of(s); } }
            public static class Architecture { public static Stemma.Model.Model Build() { var a = new Module("mod_a", "A"); return Model.Of(a); } }
            """);

        model!.Elements.Select(e => e.Id).Should().Equal("mod_a");
    }

    [Fact]
    public void A_file_whose_only_build_is_not_a_model_builder_has_no_model()
    {
        Read("""
            public static class Helpers { public static object Build() { return null; } }
            """).Should().BeNull();
    }

    // ---- tags -----------------------------------------------------------------------------------

    [Fact]
    public void A_tag_kept_in_a_local_is_read_the_way_the_domain_model_writes_it()
    {
        // `var tag = Tag.For(...)` is the example domain-model.md gives, and only bare `Tag.For(...);`
        // statements were read: the lifecycle was lost.
        var model = Read("""
            using Stemma.Model;
            public static class Architecture
            {
                public static Model Build()
                {
                    var modRiskAgg = new Module("mod_risk_agg", "Risk aggregation");
                    var other = new Module("mod_other", "Other");
                    var tag = Tag.For(modRiskAgg,
                        lifecycle: new Lifecycle(Status: "target", Phase: "NEW"),
                        ownership: new Ownership(Squad: "Onboard"));
                    Tag.For(other, ownership: new Ownership(Squad: "Core"));
                    return Model.Of(modRiskAgg, other, tag);
                }
            }
            """)!;

        model.Tags.Should().BeEquivalentTo(new[]
        {
            new ArchTag("mod_risk_agg", new ArchLifecycle("target", "NEW"), new ArchOwnership("Onboard")),
            new ArchTag("mod_other", null, new ArchOwnership("Core")),
        });
        model.Unreadable.Should().BeEmpty();
    }

    [Fact]
    public void A_tag_written_where_Stemma_does_not_look_for_one_is_reported()
    {
        var model = Read("""
            using Stemma.Model;
            public static class Architecture
            {
                public static Model Build()
                {
                    var a = new Module("mod_a", "A");
                    return Model.Of(a, Tag.For(a, lifecycle: new Lifecycle(Status: "target")));
                }
            }
            """)!;

        model.Tags.Should().BeEmpty();
        model.Unreadable.Should().ContainSingle().Which.Message.Should().Contain("Architecture.cs:7").And.Contain("Tag.For");
    }

    // ---- arguments written as constants ---------------------------------------------------------

    [Fact]
    public void Ids_and_names_written_as_constants_are_read_as_what_they_stand_for()
    {
        // Constants are the obvious way to keep an id from being mistyped in every flow that names
        // it. Each of these declarations used to be missing from the model, without a word.
        var model = Read(""""
            using Stemma.Model;
            public static class Ids
            {
                public const string Ctx = "bc_" + Sales;
                private const string Sales = "sales";
            }
            public static class Architecture
            {
                const string Api = "cnt_api";
                public static Model Build()
                {
                    const string Prefix = "mod_";
                    var sys = new SoftwareSystem("sys_a", "System A");
                    var ctx = new BoundedContext(Ids.Ctx, "Sales");
                    var api = new Container(Api, "API", "sys_a");
                    var core = new Module("mod_" + "core", ("Co" + "re"));
                    var x = new Module("mod_x", $"Mod X");
                    var y = new Module($"{Prefix}y", "Mod Y", Ids.Ctx);
                    var z = new Module("mod_z", nameof(Architecture));
                    var raw = new Module("mod_raw", """Raw "quoted" name""");
                    var verbatim = new Module(@"mod_verbatim", @"C:\models");
                    var ctxAt = new Module(Architecture.Api + "_mod", "Qualified", contextId: Ids.Ctx);
                    var flow = new DataFlow("df1", "sys_a", Api, $"Order{"s"}");
                    return Model.Of(sys, ctx, api, core, x, y, z, raw, verbatim, ctxAt, flow);
                }
            }
            """")!;

        model.Elements.Select(e => (e.Id, e.Name)).Should().Equal(
            ("sys_a", "System A"),
            ("bc_sales", "Sales"),
            ("cnt_api", "API"),
            ("mod_core", "Core"),
            ("mod_x", "Mod X"),
            ("mod_y", "Mod Y"),
            ("mod_z", "Architecture"),
            ("mod_raw", "Raw \"quoted\" name"),
            ("mod_verbatim", "C:\\models"),
            ("cnt_api_mod", "Qualified"));
        model.Elements.Single(e => e.Id == "mod_y").Attributes["contextId"].Should().Be("bc_sales");
        model.Elements.Single(e => e.Id == "cnt_api_mod").Attributes["contextId"].Should().Be("bc_sales");
        model.Links.Should().ContainSingle().Which.Should().Match<ArchLink>(l =>
            l.Id == "df1" && l.FromId == "sys_a" && l.ToId == "cnt_api" && l.Attributes["payload"] == "Orders");
        model.Unreadable.Should().BeEmpty();
    }

    [Fact]
    public void A_declaration_whose_id_cannot_be_read_is_reported_with_its_file_line_and_argument()
    {
        var model = Read("""
            using Stemma.Model;
            public static class Architecture
            {
                static string Make(string s) => s;
                public static Model Build()
                {
                    var a = new Module("mod_a", "A");
                    var b = new Module(Make("mod_b"), "B");
                    var f = new DataFlow("df1", "mod_a", Make("mod_b"), "Order");
                    return Model.Of(a, b, f);
                }
            }
            """)!;

        model.Elements.Select(e => e.Id).Should().Equal("mod_a");
        model.Links.Should().BeEmpty();
        model.Unreadable.Should().HaveCount(2);
        model.Unreadable[0].Message.Should().Contain("Architecture.cs:8").And.Contain("`Make(\"mod_b\")`").And.Contain("id");
        model.Unreadable[1].Message.Should().Contain("Architecture.cs:9").And.Contain("toId");

        // And the validation list says so, which is where someone looks when a box is missing.
        RuleEngine.Default().Run(model).Where(v => v.RuleId == "model/unreadable-declaration")
            .Should().HaveCount(2).And.OnlyContain(v => v.Severity == Severity.Error);
    }

    [Fact]
    public void An_attribute_that_cannot_be_read_is_reported_and_the_element_is_kept()
    {
        var model = Read("""
            using Stemma.Model;
            public static class Architecture
            {
                static readonly string Sales = "bc_sales";
                public static Model Build()
                {
                    var m = new Module("mod_m", "M", Sales);
                    return Model.Of(m);
                }
            }
            """)!;

        var m = model.Elements.Should().ContainSingle().Subject;
        m.Attributes["contextId"].Should().BeNull();
        var violation = RuleEngine.Default().Run(model).Should().ContainSingle(v => v.RuleId == "model/unreadable-declaration").Subject;
        violation.Severity.Should().Be(Severity.Warning);
        violation.ElementIds.Should().Equal("mod_m");
        violation.Message.Should().Contain("contextId").And.Contain("`Sales`");
    }

    [Fact]
    public void A_constant_declared_in_another_file_is_read_when_the_compilation_is_at_hand()
    {
        var ids = CSharpSyntaxTree.ParseText("""
            public static class Ids { public const string Ctx = "bc_sales"; }
            """);
        var arch = CSharpSyntaxTree.ParseText("""
            using Stemma.Model;
            public static class Architecture
            {
                public static Model Build()
                {
                    var m = new Module("mod_m", "M", Ids.Ctx);
                    return Model.Of(m);
                }
            }
            """);
        var compilation = CSharpCompilation.Create("Scratch", [ids, arch],
            [MetadataReference.CreateFromFile(typeof(object).Assembly.Location),
             MetadataReference.CreateFromFile(typeof(Stemma.Model.Module).Assembly.Location)]);

        var withCompilation = DslReader.TryRead("/tmp/Architecture.cs", arch.GetRoot(), compilation.GetSemanticModel(arch))!;
        withCompilation.Elements.Single().Attributes["contextId"].Should().Be("bc_sales");
        withCompilation.Unreadable.Should().BeEmpty();

        // From the file alone it cannot be known, and is said rather than guessed.
        var alone = DslReader.TryRead("/tmp/Architecture.cs", arch.GetRoot())!;
        alone.Elements.Single().Attributes["contextId"].Should().BeNull();
        alone.Unreadable.Should().ContainSingle();
    }
}
