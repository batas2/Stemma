using System.Text;
using System.Text.Encodings.Web;
using System.Text.Json;

namespace Stemma.Engine.Workspace;

/// <summary>
/// One change to the sidecar: the value at <paramref name="Path"/> — a chain of keys from the root —
/// becomes <paramref name="Value"/>, or is removed when it is <c>null</c>.
/// </summary>
public sealed record SidecarChange(IReadOnlyList<string> Path, JsonElement? Value);

/// <summary>A change the sidecar cannot take; <see cref="Reason"/> is the code the caller reports.</summary>
public sealed class SidecarPatchRefusedException(string reason, string message) : InvalidOperationException(message)
{
    public string Reason { get; } = reason;
}

/// <summary>
/// Edits <c>stemma.layout.json</c> the way an operation edits <c>Architecture.cs</c>: the span of the
/// value that changed is replaced, inserted or removed in the text, and every other byte stays
/// where it was — key order, keys Stemma does not know, escaping, the spelling of numbers, arrays
/// written on one line, line endings, the final newline (ADR-0021).
///
/// Re-serializing the file to change part of it rewrote all of it: a box dragged into one view was a
/// hundred-line diff, and whatever anyone else had changed since the canvas read the file went with
/// it (B-014). New text is laid out like its neighbours — their indentation, the file's line ending
/// and indent unit, raw or escaped characters as the file has them — and an object or a list written
/// on one line keeps to its line.
/// </summary>
public static class SidecarPatch
{
    private const string File = "stemma.layout.json";

    public static string Apply(string text, IEnumerable<SidecarChange> changes)
    {
        var bytes = Encoding.UTF8.GetBytes(text);
        JsonText.Parse(bytes, File); // refuse an unreadable file before anything, even when there is nothing to change
        var list = changes.ToList();
        foreach (var change in list)
        {
            foreach (var key in change.Path) JsonText.RefuseInvalidText(key, "A change");
            if (change.Value is { } value) JsonText.RefuseInvalidText(value, "A change");
        }
        foreach (var change in list)
        {
            if (change.Path.Count == 0) throw new SidecarPatchRefusedException("EmptyPath", "A change must name a key.");
            bytes = change.Value is { } value ? Set(bytes, change.Path, value) : Remove(bytes, change.Path);
        }
        return Encoding.UTF8.GetString(bytes);
    }

    // ---------------------------------------------------------------- the edits

    private static byte[] Set(byte[] bytes, IReadOnlyList<string> path, JsonElement value)
    {
        var root = JsonText.Parse(bytes, File);
        var layout = JsonText.Layout.Of(bytes, root);
        var obj = root;
        for (var i = 0; i < path.Count; i++)
        {
            var member = obj.Find(path[i]);
            if (member is null) return JsonText.AddMember(bytes, layout, obj, path[i], Nest(path, i + 1, value));
            if (i == path.Count - 1) return SetValue(bytes, layout, path, member, value);
            obj = member.Object ?? throw new SidecarPatchRefusedException("NotAnObject",
                $"'{string.Join(".", path.Take(i + 1))}' is not an object, so it has no '{path[i + 1]}'.");
        }
        return bytes;
    }

    private static byte[] SetValue(byte[] bytes, JsonText.Layout layout, IReadOnlyList<string> path, JsonText.Member member, JsonElement value)
    {
        // An object onto an object: change what differs inside it, so the members that did not
        // change keep their text and their place.
        if (member.Object is not null && value.ValueKind == JsonValueKind.Object)
        {
            using var current = JsonDocument.Parse(bytes.AsMemory(member.ValueStart, member.ValueEnd - member.ValueStart));
            if (JsonElement.DeepEquals(current.RootElement, value)) return bytes;
            var existing = member.Object.Members.Select(m => m.Name).ToList();
            foreach (var property in value.EnumerateObject())
                bytes = Set(bytes, [.. path, property.Name], property.Value);
            foreach (var name in existing.Where(n => !value.TryGetProperty(n, out _)))
                bytes = Remove(bytes, [.. path, name]);
            return bytes;
        }

        return JsonText.ReplaceValue(bytes, layout, member, value);
    }

    private static byte[] Remove(byte[] bytes, IReadOnlyList<string> path)
    {
        var obj = JsonText.Parse(bytes, File);
        for (var i = 0; i < path.Count; i++)
        {
            var index = obj.Members.FindIndex(m => m.Name == path[i]);
            if (index < 0) return bytes;
            if (i < path.Count - 1)
            {
                obj = obj.Members[index].Object;
                if (obj is null) return bytes;
                continue;
            }

            var members = obj.Members;
            if (members.Count == 1) return JsonText.Splice(bytes, obj.Open + 1, obj.Close, ""); // `{}`
            // Not the last: it and what follows it up to the next name — its comma, its line.
            if (index < members.Count - 1) return JsonText.Splice(bytes, members[index].NameStart, members[index + 1].NameStart, "");
            // The last: the comma before it, and it.
            return JsonText.Splice(bytes, members[index - 1].ValueEnd, members[index].ValueEnd, "");
        }
        return bytes;
    }

    /// <summary>The rest of a path that does not exist yet, as the objects that will hold the value.</summary>
    private static JsonElement Nest(IReadOnlyList<string> path, int from, JsonElement value)
    {
        if (from >= path.Count) return value;
        using var stream = new MemoryStream();
        using (var writer = new Utf8JsonWriter(stream, new JsonWriterOptions { Encoder = JavaScriptEncoder.UnsafeRelaxedJsonEscaping }))
        {
            for (var i = from; i < path.Count; i++) { writer.WriteStartObject(); writer.WritePropertyName(path[i]); }
            JsonText.Write(writer, value);
            for (var i = from; i < path.Count; i++) writer.WriteEndObject();
        }
        return JsonDocument.Parse(stream.ToArray()).RootElement.Clone();
    }
}
