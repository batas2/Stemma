using System.Text.Json;

namespace Stemma.Engine.Workspace;

/// <summary>
/// Tracks the most recently opened workspaces in a small JSON file, by default under the user's
/// home directory (`~/.stemma/recent.json`). Used by the topbar dropdown and the start screen.
///
/// An entry leaves the list when it is pushed off the end or when its owner removes it — never because
/// its folder is missing when the list is read. A folder on a drive that is not plugged in, or a
/// checkout moved for a minute, is still theirs; it is shown as missing, not forgotten.
/// </summary>
public sealed class RecentWorkspaces(string filePath)
{
    private const int MaxEntries = 10;

    public sealed record Entry(string RootPath, string DisplayName, DateTime LastOpened);

    /// <summary>The list a person's own Stemma keeps, beside the logs in <c>~/.stemma</c>.</summary>
    public static RecentWorkspaces ForUser() =>
        new(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), ".stemma", "recent.json"));

    public string FilePath { get; } = filePath;

    private static readonly JsonSerializerOptions Opts = new() { WriteIndented = true };

    public IReadOnlyList<Entry> Load()
    {
        try
        {
            if (!File.Exists(FilePath)) return [];
            var list = JsonSerializer.Deserialize<List<Entry>>(File.ReadAllText(FilePath), Opts);
            return list?.Where(e => !string.IsNullOrWhiteSpace(e?.RootPath)).Take(MaxEntries).ToList() ?? [];
        }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException or JsonException)
        {
            // A list that cannot be read is an empty start screen, not a failure to start.
            return [];
        }
    }

    public Task TouchAsync(string rootPath, string? displayName = null)
    {
        var name = displayName ?? Path.GetFileName(rootPath.TrimEnd('/', '\\'));
        var rest = Load().Where(e => !SameFolder(e.RootPath, rootPath));
        return SaveAsync([new Entry(rootPath, name, DateTime.UtcNow), .. rest]);
    }

    /// <summary>Take <paramref name="rootPath"/> off the list, which only its owner does.</summary>
    public Task RemoveAsync(string rootPath) => SaveAsync(Load().Where(e => !SameFolder(e.RootPath, rootPath)));

    private async Task SaveAsync(IEnumerable<Entry> entries)
    {
        try
        {
            var dir = Path.GetDirectoryName(FilePath);
            if (!string.IsNullOrEmpty(dir)) Directory.CreateDirectory(dir);
            // Replaced whole, never emptied and written again in place: a reader in between — the
            // other window's start screen — would read half a list, and a crash would leave none.
            await SidecarFile.WriteAtomicallyAsync(FilePath, JsonSerializer.SerializeToUtf8Bytes(entries.Take(MaxEntries).ToList(), Opts));
        }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException)
        {
            // Best-effort: a workspace opens whether or not it could be remembered.
        }
    }

    /// <summary>
    /// The same folder however it is spelled, compared as the file system compares names: two folders
    /// whose names differ only in case are two folders on Linux, and one on Windows and macOS.
    /// </summary>
    private static bool SameFolder(string a, string b)
    {
        static string Normal(string p) => Path.TrimEndingDirectorySeparator(Path.GetFullPath(p));
        var comparison = OperatingSystem.IsWindows() || OperatingSystem.IsMacOS() ? StringComparison.OrdinalIgnoreCase : StringComparison.Ordinal;
        try { return string.Equals(Normal(a), Normal(b), comparison); }
        catch (ArgumentException) { return string.Equals(a, b, comparison); }
    }
}
