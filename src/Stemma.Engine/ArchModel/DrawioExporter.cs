using System.Text;
using System.Xml.Linq;

namespace Stemma.Engine.ArchModel;

/// <summary>
/// The ink a draw.io export is drawn with.
///
/// The exporter used to hard-code draw.io's own pastel defaults — a different fill per element kind,
/// which is the opposite of what a diagram bound for a document wants, and encodes meaning in hue
/// alone. Palettes are named here for the same reason they are named for the renderer: what ships
/// with the tool is the technique, never anyone's brand.
/// </summary>
public sealed record DrawioPalette(string Name, string Stroke, string Text, string Accent, string Fill)
{
    /// <summary>One ink legible on both a light and a dark page, outline-only. The sane default for
    /// a diagram whose destination background is unknown.</summary>
    public static readonly DrawioPalette DualTheme = new("dual-theme", "#767884", "#767884", "#6366e8", "none");

    /// <summary>Dark ink on white, for something that will be printed.</summary>
    public static readonly DrawioPalette Print = new("print", "#3f3f46", "#18181b", "#4338ca", "none");

    /// <summary>draw.io's own defaults: a different pastel per kind. Kept so an existing workflow is
    /// not broken by this becoming configurable, and not recommended.</summary>
    public static readonly DrawioPalette Classic = new("classic", "", "", "", "");

    public static DrawioPalette Resolve(string? name) => name?.ToLowerInvariant() switch
    {
        "print" => Print,
        "classic" => Classic,
        _ => DualTheme,
    };

    public bool IsClassic => Name == "classic";
}

/// <summary>
/// Renders an <see cref="ArchModel"/> as draw.io / diagrams.net XML.
///
/// Three things were wrong with this for anything but a smoke test, and all three made the output
/// useless as an escape hatch to a mature editor: it ignored the layout entirely and laid every
/// element out on a fixed grid, it always emitted the whole model regardless of which view was on
/// screen, and it prefixed every label with its kind. A diagram exported that way has to be
/// rebuilt by hand, which is the opposite of an escape hatch.
/// </summary>
public static class DrawioExporter
{
    public sealed record Options
    {
        /// <summary>Positions in flow coordinates, keyed by element id. Absent ids fall back to a grid.</summary>
        public IReadOnlyDictionary<string, (double X, double Y)>? Positions { get; init; }

        /// <summary>Restrict the export to these ids. Null exports everything.</summary>
        public IReadOnlyCollection<string>? ElementIds { get; init; }

        public DrawioPalette Palette { get; init; } = DrawioPalette.DualTheme;

        /// <summary>Prefix each label with its kind ("Module: Checkout"). Useful in the tool, noise in a document.</summary>
        public bool LabelKinds { get; init; }

        public string DiagramName { get; init; } = "Stemma";
    }

    private const double NodeWidth = 160;
    private const double NodeHeight = 60;

    public static string Export(ArchModel model, Options? options = null)
    {
        var o = options ?? new Options();

        var elements = o.ElementIds is null
            ? model.Elements.ToList()
            : model.Elements.Where(e => o.ElementIds.Contains(e.Id)).ToList();
        var nodeIds = elements.Select(e => e.Id).ToHashSet(StringComparer.Ordinal);

        var graph = new XElement("mxGraphModel",
            new XAttribute("dx", "1200"), new XAttribute("dy", "800"),
            new XAttribute("grid", "0"), new XAttribute("gridSize", "10"),
            new XAttribute("guides", "1"), new XAttribute("tooltips", "1"),
            new XAttribute("connect", "1"), new XAttribute("arrows", "1"),
            new XAttribute("fold", "1"), new XAttribute("page", "1"),
            new XAttribute("pageScale", "1"), new XAttribute("pageWidth", "850"),
            new XAttribute("pageHeight", "1100"),
            // Transparent, matching what a published diagram needs and what the renderer defaults to.
            new XAttribute("background", "none"));

        var root = new XElement("root",
            new XElement("mxCell", new XAttribute("id", "0")),
            new XElement("mxCell", new XAttribute("id", "1"), new XAttribute("parent", "0")));

        foreach (var (element, point) in Placed(elements, o.Positions))
        {
            var label = o.LabelKinds ? $"{LabelFor(element.Kind)}: {element.Name}" : element.Name;
            root.Add(new XElement("mxCell",
                new XAttribute("id", element.Id),
                new XAttribute("value", label),
                new XAttribute("style", StyleFor(element.Kind, o.Palette)),
                new XAttribute("vertex", "1"),
                new XAttribute("parent", "1"),
                new XElement("mxGeometry",
                    new XAttribute("x", point.X.ToString("0")),
                    new XAttribute("y", point.Y.ToString("0")),
                    new XAttribute("width", NodeWidth.ToString("0")),
                    new XAttribute("height", NodeHeight.ToString("0")),
                    new XAttribute("as", "geometry"))));
        }

        foreach (var link in model.Links)
        {
            if (!nodeIds.Contains(link.FromId) || !nodeIds.Contains(link.ToId)) continue;
            root.Add(new XElement("mxCell",
                new XAttribute("id", link.Id),
                new XAttribute("value", LabelFor(link)),
                new XAttribute("style", EdgeStyleFor(link, o.Palette)),
                new XAttribute("edge", "1"),
                new XAttribute("source", link.FromId),
                new XAttribute("target", link.ToId),
                new XAttribute("parent", "1"),
                new XElement("mxGeometry", new XAttribute("relative", "1"), new XAttribute("as", "geometry"))));
        }

        graph.Add(root);

        var mxfile = new XElement("mxfile",
            new XAttribute("compressed", "false"),
            new XElement("diagram", new XAttribute("name", o.DiagramName), graph));

        var sb = new StringBuilder();
        sb.AppendLine("""<?xml version="1.0" encoding="UTF-8"?>""");
        sb.Append(mxfile.ToString());
        return sb.ToString();
    }

    /// <summary>
    /// Pair each element with where it goes: its real position when the layout has one, otherwise the
    /// next slot on a fallback grid.
    ///
    /// Elements that *do* have positions never consume a grid slot, so a partly-laid-out view does
    /// not scatter its unplaced elements through the middle of the placed ones.
    /// </summary>
    private static IEnumerable<(ArchElement Element, (double X, double Y) Point)> Placed(
        IReadOnlyList<ArchElement> elements,
        IReadOnlyDictionary<string, (double X, double Y)>? positions)
    {
        double nextX = 40, nextY = 40;
        foreach (var e in elements)
        {
            if (positions is not null && positions.TryGetValue(e.Id, out var known))
            {
                yield return (e, known);
                continue;
            }
            yield return (e, (nextX, nextY));
            nextX += NodeWidth + 20;
            if (nextX > 700) { nextX = 40; nextY += NodeHeight + 40; }
        }
    }

    private static string StyleFor(ArchElementKind kind, DrawioPalette palette)
    {
        if (palette.IsClassic) return ClassicStyleFor(kind);

        // One ink for everything, and shape rather than colour to tell kinds apart — a diagram must
        // survive greyscale, and hue alone is not a distinction a reader can rely on.
        var basics = $"whiteSpace=wrap;html=1;fillColor={palette.Fill};strokeColor={palette.Stroke};fontColor={palette.Text};strokeWidth=1.6;";
        return kind switch
        {
            ArchElementKind.Person => $"shape=umlActor;verticalLabelPosition=bottom;align=center;outlineConnect=0;html=1;strokeColor={palette.Stroke};fontColor={palette.Text};",
            ArchElementKind.UseCase => $"ellipse;{basics}",
            ArchElementKind.BoundedContext => $"rounded=1;arcSize=14;dashed=1;dashPattern=6 4;{basics}",
            ArchElementKind.Concept => $"rounded=1;arcSize=14;{basics}",
            _ => $"rounded=1;arcSize=14;{basics}",
        };
    }

    private static string ClassicStyleFor(ArchElementKind kind) => kind switch
    {
        ArchElementKind.Person => "shape=umlActor;verticalLabelPosition=bottom;align=center;outlineConnect=0;html=1",
        ArchElementKind.SoftwareSystem => "rounded=1;whiteSpace=wrap;html=1;fillColor=#dae8fc;strokeColor=#6c8ebf",
        ArchElementKind.Container => "rounded=1;whiteSpace=wrap;html=1;fillColor=#d5e8d4;strokeColor=#82b366",
        ArchElementKind.BoundedContext => "rounded=1;whiteSpace=wrap;html=1;dashed=1;fillColor=#e1d5e7;strokeColor=#9673a6",
        ArchElementKind.Module => "rounded=1;whiteSpace=wrap;html=1;fillColor=#fff2cc;strokeColor=#d6b656",
        ArchElementKind.UseCase => "ellipse;whiteSpace=wrap;html=1;fillColor=#f8cecc;strokeColor=#b85450",
        ArchElementKind.Capability => "rounded=1;whiteSpace=wrap;html=1;fillColor=#dae8fc;strokeColor=#6c8ebf",
        ArchElementKind.Concept => "rounded=1;whiteSpace=wrap;html=1;fillColor=none;strokeColor=#767884",
        _ => "rounded=1;whiteSpace=wrap;html=1"
    };

    private static string EdgeStyleFor(ArchLink link, DrawioPalette palette)
    {
        // Dashed for a dependency, solid for a flow: the same line-style distinction the canvas
        // makes, and one that survives being printed in black and white.
        var dashed = link.Kind == ArchLinkKind.Dependency ? "dashed=1;dashPattern=6 4;" : "";
        if (palette.IsClassic) return $"endArrow=classic;html=1;{dashed}";
        return $"endArrow=block;endFill=1;html=1;rounded=0;strokeWidth=1.6;strokeColor={palette.Stroke};fontColor={palette.Text};{dashed}";
    }

    /// <summary>What actually flows or depends, never the bare word "uses" where something better exists.</summary>
    private static string LabelFor(ArchLink link) => link.Kind switch
    {
        ArchLinkKind.DataFlow => link.Attributes.GetValueOrDefault("payload") ?? "",
        ArchLinkKind.Relation => link.Attributes.GetValueOrDefault("label") ?? "",
        _ => link.Attributes.GetValueOrDefault("kind") ?? "uses",
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
        ArchElementKind.Concept => "Concept",
        _ => kind.ToString()
    };
}
