using System.Text;

namespace Stemma.Engine.ArchModel;

public enum ArchViewKind { C4Context, ModuleMap, DependencyGraph }

/// <summary>
/// Renders an <see cref="ArchModel"/> as a Mermaid flowchart, which the canvas saves inside a
/// <c>```mermaid</c> fence in a Markdown file.
///
/// Mermaid parses names and payloads as part of its syntax, and they are whatever someone typed. The
/// export used to write model ids as node ids and labels almost as they were: a newline in a name
/// began a statement of its own (a <c>click … href</c>), a <c>|</c> in a payload cut its edge, an
/// element with the id <c>end</c> closed the chart's block, <c>a-b</c> and <c>a_b</c> were drawn as
/// one node, and a name holding <c>```</c> ended the Markdown fence. So node ids are generated —
/// <c>n1</c>, <c>n2</c>, … in the model's order, stable from one export to the next — and every
/// label is written with Mermaid's entity codes for the characters it would read as syntax.
/// </summary>
public static class MermaidExporter
{
    public static string Export(ArchModel model, ArchViewKind view)
    {
        var chart = new Chart(model);
        switch (view)
        {
            case ArchViewKind.C4Context: ExportC4Context(model, chart); break;
            case ArchViewKind.DependencyGraph: ExportDependencyGraph(model, chart); break;
            default: ExportModuleMap(model, chart); break;
        }
        return chart.ToString();
    }

    private static void ExportC4Context(ArchModel model, Chart chart)
    {
        chart.Line("flowchart TD");
        foreach (var p in model.Elements.Where(e => e.Kind == ArchElementKind.Person))
            chart.Node("    ", p.Id, $"👤 {p.Name}");
        foreach (var s in model.Elements.Where(e => e.Kind == ArchElementKind.SoftwareSystem))
            chart.Node("    ", s.Id, $"🖥 {s.Name}");
        foreach (var l in model.Links.Where(x => x.Kind == ArchLinkKind.DataFlow))
            chart.Edge(l, "-->", l.Attributes.GetValueOrDefault("payload"));
    }

    private static void ExportModuleMap(ArchModel model, Chart chart)
    {
        chart.Line("flowchart TB");
        var contexts = model.Elements.Where(e => e.Kind == ArchElementKind.BoundedContext).ToList();
        var contextIds = contexts.Select(c => c.Id).ToHashSet(StringComparer.Ordinal);
        var modules = model.Elements.Where(e => e.Kind == ArchElementKind.Module).ToList();
        foreach (var ctx in contexts)
        {
            chart.Line($"    subgraph {chart.Id(ctx.Id)}[\"{Label($"📦 {ctx.Name}")}\"]");
            chart.Declared(ctx.Id);
            foreach (var m in modules.Where(m => m.Attributes.GetValueOrDefault("contextId") == ctx.Id))
                chart.Node("        ", m.Id, m.Name);
            chart.Line("    end");
        }
        // Modules without a context, or with one the model does not have.
        foreach (var m in modules.Where(m => m.Attributes.GetValueOrDefault("contextId") is not { } c || !contextIds.Contains(c)))
            chart.Node("    ", m.Id, m.Name);
        foreach (var l in model.Links.Where(x => x.Kind == ArchLinkKind.DataFlow))
            chart.Edge(l, "-->", l.Attributes.GetValueOrDefault("payload"));
    }

    private static void ExportDependencyGraph(ArchModel model, Chart chart)
    {
        chart.Line("flowchart LR");
        foreach (var m in model.Elements.Where(e => e.Kind == ArchElementKind.Module))
            chart.Node("    ", m.Id, m.Name);
        foreach (var d in model.Links.Where(x => x.Kind == ArchLinkKind.Dependency))
            chart.Edge(d, "-.->", d.Attributes.TryGetValue("kind", out var k) ? k : "uses");
    }

    /// <summary>
    /// Text as a Mermaid label: a line break as <c>&lt;br&gt;</c>, and each character Mermaid would read
    /// as syntax as its entity code — the quote that ends a label, the pipe that ends an edge's, the
    /// brackets that open a shape, the backtick that ends the Markdown fence, and <c>#</c>, which
    /// starts an entity code itself.
    /// </summary>
    internal static string Label(string text)
    {
        var sb = new StringBuilder(text.Length);
        for (var i = 0; i < text.Length; i++)
        {
            var ch = text[i];
            switch (ch)
            {
                case '\r' when i + 1 < text.Length && text[i + 1] == '\n': break;
                case '\r' or '\n': sb.Append("<br>"); break;
                case '"': sb.Append("#quot;"); break;
                case '&': sb.Append("#amp;"); break;
                case '<': sb.Append("#lt;"); break;
                case '>': sb.Append("#gt;"); break;
                case '#' or '|' or '`' or '[' or ']' or '{' or '}':
                    sb.Append('#').Append((int)ch).Append(';');
                    break;
                default: sb.Append(ch); break;
            }
        }
        return sb.ToString();
    }

    /// <summary>
    /// One chart being written: model ids mapped to node ids, and which nodes it has declared, so an
    /// edge to an element the view does not show still names that element instead of a bare id.
    /// </summary>
    private sealed class Chart
    {
        private readonly StringBuilder _text = new();
        private readonly Dictionary<string, string> _ids = new(StringComparer.Ordinal);
        private readonly Dictionary<string, string> _names = new(StringComparer.Ordinal);
        private readonly HashSet<string> _declared = new(StringComparer.Ordinal);

        public Chart(ArchModel model)
        {
            foreach (var e in model.Elements)
            {
                if (_ids.ContainsKey(e.Id)) continue;
                _ids[e.Id] = $"n{_ids.Count + 1}";
                _names[e.Id] = e.Name;
            }
        }

        /// <summary>The node id for a model id; one the model does not have gets the next free one.</summary>
        public string Id(string modelId)
        {
            if (!_ids.TryGetValue(modelId, out var id)) _ids[modelId] = id = $"n{_ids.Count + 1}";
            return id;
        }

        public void Declared(string modelId) => _declared.Add(modelId);

        public void Line(string line) => _text.Append(line).Append('\n');

        public void Node(string indent, string modelId, string label)
        {
            _declared.Add(modelId);
            Line($"{indent}{Id(modelId)}[\"{Label(label)}\"]");
        }

        public void Edge(ArchLink link, string arrow, string? label)
        {
            foreach (var end in new[] { link.FromId, link.ToId })
                if (!_declared.Contains(end)) Node("    ", end, _names.GetValueOrDefault(end) ?? end);
            var text = string.IsNullOrEmpty(label) ? "" : $"|{Label(label)}|";
            Line($"    {Id(link.FromId)} {arrow}{text} {Id(link.ToId)}");
        }

        public override string ToString() => _text.ToString();
    }
}
