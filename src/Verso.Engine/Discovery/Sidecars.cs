using System.Text.Json;
using System.Text.Json.Serialization;

namespace Verso.Engine.Discovery;

/// <summary>
/// I/O for `discovered.verso.json`, `metrics.verso.json`, and `verso.discovery.json`.
/// JSON-only in v1 to avoid pulling YamlDotNet; the architect can still spot-fix in any editor.
/// All three sidecars are regenerable; deleting them is safe (per ADR-0007).
/// </summary>
public static class DiscoverySidecars
{
    public const string DiscoveryFileName = "discovered.verso.json";
    public const string MetricsFileName = "metrics.verso.json";
    public const string ConfigFileName = "verso.discovery.json";

    private static readonly JsonSerializerOptions Options = new(JsonSerializerDefaults.Web)
    {
        WriteIndented = true,
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
        Converters = { new JsonStringEnumConverter(JsonNamingPolicy.CamelCase) },
    };

    public static string DiscoveryPath(string root) => Path.Combine(root, DiscoveryFileName);
    public static string MetricsPath(string root) => Path.Combine(root, MetricsFileName);
    public static string ConfigPath(string root) => Path.Combine(root, ConfigFileName);

    public static void WriteDiscovered(string root, DiscoveredModel model)
    {
        File.WriteAllText(DiscoveryPath(root), JsonSerializer.Serialize(model, Options));
    }
    public static DiscoveredModel? ReadDiscovered(string root)
    {
        var path = DiscoveryPath(root);
        if (!File.Exists(path)) return null;
        try { return JsonSerializer.Deserialize<DiscoveredModel>(File.ReadAllText(path), Options); }
        catch { return null; }
    }

    public static void WriteMetrics(string root, WorkspaceMetrics metrics)
    {
        File.WriteAllText(MetricsPath(root), JsonSerializer.Serialize(metrics, Options));
    }
    public static WorkspaceMetrics? ReadMetrics(string root)
    {
        var path = MetricsPath(root);
        if (!File.Exists(path)) return null;
        try { return JsonSerializer.Deserialize<WorkspaceMetrics>(File.ReadAllText(path), Options); }
        catch { return null; }
    }

    public static DiscoveryConfig? ReadConfig(string root)
    {
        var path = ConfigPath(root);
        if (!File.Exists(path)) return null;
        try { return JsonSerializer.Deserialize<DiscoveryConfig>(File.ReadAllText(path), Options); }
        catch { return null; }
    }
}
