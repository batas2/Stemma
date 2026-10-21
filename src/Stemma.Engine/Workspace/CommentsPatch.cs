using System.Text;
using System.Text.Json;

namespace Stemma.Engine.Workspace;

/// <summary>One change to <c>comments.stemma.json</c>, naming the comment it changes by its id.</summary>
public abstract record CommentChange
{
    private CommentChange() { }

    /// <summary>A comment after the last one. Nothing, when one with its id is there already.</summary>
    public sealed record Add(JsonElement Comment) : CommentChange;

    /// <summary>A reply after the last one in the comment's thread. Nothing, when that reply is there already.</summary>
    public sealed record AddReply(string Id, JsonElement Reply) : CommentChange;

    public sealed record SetResolved(string Id, bool Resolved) : CommentChange;

    /// <summary>The comment, gone. Nothing, when it is gone already.</summary>
    public sealed record Remove(string Id) : CommentChange;
}

/// <summary>
/// Edits <c>comments.stemma.json</c> the way <see cref="SidecarPatch"/> edits the layout: each change
/// is made to the file as it is, and every other byte stays — the order of comments and of their
/// keys, keys Stemma does not know, escaping, layout, line endings, the final newline (B-018).
///
/// The file used to be written whole from the copy the panel loaded, so a comment that arrived in a
/// pull meanwhile was lost with the next one posted, and a file that did not parse — a merge left
/// its markers in — read as no comments and was replaced by one. Comments are a list, so a change
/// names its comment by id; adding what is there already and removing what is gone change nothing,
/// which makes sending a change twice, or importing a comment pack twice, harmless.
/// </summary>
public static class CommentsPatch
{
    private const string File = "comments.stemma.json";

    public static string Apply(string text, IEnumerable<CommentChange> changes)
    {
        var bytes = Encoding.UTF8.GetBytes(text);
        Read(bytes); // refuse an unreadable file before anything, even when there is nothing to change
        var list = changes.ToList();
        foreach (var change in list)
        {
            switch (change)
            {
                case CommentChange.Add add: JsonText.RefuseInvalidText(add.Comment, "The comment"); break;
                case CommentChange.AddReply reply: JsonText.RefuseInvalidText(reply.Reply, "The reply"); break;
            }
        }
        foreach (var change in list)
        {
            bytes = change switch
            {
                CommentChange.Add add => Add(bytes, add.Comment),
                CommentChange.AddReply reply => AddReply(bytes, reply.Id, reply.Reply),
                CommentChange.SetResolved resolve => SetResolved(bytes, resolve.Id, resolve.Resolved),
                CommentChange.Remove remove => Remove(bytes, remove.Id),
                _ => throw new ArgumentOutOfRangeException(nameof(changes), change, "an unknown change"),
            };
        }
        return Encoding.UTF8.GetString(bytes);
    }

    // ---------------------------------------------------------------- the edits

    private static byte[] Add(byte[] bytes, JsonElement comment)
    {
        if (comment.ValueKind != JsonValueKind.Object
            || !NonEmpty(comment, "id") || !IsString(comment, "targetId") || !IsString(comment, "body"))
            throw new SidecarPatchRefusedException("NotAComment", "A comment needs an id, a target and a body.");

        var (root, list) = Read(bytes);
        var layout = JsonText.Layout.Of(bytes, root);
        if (list is null) return JsonText.AddMember(bytes, layout, root, "comments", JsonText.ListOf(comment));
        if (Find(list, comment.GetProperty("id").GetString()!) is not null) return bytes;
        return JsonText.AppendItem(bytes, layout, list, comment);
    }

    private static byte[] AddReply(byte[] bytes, string id, JsonElement reply)
    {
        if (reply.ValueKind != JsonValueKind.Object || !IsString(reply, "body"))
            throw new SidecarPatchRefusedException("NotAComment", "A reply needs a body.");

        var (root, list) = Read(bytes);
        var comment = Existing(list, id);
        var layout = JsonText.Layout.Of(bytes, root);
        var thread = comment.Find("thread");
        if (thread is null) return JsonText.AddMember(bytes, layout, comment, "thread", JsonText.ListOf(reply));
        if (thread.Array is null) throw JsonText.Unreadable(File, $"has a thread on '{id}' that is not a list");

        // The same reply is the same author saying the same thing at the same moment: what a comment
        // pack carries back, however many times it is imported.
        string? Text(JsonText.JObject? o, string key) => o?.Find(key)?.Text;
        var author = Str(reply, "author");
        var at = Str(reply, "createdAt");
        var body = Str(reply, "body");
        if (thread.Array.Items.Any(r => Text(r.Object, "author") == author && Text(r.Object, "createdAt") == at && Text(r.Object, "body") == body))
            return bytes;
        return JsonText.AppendItem(bytes, layout, thread.Array, reply);
    }

    private static byte[] SetResolved(byte[] bytes, string id, bool resolved)
    {
        var (root, list) = Read(bytes);
        var comment = Existing(list, id);
        var layout = JsonText.Layout.Of(bytes, root);
        using var value = JsonDocument.Parse(resolved ? "true" : "false");
        var member = comment.Find("resolved");
        return member is null
            ? JsonText.AddMember(bytes, layout, comment, "resolved", value.RootElement)
            : JsonText.ReplaceValue(bytes, layout, member, value.RootElement);
    }

    private static byte[] Remove(byte[] bytes, string id)
    {
        var (_, list) = Read(bytes);
        if (list is null) return bytes;
        var index = list.Items.FindIndex(i => i.Object?.Find("id")?.Text == id);
        return index < 0 ? bytes : JsonText.RemoveItem(bytes, list, index);
    }

    // ---------------------------------------------------------------- reading

    /// <summary>The file's root, and its list of comments; <c>null</c> when it has none yet.</summary>
    private static (JsonText.JObject Root, JsonText.JArray? List) Read(byte[] bytes)
    {
        var root = JsonText.Parse(bytes, File);
        var comments = root.Find("comments");
        if (comments is null) return (root, null);
        return (root, comments.Array ?? throw JsonText.Unreadable(File, "has 'comments' that is not a list"));
    }

    private static JsonText.JObject? Find(JsonText.JArray list, string id) =>
        list.Items.FirstOrDefault(i => i.Object?.Find("id")?.Text == id)?.Object;

    /// <summary>The comment <paramref name="id"/>, which a reply or a resolve needs to be there.</summary>
    private static JsonText.JObject Existing(JsonText.JArray? list, string id) =>
        (list is null ? null : Find(list, id))
        ?? throw new SidecarPatchRefusedException("NoSuchComment", $"There is no comment '{id}'; someone may have removed it.");

    private static bool IsString(JsonElement o, string key) =>
        o.TryGetProperty(key, out var v) && v.ValueKind == JsonValueKind.String;

    private static bool NonEmpty(JsonElement o, string key) => IsString(o, key) && o.GetProperty(key).GetString()!.Length > 0;

    private static string? Str(JsonElement o, string key) =>
        o.TryGetProperty(key, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() : null;
}
