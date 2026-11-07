using System.Text.Json;
using Stemma.Engine.Operations;

namespace Stemma.Engine.Workspace;

/// <summary>
/// <c>comments.stemma.json</c> read and changed with no engine open: what the command line needs to
/// work through a review (F-027, ADR-0031). The changes go through <see cref="CommentsPatch"/>, the app's
/// writer, onto the file as it is now, so a comment the app posted a moment ago survives a reply written
/// here; and a file that cannot be read is refused rather than replaced (B-018). An open app sees the
/// write through its watcher.
/// </summary>
public static class CommentsFile
{
    public sealed record Reply(string Author, string CreatedAt, string Body);

    /// <param name="TargetKind"><c>element</c> (an element or a relationship), <c>view</c> or <c>shape</c>.</param>
    public sealed record Comment(
        string Id, string TargetKind, string TargetId, string Author, string CreatedAt, string Body, bool Resolved,
        IReadOnlyList<Reply> Thread);

    /// <summary>The comments in the workspace at <paramref name="root"/>; none when it has no comments file.</summary>
    /// <exception cref="SidecarPatchRefusedException">The file is there and cannot be read.</exception>
    public static IReadOnlyList<Comment> Read(string root)
    {
        var path = CommentsSidecar.PathFor(root);
        return File.Exists(path) ? Parse(File.ReadAllText(path)) : [];
    }

    /// <summary>
    /// The comments a comments file holds, as the app reads them: an entry without an id or a target is
    /// not a comment and is skipped, and a missing field is empty rather than a reason to refuse the rest.
    /// </summary>
    /// <exception cref="SidecarPatchRefusedException">The text is not a comments file Stemma can read.</exception>
    public static IReadOnlyList<Comment> Parse(string text)
    {
        // The writer's reading of the file is the rule: what it would refuse to change is refused here too.
        CommentsPatch.Apply(text, []);
        using var doc = JsonDocument.Parse(text.TrimStart('﻿'), new JsonDocumentOptions { AllowTrailingCommas = true, CommentHandling = JsonCommentHandling.Skip });
        if (!doc.RootElement.TryGetProperty("comments", out var list) || list.ValueKind != JsonValueKind.Array) return [];

        var comments = new List<Comment>();
        foreach (var c in list.EnumerateArray())
        {
            if (c.ValueKind != JsonValueKind.Object) continue;
            var id = Str(c, "id");
            var targetId = Str(c, "targetId");
            if (string.IsNullOrEmpty(id) || string.IsNullOrEmpty(targetId)) continue;
            var thread = new List<Reply>();
            if (c.TryGetProperty("thread", out var t) && t.ValueKind == JsonValueKind.Array)
                foreach (var r in t.EnumerateArray().Where(r => r.ValueKind == JsonValueKind.Object))
                    thread.Add(new Reply(Str(r, "author") ?? "", Str(r, "createdAt") ?? "", Str(r, "body") ?? ""));
            comments.Add(new Comment(id, Str(c, "targetKind") ?? "element", targetId, Str(c, "author") ?? "", Str(c, "createdAt") ?? "",
                Str(c, "body") ?? "", c.TryGetProperty("resolved", out var resolved) && resolved.ValueKind == JsonValueKind.True, thread));
        }
        return comments;
    }

    /// <summary>
    /// <paramref name="changes"/> made to the file as it is on disk — created as Stemma creates it when
    /// there is none — and written in one step. Refused, and nothing written, as <c>UnreadableSidecar</c>
    /// when the file cannot be read, <c>NoSuchComment</c> for a reply to or a resolution of a comment
    /// that is not there, and <c>NotAComment</c> for a comment or reply without its required fields.
    /// </summary>
    public static Task<OperationResult> PatchAsync(string root, IReadOnlyList<CommentChange> changes, CancellationToken ct = default) =>
        new SidecarFile(CommentsSidecar.PathFor(root), CommentsSidecar.Empty)
            .PatchAsync($"comments_{Guid.NewGuid():N}", text => CommentsPatch.Apply(text, changes), ct);

    /// <summary>An id shaped like the app's (<c>cmt_…</c>), so a comment from the command line reads like any other.</summary>
    public static string NewId() =>
        $"cmt_{Base36(DateTimeOffset.UtcNow.ToUnixTimeMilliseconds())}_{Guid.NewGuid().ToString("N")[..4]}";

    /// <summary>A comment as the file holds it, for <see cref="CommentChange.Add"/>.</summary>
    public static JsonElement ToJson(Comment c) => JsonSerializer.SerializeToElement(new
    {
        id = c.Id, targetKind = c.TargetKind, targetId = c.TargetId, author = c.Author, createdAt = c.CreatedAt,
        body = c.Body, resolved = c.Resolved, thread = c.Thread.Select(ToObject),
    });

    /// <summary>A reply as the file holds it, for <see cref="CommentChange.AddReply"/>.</summary>
    public static JsonElement ToJson(Reply r) => JsonSerializer.SerializeToElement(ToObject(r));

    private static object ToObject(Reply r) => new { author = r.Author, createdAt = r.CreatedAt, body = r.Body };

    private static string? Str(JsonElement o, string key) =>
        o.TryGetProperty(key, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() : null;

    private static string Base36(long value)
    {
        const string digits = "0123456789abcdefghijklmnopqrstuvwxyz";
        if (value == 0) return "0";
        var chars = new Stack<char>();
        for (; value > 0; value /= 36) chars.Push(digits[(int)(value % 36)]);
        return new string([.. chars]);
    }
}
