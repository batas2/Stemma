using System.Text.Json;
using System.Text.Json.Serialization;

namespace Stemma.Engine.Workspace;

/// <summary>
/// `stemma.layout.json` at the workspace root — the committed presentation layer for the model.
/// Holds everything that is *about how the architecture is drawn and annotated* (and therefore
/// must travel with the model in Git) without being part of the canonical code model itself:
/// per-view node positions + edge waypoints, per-element styles, free-text notes, custom
/// properties, free-form canvas annotations, and per-edge flow ordering.
///
/// The rich sections are stored as pass-through JSON (<see cref="JsonElement"/>): the web client
/// owns their schema, the engine only persists them verbatim. This keeps presentation features
/// evolving in the client without lock-step backend changes.
///
/// That pass-through promise applies at *every* level, which is why this type and both of its
/// nested container types carry <see cref="JsonExtensionDataAttribute"/>. Without it, a member the
/// client writes but the server has never heard of is dropped during model binding — before
/// <see cref="Write"/> is ever reached — so the write is not lossy, the *bind* is. That is B-001:
/// `views.&lt;key&gt;.shapes` and `views.&lt;key&gt;.edges.&lt;id&gt;.handles` never reached disk in
/// either direction, and the round-trip test stayed green because it only asserted members the type
/// declares. **When adding a nested type here, give it extension data too.**
/// </summary>
public sealed class LayoutSidecar
{
    /// <summary>
    /// Canonical location of the JSON Schema describing this file, published at
    /// `schema/stemma.layout.schema.json` in the repository. Stamped into every sidecar that does
    /// not already carry one so editors validate it live and anyone authoring the format by hand —
    /// including an agent that never opens the app — has something to author against.
    /// </summary>
    public const string SchemaUrl =
        "https://raw.githubusercontent.com/batas2/Stemma/main/schema/stemma.layout.schema.json";

    /// <summary>Declared first so it serialises at the top of the file, where a reader looks for it.
    /// An existing value is left alone: a workspace may deliberately pin a different copy.</summary>
    [JsonPropertyName("$schema")] public string? Schema { get; set; }

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

    /// <summary>Any top-level section the client writes that this type does not model, preserved
    /// verbatim across a read/write cycle.</summary>
    [JsonExtensionData] public Dictionary<string, JsonElement>? Extra { get; set; }

    public sealed class ViewLayout
    {
        [JsonPropertyName("nodes")] public Dictionary<string, Position> Nodes { get; set; } = new();
        [JsonPropertyName("edges")] public Dictionary<string, EdgeWaypoints>? Edges { get; set; }

        /// <summary>
        /// How this view is arranged: `custom` (the stored positions are authoritative) or one of
        /// the auto algorithms, which re-run on open. Absent means `custom`.
        ///
        /// This lived in `localStorage` until it became clear that a workspace cloned from Git did
        /// not carry the one field that decides whether the committed positions are honoured or
        /// immediately overwritten — so the same repository drew differently on two machines. It is
        /// presentation, it must travel with the model, so it belongs here.
        /// </summary>
        [JsonPropertyName("layoutMode")] public string? LayoutMode { get; set; }

        /// <summary>Everything else the client keeps per view — today `shapes`; tomorrow whatever
        /// the canvas invents next. Preserved verbatim; never interpreted here.</summary>
        [JsonExtensionData] public Dictionary<string, JsonElement>? Extra { get; set; }
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

        /// <summary>Everything else the client keeps per edge — today `handles` (draw.io-style dock
        /// anchors). Preserved verbatim; never interpreted here.</summary>
        [JsonExtensionData] public Dictionary<string, JsonElement>? Extra { get; set; }
    }

    private static readonly JsonSerializerOptions JsonOpts = new()
    {
        WriteIndented = true,
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
    };

    public static string PathFor(string workspaceRoot) => Path.Combine(workspaceRoot, "stemma.layout.json");

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
        if (string.IsNullOrWhiteSpace(Schema)) Schema = SchemaUrl;
        var json = JsonSerializer.Serialize(this, JsonOpts);
        File.WriteAllText(path, json);
    }
}
