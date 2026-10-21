using System.Xml.Linq;
using FluentAssertions;
using Stemma.Engine.ArchModel;
using Xunit;

namespace Stemma.Engine.Tests;

/// <summary>
/// The draw.io export is the escape hatch to a mature editor, and it is only an escape hatch if the
/// result does not have to be rebuilt by hand. These tests are about the three things that made it
/// one: the layout is honoured, the view is honoured, and the ink is not draw.io's pastel defaults.
/// </summary>
public class DrawioExporterTests
{
    private static ArchElement Element(string id, string name, ArchElementKind kind = ArchElementKind.Module) =>
        new(id, name, kind, new Dictionary<string, string?>());

    private static ArchLink Link(string id, string from, string to, ArchLinkKind kind, string attrName, string attrValue) =>
        new(id, from, to, kind, new Dictionary<string, string?> { [attrName] = attrValue });

    private static readonly ArchModel.ArchModel Model = new(
        "Architecture.cs",
        [Element("mod_a", "Checkout"), Element("mod_b", "Basket"), Element("mod_c", "Elsewhere")],
        [Link("flow_1", "mod_a", "mod_b", ArchLinkKind.DataFlow, "payload", "OrderPlaced")],
        []);

    private static XDocument Parse(string xml) => XDocument.Parse(xml);

    private static IEnumerable<XElement> Cells(string xml) =>
        Parse(xml).Descendants("mxCell").Where(c => c.Attribute("id")?.Value is not ("0" or "1"));

    private static XElement Cell(string xml, string id) => Cells(xml).Single(c => c.Attribute("id")!.Value == id);

    [Fact]
    public void Emits_valid_xml_with_the_mxfile_envelope_editors_expect()
    {
        var xml = DrawioExporter.Export(Model);
        Parse(xml).Root!.Name.LocalName.Should().Be("mxfile");
        Parse(xml).Descendants("mxGraphModel").Should().ContainSingle();
    }

    [Fact]
    public void Honours_committed_positions_instead_of_laying_everything_on_a_grid()
    {
        var xml = DrawioExporter.Export(Model, new DrawioExporter.Options
        {
            Positions = new Dictionary<string, (double X, double Y)> { ["mod_a"] = (400, 250) },
        });
        var geom = Cell(xml, "mod_a").Element("mxGeometry")!;
        geom.Attribute("x")!.Value.Should().Be("400");
        geom.Attribute("y")!.Value.Should().Be("250");
    }

    [Fact]
    public void An_element_without_a_position_does_not_land_on_top_of_a_placed_one()
    {
        // A partly laid-out view is the normal case. Letting unplaced elements consume grid slots
        // interleaved with the placed ones scatters them through the middle of the diagram.
        var xml = DrawioExporter.Export(Model, new DrawioExporter.Options
        {
            Positions = new Dictionary<string, (double X, double Y)> { ["mod_b"] = (400, 250) },
        });
        var a = Cell(xml, "mod_a").Element("mxGeometry")!;
        var c = Cell(xml, "mod_c").Element("mxGeometry")!;
        (a.Attribute("x")!.Value, a.Attribute("y")!.Value)
            .Should().NotBe((c.Attribute("x")!.Value, c.Attribute("y")!.Value));
    }

    [Fact]
    public void Restricts_the_export_to_the_view_that_was_asked_for()
    {
        var xml = DrawioExporter.Export(Model, new DrawioExporter.Options { ElementIds = new[] { "mod_a", "mod_b" } });
        Cells(xml).Select(c => c.Attribute("id")!.Value).Should().NotContain("mod_c");
    }

    [Fact]
    public void Drops_an_edge_whose_other_end_is_outside_the_view()
    {
        // draw.io renders an edge pointing at a missing cell as a dangling stub.
        var xml = DrawioExporter.Export(Model, new DrawioExporter.Options { ElementIds = new[] { "mod_a" } });
        Cells(xml).Select(c => c.Attribute("id")!.Value).Should().NotContain("flow_1");
    }

    [Fact]
    public void Labels_are_the_element_name_alone_by_default()
    {
        // "Module: Checkout" is orientation inside the tool and noise in a document.
        Cell(DrawioExporter.Export(Model), "mod_a").Attribute("value")!.Value.Should().Be("Checkout");
    }

    [Fact]
    public void Kind_prefixes_are_available_for_anyone_who_wants_them()
    {
        var xml = DrawioExporter.Export(Model, new DrawioExporter.Options { LabelKinds = true });
        Cell(xml, "mod_a").Attribute("value")!.Value.Should().Be("Module: Checkout");
    }

    [Fact]
    public void The_default_palette_is_outline_only_on_a_transparent_page()
    {
        var xml = DrawioExporter.Export(Model);
        Cell(xml, "mod_a").Attribute("style")!.Value.Should().Contain("fillColor=none");
        Parse(xml).Descendants("mxGraphModel").Single().Attribute("background")!.Value.Should().Be("none");
    }

    [Fact]
    public void Every_element_takes_the_same_ink_so_the_diagram_survives_greyscale()
    {
        var model = new ArchModel.ArchModel("Architecture.cs",
            [Element("a", "A", ArchElementKind.Module),
             Element("b", "B", ArchElementKind.SoftwareSystem),
             Element("c", "C", ArchElementKind.Capability)],
            [], []);
        var strokes = Cells(DrawioExporter.Export(model))
            .Select(c => c.Attribute("style")!.Value)
            .Select(s => s.Split(';').First(p => p.StartsWith("strokeColor", StringComparison.Ordinal)))
            .Distinct();
        strokes.Should().ContainSingle("kinds are told apart by shape, never by hue alone");
    }

    [Fact]
    public void The_classic_palette_is_still_reachable_for_an_existing_workflow()
    {
        var xml = DrawioExporter.Export(Model, new DrawioExporter.Options { Palette = DrawioPalette.Classic });
        Cell(xml, "mod_a").Attribute("style")!.Value.Should().Contain("#fff2cc");
    }

    [Fact]
    public void An_unknown_palette_name_falls_back_rather_than_failing_an_export()
    {
        DrawioPalette.Resolve("chartreuse").Name.Should().Be("dual-theme");
        DrawioPalette.Resolve(null).Name.Should().Be("dual-theme");
    }

    [Fact]
    public void A_dependency_is_dashed_and_a_flow_is_not()
    {
        var model = new ArchModel.ArchModel("Architecture.cs",
            [Element("a", "A"), Element("b", "B")],
            [Link("flow_1", "a", "b", ArchLinkKind.DataFlow, "payload", "Event"),
             Link("dep_1", "b", "a", ArchLinkKind.Dependency, "kind", "reads")],
            []);
        var xml = DrawioExporter.Export(model);
        Cell(xml, "dep_1").Attribute("style")!.Value.Should().Contain("dashed=1");
        Cell(xml, "flow_1").Attribute("style")!.Value.Should().NotContain("dashed=1");
    }

    [Fact]
    public void Each_link_kind_is_labelled_from_its_own_attribute()
    {
        var model = new ArchModel.ArchModel("Architecture.cs",
            [Element("a", "A"), Element("b", "B")],
            [Link("flow_1", "a", "b", ArchLinkKind.DataFlow, "payload", "OrderPlaced"),
             Link("dep_1", "a", "b", ArchLinkKind.Dependency, "kind", "reads"),
             Link("rel_1", "a", "b", ArchLinkKind.Relation, "label", "becomes")],
            []);
        var xml = DrawioExporter.Export(model);
        Cell(xml, "flow_1").Attribute("value")!.Value.Should().Be("OrderPlaced");
        Cell(xml, "dep_1").Attribute("value")!.Value.Should().Be("reads");
        Cell(xml, "rel_1").Attribute("value")!.Value.Should().Be("becomes");
    }

    [Fact]
    public void An_unlabelled_relation_exports_a_bare_arrow_rather_than_the_word_uses()
    {
        var model = new ArchModel.ArchModel("Architecture.cs",
            [Element("a", "A"), Element("b", "B")],
            [new ArchLink("rel_1", "a", "b", ArchLinkKind.Relation, new Dictionary<string, string?>())],
            []);
        Cell(DrawioExporter.Export(model), "rel_1").Attribute("value")!.Value.Should().BeEmpty();
    }

    [Fact]
    public void A_concept_is_a_plain_box()
    {
        var model = new ArchModel.ArchModel("Architecture.cs", [Element("con_a", "Nobody to ask", ArchElementKind.Concept)], [], []);
        var style = Cell(DrawioExporter.Export(model), "con_a").Attribute("style")!.Value;
        style.Should().Contain("rounded=1").And.Contain("fillColor=none");
    }

    [Fact]
    public void An_element_whose_id_is_a_root_cell_id_gets_a_cell_of_its_own()
    {
        // draw.io's two root cells are `0` and `1`. An element with the id `1` was written as a third
        // cell with that id, and the file opened with its layer gone.
        var model = new ArchModel.ArchModel("Architecture.cs",
            [Element("1", "One"), Element("0", "Zero"), Element("a", "A")],
            [Link("a", "1", "a", ArchLinkKind.DataFlow, "payload", "Same id as an element")],
            []);

        var cells = Parse(DrawioExporter.Export(model)).Descendants("mxCell").ToList();
        var ids = cells.Select(c => c.Attribute("id")!.Value).ToList();

        ids.Should().OnlyHaveUniqueItems();
        cells.Where(c => c.Attribute("id")!.Value is "0" or "1").Should().HaveCount(2)
            .And.OnlyContain(c => c.Attribute("vertex") == null && c.Attribute("edge") == null);
        var one = cells.Single(c => c.Attribute("value")?.Value == "One");
        var a = cells.Single(c => c.Attribute("value")?.Value == "A");
        var edge = cells.Single(c => c.Attribute("edge") is not null);
        edge.Attribute("source")!.Value.Should().Be(one.Attribute("id")!.Value);
        edge.Attribute("target")!.Value.Should().Be(a.Attribute("id")!.Value);
        a.Attribute("id")!.Value.Should().Be("a", "an id that collides with nothing is kept");
    }

    [Fact]
    public void A_label_is_text_not_markup()
    {
        // The cells are html=1, so draw.io reads the value as HTML: `List<Order>` arrived as `List`
        // followed by an unknown tag.
        var model = new ArchModel.ArchModel("Architecture.cs",
            [Element("a", "List<Order> & \"more\""), Element("b", "B")],
            [Link("f", "a", "b", ArchLinkKind.DataFlow, "payload", "<b>bold</b>")],
            []);

        var xml = DrawioExporter.Export(model);

        Cell(xml, "a").Attribute("value")!.Value.Should().Be("List&lt;Order&gt; &amp; &quot;more&quot;");
        Cell(xml, "f").Attribute("value")!.Value.Should().Be("&lt;b&gt;bold&lt;/b&gt;");
    }

    [Fact]
    public void Coordinates_are_written_the_same_whatever_the_machine_s_language()
    {
        // Swedish formats a negative number with U+2212, which draw.io does not read as a number.
        var previous = System.Globalization.CultureInfo.CurrentCulture;
        System.Globalization.CultureInfo.CurrentCulture = new System.Globalization.CultureInfo("sv-SE");
        try
        {
            var xml = DrawioExporter.Export(Model, new DrawioExporter.Options
            {
                Positions = new Dictionary<string, (double X, double Y)> { ["mod_a"] = (-120.4, 1234567) },
            });
            var geom = Cell(xml, "mod_a").Element("mxGeometry")!;
            geom.Attribute("x")!.Value.Should().Be("-120");
            geom.Attribute("y")!.Value.Should().Be("1234567");
        }
        finally { System.Globalization.CultureInfo.CurrentCulture = previous; }
    }

    [Fact]
    public void An_empty_model_still_produces_a_file_an_editor_can_open()
    {
        var xml = DrawioExporter.Export(new ArchModel.ArchModel("Architecture.cs", [], [], []));
        Parse(xml).Root!.Name.LocalName.Should().Be("mxfile");
        Cells(xml).Should().BeEmpty();
    }
}
