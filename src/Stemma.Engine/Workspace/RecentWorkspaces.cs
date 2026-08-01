using System.Text.Json;

namespace Stemma.Engine.Workspace;

/// <summary>
/// Tracks the most recently opened workspaces in a small JSON file under the user's
/// home directory (`~/.stemma/recent.json`). Used by the topbar dropdown.
/// </summary>
public static class RecentWorkspaces
{
    private const int MaxEntries = 10;

    public sealed record Entry(string RootPath, string DisplayName, DateTime LastOpened);

    private static string FilePath
    {
        get
        {
            var home = Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);
            return Path.Combine(home, ".stemma", "recent.json");
        }
    }

    private static readonly JsonSerializerOptions Opts = new() { WriteIndented = true };

    public static IReadOnlyList<Entry> Load()
    {
        try
        {
            if (!File.Exists(FilePath)) return [];
            var text = File.ReadAllText(FilePath);
            var list = JsonSerializer.Deserialize<List<Entry>>(text, Opts);
            return list?.Where(e => Directory.Exists(e.RootPath)).Take(MaxEntries).ToList() ?? [];
        }
        catch { return []; }
    }

    public static void Touch(string rootPath, string? displayName = null)
    {
        try
        {
            var dir = Path.GetDirectoryName(FilePath);
            if (!string.IsNullOrEmpty(dir)) Directory.CreateDirectory(dir);
            var name = displayName ?? Path.GetFileName(rootPath.TrimEnd('/', '\\'));
            var current = Load().Where(e => !string.Equals(e.RootPath, rootPath, StringComparison.OrdinalIgnoreCase)).ToList();
            current.Insert(0, new Entry(rootPath, name, DateTime.UtcNow));
            var trimmed = current.Take(MaxEntries).ToList();
            File.WriteAllText(FilePath, JsonSerializer.Serialize(trimmed, Opts));
        }
        catch { /* best-effort */ }
    }
}
