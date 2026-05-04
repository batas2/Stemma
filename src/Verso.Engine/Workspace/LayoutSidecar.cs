using System.Text.Json;
using System.Text.Json.Serialization;

namespace Verso.Engine.Workspace;

/// <summary>
/// `verso.layout.json` at the workspace root. Stores per-view node positions and per-element
/// styling so layouts travel with the model in Git.
/// </summary>
public sealed class LayoutSidecar
{
    [JsonPropertyName("version")] public int Version { get; set; } = 1;
    [JsonPropertyName("views")] public Dictionary<string, ViewLayout> Views { get; set; } = new();
    [JsonPropertyName("nodeStyles")] public Dictionary<string, NodeStyle> NodeStyles { get; set; } = new();
    [JsonPropertyName("edgeStyles")] public Dictionary<string, EdgeStyle> EdgeStyles { get; set; } = new();

    public sealed class ViewLayout
    {
        [JsonPropertyName("nodes")] public Dictionary<string, Position> Nodes { get; set; } = new();
        [JsonPropertyName("edges")] public Dictionary<string, EdgeWaypoints>? Edges { get; set; }
    }

    public sealed class Position
    {
        [JsonPropertyName("x")] public double X { get; set; }
        [JsonPropertyName("y")] public double Y { get; set; }
    }

    public sealed class EdgeWaypoints
    {
        [JsonPropertyName("waypoints")] public List<Position>? Waypoints { get; set; }
        [JsonPropertyName("labelOffset")] public Position? LabelOffset { get; set; }
    }

    public sealed class NodeStyle
    {
        [JsonPropertyName("fillColor")] public string? FillColor { get; set; }
        [JsonPropertyName("borderColor")] public string? BorderColor { get; set; }
        [JsonPropertyName("borderWidth")] public double? BorderWidth { get; set; }
    }

    public sealed class EdgeStyle
    {
        [JsonPropertyName("thickness")] public double? Thickness { get; set; }
        [JsonPropertyName("lineStyle")] public string? LineStyle { get; set; }
        [JsonPropertyName("color")] public string? Color { get; set; }
    }

    private static readonly JsonSerializerOptions JsonOpts = new()
    {
        WriteIndented = true,
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
    };

    public static string PathFor(string workspaceRoot) => Path.Combine(workspaceRoot, "verso.layout.json");

    public static LayoutSidecar Read(string workspaceRoot)
    {
        var path = PathFor(workspaceRoot);
        if (!File.Exists(path)) return new LayoutSidecar();
        try
        {
            var text = File.ReadAllText(path);
            return JsonSerializer.Deserialize<LayoutSidecar>(text, JsonOpts) ?? new LayoutSidecar();
        }
        catch
        {
            return new LayoutSidecar();
        }
    }

    public void Write(string workspaceRoot)
    {
        var path = PathFor(workspaceRoot);
        var json = JsonSerializer.Serialize(this, JsonOpts);
        File.WriteAllText(path, json);
    }
}
