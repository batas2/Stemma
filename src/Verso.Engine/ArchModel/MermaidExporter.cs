using System.Text;

namespace Verso.Engine.ArchModel;

public enum ArchViewKind { C4Context, ModuleMap, DependencyGraph }

public static class MermaidExporter
{
    public static string Export(ArchModel model, ArchViewKind view) => view switch
    {
        ArchViewKind.C4Context => ExportC4Context(model),
        ArchViewKind.ModuleMap => ExportModuleMap(model),
        ArchViewKind.DependencyGraph => ExportDependencyGraph(model),
        _ => ExportModuleMap(model)
    };

    private static string ExportC4Context(ArchModel model)
    {
        var sb = new StringBuilder();
        sb.AppendLine("flowchart TD");
        foreach (var p in model.Elements.Where(e => e.Kind == ArchElementKind.Person))
            sb.AppendLine($"    {Safe(p.Id)}[\"👤 {Escape(p.Name)}\"]");
        foreach (var s in model.Elements.Where(e => e.Kind == ArchElementKind.SoftwareSystem))
            sb.AppendLine($"    {Safe(s.Id)}[\"🖥 {Escape(s.Name)}\"]");
        foreach (var l in model.Links.Where(x => x.Kind == ArchLinkKind.DataFlow))
        {
            var payload = l.Attributes.TryGetValue("payload", out var p) ? p : null;
            sb.AppendLine($"    {Safe(l.FromId)} -->|{Escape(payload ?? string.Empty)}| {Safe(l.ToId)}");
        }
        return sb.ToString();
    }

    private static string ExportModuleMap(ArchModel model)
    {
        var sb = new StringBuilder();
        sb.AppendLine("flowchart TB");
        var contexts = model.Elements.Where(e => e.Kind == ArchElementKind.BoundedContext).ToList();
        foreach (var ctx in contexts)
        {
            sb.AppendLine($"    subgraph {Safe(ctx.Id)}[\"📦 {Escape(ctx.Name)}\"]");
            foreach (var m in model.Elements.Where(e => e.Kind == ArchElementKind.Module
                                                      && e.Attributes.TryGetValue("contextId", out var c) && c == ctx.Id))
                sb.AppendLine($"        {Safe(m.Id)}[\"{Escape(m.Name)}\"]");
            sb.AppendLine("    end");
        }
        // Modules without a context.
        foreach (var m in model.Elements.Where(e => e.Kind == ArchElementKind.Module
                                                  && (!e.Attributes.TryGetValue("contextId", out var c) || c is null)))
            sb.AppendLine($"    {Safe(m.Id)}[\"{Escape(m.Name)}\"]");
        foreach (var l in model.Links.Where(x => x.Kind == ArchLinkKind.DataFlow))
        {
            var payload = l.Attributes.TryGetValue("payload", out var p) ? p : null;
            sb.AppendLine($"    {Safe(l.FromId)} -->|{Escape(payload ?? string.Empty)}| {Safe(l.ToId)}");
        }
        return sb.ToString();
    }

    private static string ExportDependencyGraph(ArchModel model)
    {
        var sb = new StringBuilder();
        sb.AppendLine("flowchart LR");
        foreach (var m in model.Elements.Where(e => e.Kind == ArchElementKind.Module))
            sb.AppendLine($"    {Safe(m.Id)}[\"{Escape(m.Name)}\"]");
        foreach (var d in model.Links.Where(x => x.Kind == ArchLinkKind.Dependency))
        {
            var kind = d.Attributes.TryGetValue("kind", out var k) ? k : "uses";
            sb.AppendLine($"    {Safe(d.FromId)} -.->|{Escape(kind ?? string.Empty)}| {Safe(d.ToId)}");
        }
        return sb.ToString();
    }

    private static string Safe(string id) => id.Replace('-', '_').Replace('.', '_');
    private static string Escape(string text) => text.Replace("\"", "'");
}
