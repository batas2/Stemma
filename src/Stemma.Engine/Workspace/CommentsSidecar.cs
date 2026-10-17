namespace Stemma.Engine.Workspace;

/// <summary>
/// `comments.stemma.json` at the workspace root: comment threads on elements, shapes and views, kept
/// in Git beside the model (ADR-0010) and changed through <see cref="CommentsPatch"/> (B-018).
/// </summary>
public static class CommentsSidecar
{
    public const string FileName = "comments.stemma.json";

    public static string PathFor(string root) => Path.Combine(root, FileName);

    /// <summary>What a comments file Stemma creates starts as.</summary>
    public const string Empty = "{\n  \"version\": 1,\n  \"comments\": []\n}\n";
}
