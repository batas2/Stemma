using System.Text;
using System.Xml.Linq;

namespace Stemma.Engine.ArchModel;

/// <summary>
/// Renders an ArchModel as draw.io / diagrams.net XML. One mxgraph cell per element + per link.
/// Layout positions can be supplied via the optional `positions` map; otherwise a simple grid
/// is generated (same as the canvas's default fallback).
/// </summary>
public static class DrawioExporter
{
    public static string Export(ArchModel model, Dictionary<string, (double X, double Y)>? positions = null)
    {
        var graph = new XElement("mxGraphModel",
            new XAttribute("dx", "1200"), new XAttribute("dy", "800"),
            new XAttribute("grid", "1"), new XAttribute("gridSize", "10"),
            new XAttribute("guides", "1"), new XAttribute("tooltips", "1"),
            new XAttribute("connect", "1"), new XAttribute("arrows", "1"),
            new XAttribute("fold", "1"), new XAttribute("page", "1"),
            new XAttribute("pageScale", "1"), new XAttribute("pageWidth", "850"),
            new XAttribute("pageHeight", "1100"));

        var root = new XElement("root",
            new XElement("mxCell", new XAttribute("id", "0")),
            new XElement("mxCell", new XAttribute("id", "1"), new XAttribute("parent", "0")));

        var nodeIds = new HashSet<string>();
        var nextX = 40.0;
        var nextY = 40.0;
        foreach (var e in model.Elements)
        {
            var (x, y) = positions != null && positions.TryGetValue(e.Id, out var p) ? p : (nextX, nextY);
            nextX += 180; if (nextX > 700) { nextX = 40; nextY += 100; }
            var style = StyleFor(e.Kind);
            var cell = new XElement("mxCell",
                new XAttribute("id", e.Id),
                new XAttribute("value", $"{LabelFor(e.Kind)}: {e.Name}"),
                new XAttribute("style", style),
                new XAttribute("vertex", "1"),
                new XAttribute("parent", "1"),
                new XElement("mxGeometry",
                    new XAttribute("x", x.ToString("0")),
                    new XAttribute("y", y.ToString("0")),
                    new XAttribute("width", "160"),
                    new XAttribute("height", "60"),
                    new XAttribute("as", "geometry")));
            root.Add(cell);
            nodeIds.Add(e.Id);
        }

        foreach (var l in model.Links)
        {
            if (!nodeIds.Contains(l.FromId) || !nodeIds.Contains(l.ToId)) continue;
            var label = l.Kind == ArchLinkKind.DataFlow
                ? l.Attributes.GetValueOrDefault("payload") ?? ""
                : l.Attributes.GetValueOrDefault("kind") ?? "uses";
            var dashed = l.Kind == ArchLinkKind.Dependency ? "dashed=1;" : "";
            var edge = new XElement("mxCell",
                new XAttribute("id", l.Id),
                new XAttribute("value", label),
                new XAttribute("style", $"endArrow=classic;html=1;{dashed}"),
                new XAttribute("edge", "1"),
                new XAttribute("source", l.FromId),
                new XAttribute("target", l.ToId),
                new XAttribute("parent", "1"),
                new XElement("mxGeometry", new XAttribute("relative", "1"), new XAttribute("as", "geometry")));
            root.Add(edge);
        }

        graph.Add(root);

        // Wrap in the standard <mxfile> envelope so editors recognise it.
        var mxfile = new XElement("mxfile",
            new XAttribute("compressed", "false"),
            new XElement("diagram", new XAttribute("name", "Stemma"), graph));
        var sb = new StringBuilder();
        sb.AppendLine("""<?xml version="1.0" encoding="UTF-8"?>""");
        sb.Append(mxfile.ToString());
        return sb.ToString();
    }

    private static string StyleFor(ArchElementKind kind) => kind switch
    {
        ArchElementKind.Person => "shape=umlActor;verticalLabelPosition=bottom;align=center;outlineConnect=0;html=1",
        ArchElementKind.SoftwareSystem => "rounded=1;whiteSpace=wrap;html=1;fillColor=#dae8fc;strokeColor=#6c8ebf",
        ArchElementKind.Container => "rounded=1;whiteSpace=wrap;html=1;fillColor=#d5e8d4;strokeColor=#82b366",
        ArchElementKind.BoundedContext => "rounded=1;whiteSpace=wrap;html=1;dashed=1;fillColor=#e1d5e7;strokeColor=#9673a6",
        ArchElementKind.Module => "rounded=1;whiteSpace=wrap;html=1;fillColor=#fff2cc;strokeColor=#d6b656",
        ArchElementKind.UseCase => "ellipse;whiteSpace=wrap;html=1;fillColor=#f8cecc;strokeColor=#b85450",
        ArchElementKind.Capability => "rounded=1;whiteSpace=wrap;html=1;fillColor=#dae8fc;strokeColor=#6c8ebf",
        _ => "rounded=1;whiteSpace=wrap;html=1"
    };

    private static string LabelFor(ArchElementKind kind) => kind switch
    {
        ArchElementKind.Person => "Person",
        ArchElementKind.SoftwareSystem => "System",
        ArchElementKind.Container => "Container",
        ArchElementKind.BoundedContext => "Context",
        ArchElementKind.Module => "Module",
        ArchElementKind.UseCase => "UseCase",
        ArchElementKind.Capability => "Capability",
        _ => kind.ToString()
    };
}
