using System.Text.Json;
using System.Text.Json.Serialization;

namespace Verso.Engine.Workspace;

/// <summary>
/// `verso.layout.json` at the workspace root — the committed presentation layer for the model.
/// Holds everything that is *about how the architecture is drawn and annotated* (and therefore
/// must travel with the model in Git) without being part of the canonical code model itself:
/// per-view node positions + edge waypoints, per-element styles, free-text notes, custom
/// properties, free-form canvas annotations, and per-edge flow ordering.
///
/// The rich sections are stored as pass-through JSON (<see cref="JsonElement"/>): the web client
/// owns their schema, the engine only persists them verbatim. This keeps presentation features
/// evolving in the client without lock-step backend changes.
/// </summary>
public sealed class LayoutSidecar
{
    [JsonPropertyName("version")] public int Version { get; set; } = 1;
    [JsonPropertyName("views")] public Dictionary<string, ViewLayout> Views { get; set; } = new();

    /// <summary>Per-element node styles, keyed by element id. Schema owned by the web client.</summary>
    [JsonPropertyName("nodeStyles")] public Dictionary<string, JsonElement> NodeStyles { get; set; } = new();

    /// <summary>Per-relationship edge styles (incl. flow `step`), keyed by link id.</summary>
    [JsonPropertyName("edgeStyles")] public Dictionary<string, JsonElement> EdgeStyles { get; set; } = new();

    /// <summary>Per-element rich-text notes (Markdown), keyed by element id.</summary>
    [JsonPropertyName("notes")] public Dictionary<string, string> Notes { get; set; } = new();

    /// <summary>Per-element custom properties ({ key: value }), keyed by element id.</summary>
    [JsonPropertyName("customProps")] public Dictionary<string, JsonElement> CustomProps { get; set; } = new();

    /// <summary>Free-form canvas annotations (text / frames / shapes), keyed by view key.</summary>
    [JsonPropertyName("annotations")] public Dictionary<string, JsonElement> Annotations { get; set; } = new();

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
