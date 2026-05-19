using System.Text.Json;
using System.Text.Json.Serialization;

namespace Verso.Engine.Workspace;

/// <summary>
/// `comments.verso.json` at the workspace root. Element-bound comment threads.
/// Per Epic 07 / ADR-0010, comments are a Git-versioned sidecar — not a service.
/// Single user at a time; conflicts resolved by Git merge.
/// </summary>
public sealed record CommentsSidecar(int Version, IReadOnlyList<CommentEntry> Comments)
{
    public const string FileName = "comments.verso.json";
    public const int CurrentVersion = 1;

    public static CommentsSidecar Empty() => new(CurrentVersion, Array.Empty<CommentEntry>());

    private static readonly JsonSerializerOptions Options = new(JsonSerializerDefaults.Web)
    {
        WriteIndented = true,
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
    };

    public static string PathFor(string root) => Path.Combine(root, FileName);

    public static CommentsSidecar Read(string root)
    {
        var path = PathFor(root);
        if (!File.Exists(path)) return Empty();
        try
        {
            var s = JsonSerializer.Deserialize<CommentsSidecar>(File.ReadAllText(path), Options);
            return s ?? Empty();
        }
        catch
        {
            return Empty();
        }
    }

    public void Write(string root)
    {
        File.WriteAllText(PathFor(root), JsonSerializer.Serialize(this, Options));
    }
}

public sealed record CommentEntry(
    string Id,
    string TargetKind,           // "element" | "shape" | "view"
    string TargetId,
    string Author,
    DateTime CreatedAt,
    string Body,
    bool Resolved,
    IReadOnlyList<CommentReply> Thread);

public sealed record CommentReply(
    string Author,
    DateTime CreatedAt,
    string Body);
