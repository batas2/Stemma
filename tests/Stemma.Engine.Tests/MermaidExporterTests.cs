using FluentAssertions;
using Stemma.Engine.ArchModel;
using Xunit;

namespace Stemma.Engine.Tests;

/// <summary>
/// The Mermaid export is text another tool parses, and what it carries — names, payloads — is
/// whatever someone typed. Each case here is a name or an id that used to change what the chart
/// said: a statement injected through a newline, an edge cut by a pipe, a keyword taken for the end
/// of a block, two ids merged into one node, and a fence the Markdown wrapper could not contain.
/// </summary>
public sealed class MermaidExporterTests
{
    private static ArchElement Element(string id, string name, ArchElementKind kind = ArchElementKind.Module, string? contextId = null) =>
        new(id, name, kind, contextId is null ? new Dictionary<string, string?>() : new Dictionary<string, string?> { ["contextId"] = contextId });

    private static ArchLink Flow(string id, string from, string to, string payload) =>
        new(id, from, to, ArchLinkKind.DataFlow, new Dictionary<string, string?> { ["payload"] = payload });

    private static ArchLink Dependency(string id, string from, string to, string kind) =>
        new(id, from, to, ArchLinkKind.Dependency, new Dictionary<string, string?> { ["kind"] = kind });

    private static string[] Lines(string text) => text.Split('\n', StringSplitOptions.RemoveEmptyEntries).Select(l => l.Trim()).ToArray();

    [Fact]
    public void Node_ids_are_generated_so_a_keyword_or_two_similar_ids_cannot_change_the_chart()
    {
        // `end` closed the chart's block; `a-b` and `a_b` both became `a_b`, so a dependency between
        // two modules was drawn as a module depending on itself.
        var model = new ArchModel.ArchModel("Architecture.cs",
            [Element("end", "End"), Element("a-b", "First"), Element("a_b", "Second")],
            [Dependency("dep", "a-b", "a_b", "calls"), Dependency("dep2", "end", "a-b", "uses")],
            []);

        var lines = Lines(MermaidExporter.Export(model, ArchViewKind.DependencyGraph));

        lines.Should().Equal(
            "flowchart LR",
            "n1[\"End\"]",
            "n2[\"First\"]",
            "n3[\"Second\"]",
            "n2 -.->|calls| n3",
            "n1 -.->|uses| n2");
    }

    [Fact]
    public void A_newline_in_a_name_is_a_line_break_in_the_label_not_a_new_statement()
    {
        var model = new ArchModel.ArchModel("Architecture.cs",
            [Element("a", "B\nclick a href \"javascript:alert(1)\"")], [], []);

        var lines = Lines(MermaidExporter.Export(model, ArchViewKind.DependencyGraph));

        lines.Should().Equal("flowchart LR", "n1[\"B<br>click a href #quot;javascript:alert(1)#quot;\"]");
    }

    [Fact]
    public void A_pipe_in_a_payload_stays_inside_its_edge_label()
    {
        var model = new ArchModel.ArchModel("Architecture.cs",
            [Element("a", "A"), Element("b", "B")],
            [Flow("f", "a", "b", "x|y --> z")],
            []);

        Lines(MermaidExporter.Export(model, ArchViewKind.ModuleMap)).Should().Contain("n1 -->|x#124;y --#gt; z| n2");
    }

    [Fact]
    public void Characters_Mermaid_reads_as_syntax_are_written_as_its_entity_codes()
    {
        var model = new ArchModel.ArchModel("Architecture.cs",
            [Element("a", "List<Order> & \"quoted\" #1 [x] {y}")], [], []);

        Lines(MermaidExporter.Export(model, ArchViewKind.DependencyGraph)).Should()
            .Contain("n1[\"List#lt;Order#gt; #amp; #quot;quoted#quot; #35;1 #91;x#93; #123;y#125;\"]");
    }

    [Fact]
    public void A_name_holding_a_code_fence_cannot_close_the_Markdown_block_the_chart_is_saved_in()
    {
        var model = new ArchModel.ArchModel("Architecture.cs", [Element("a", "Ends ``` here")], [], []);

        MermaidExporter.Export(model, ArchViewKind.DependencyGraph).Should().NotContain("`");
    }

    [Fact]
    public void Modules_sit_in_their_context_and_an_end_outside_the_view_is_still_named()
    {
        var model = new ArchModel.ArchModel("Architecture.cs",
            [Element("ctx", "Ordering", ArchElementKind.BoundedContext),
             Element("mod", "Checkout", contextId: "ctx"),
             Element("sys", "Payments", ArchElementKind.SoftwareSystem)],
            [Flow("f", "mod", "sys", "Charge"), Flow("g", "mod", "gone", "Lost")],
            []);

        Lines(MermaidExporter.Export(model, ArchViewKind.ModuleMap)).Should().Equal(
            "flowchart TB",
            "subgraph n1[\"📦 Ordering\"]",
            "n2[\"Checkout\"]",
            "end",
            "n3[\"Payments\"]",
            "n2 -->|Charge| n3",
            "n4[\"gone\"]",
            "n2 -->|Lost| n4");
    }
}
