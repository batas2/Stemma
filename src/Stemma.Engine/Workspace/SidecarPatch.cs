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
/// and indent unit, raw or escaped characters as the file has them — and an object written on one
/// line keeps to its line.
/// </summary>
public static class SidecarPatch
{
    public static string Apply(string text, IEnumerable<SidecarChange> changes)
    {
        var bytes = Encoding.UTF8.GetBytes(text);
        Parse(bytes); // refuse an unreadable file before anything, even when there is nothing to change
        foreach (var change in changes)
        {
            if (change.Path.Count == 0) throw new SidecarPatchRefusedException("EmptyPath", "A change must name a key.");
            bytes = change.Value is { } value ? Set(bytes, change.Path, value) : Remove(bytes, change.Path);
        }
        return Encoding.UTF8.GetString(bytes);
    }

    // ---------------------------------------------------------------- the edits

    private static byte[] Set(byte[] bytes, IReadOnlyList<string> path, JsonElement value)
    {
        var obj = Parse(bytes);
        for (var i = 0; i < path.Count; i++)
        {
            var member = obj.Find(path[i]);
            if (member is null) return AddMember(bytes, obj, path[i], Nest(path, i + 1, value));
            if (i == path.Count - 1) return SetValue(bytes, path, member, value);
            obj = member.Object ?? throw new SidecarPatchRefusedException("NotAnObject",
                $"'{string.Join(".", path.Take(i + 1))}' is not an object, so it has no '{path[i + 1]}'.");
        }
        return bytes;
    }

    private static byte[] SetValue(byte[] bytes, IReadOnlyList<string> path, Member member, JsonElement value)
    {
        using var current = JsonDocument.Parse(bytes.AsMemory(member.ValueStart, member.ValueEnd - member.ValueStart));
        if (JsonElement.DeepEquals(current.RootElement, value)) return bytes;

        // An object onto an object: change what differs inside it, so the members that did not
        // change keep their text and their place.
        if (member.Object is not null && value.ValueKind == JsonValueKind.Object)
        {
            var existing = member.Object.Members.Select(m => m.Name).ToList();
            foreach (var property in value.EnumerateObject())
                bytes = Set(bytes, [.. path, property.Name], property.Value);
            foreach (var name in existing.Where(n => !value.TryGetProperty(n, out _)))
                bytes = Remove(bytes, [.. path, name]);
            return bytes;
        }

        var layout = Layout.Of(bytes);
        var rendered = Render(value, layout, IndentOf(bytes, member.NameStart));
        return Splice(bytes, member.ValueStart, member.ValueEnd, rendered);
    }

    private static byte[] Remove(byte[] bytes, IReadOnlyList<string> path)
    {
        var obj = Parse(bytes);
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
            if (members.Count == 1) return Splice(bytes, obj.Open + 1, obj.Close, ""); // `{}`
            // Not the last: it and what follows it up to the next name — its comma, its line.
            if (index < members.Count - 1) return Splice(bytes, members[index].NameStart, members[index + 1].NameStart, "");
            // The last: the comma before it, and it.
            return Splice(bytes, members[index - 1].ValueEnd, members[index].ValueEnd, "");
        }
        return bytes;
    }

    private static byte[] AddMember(byte[] bytes, JObject obj, string name, JsonElement value)
    {
        var layout = Layout.Of(bytes);
        var key = $"\"{JsonEncodedText.Encode(name, layout.Encoder)}\": ";
        if (obj.Members.Count > 0)
        {
            var last = obj.Members[^1];
            var indent = IndentOf(bytes, last.NameStart);
            // Written on one line: the new member goes on it too.
            if (indent is null) return Splice(bytes, last.ValueEnd, last.ValueEnd, $", {key}{Render(value, layout, null)}");
            return Splice(bytes, last.ValueEnd, last.ValueEnd, $",{layout.NewLine}{indent}{key}{Render(value, layout, indent)}");
        }

        // `{}`: open it onto lines, one level in from the line it is on.
        var outer = LineIndent(bytes, obj.Open);
        var inner = outer + layout.Unit;
        return Splice(bytes, obj.Open + 1, obj.Close, $"{layout.NewLine}{inner}{key}{Render(value, layout, inner)}{layout.NewLine}{outer}");
    }

    /// <summary>The rest of a path that does not exist yet, as the objects that will hold the value.</summary>
    private static JsonElement Nest(IReadOnlyList<string> path, int from, JsonElement value)
    {
        if (from >= path.Count) return value;
        using var stream = new MemoryStream();
        using (var writer = new Utf8JsonWriter(stream, new JsonWriterOptions { Encoder = JavaScriptEncoder.UnsafeRelaxedJsonEscaping }))
        {
            for (var i = from; i < path.Count; i++) { writer.WriteStartObject(); writer.WritePropertyName(path[i]); }
            Write(writer, value);
            for (var i = from; i < path.Count; i++) writer.WriteEndObject();
        }
        return JsonDocument.Parse(stream.ToArray()).RootElement.Clone();
    }

    // ---------------------------------------------------------------- text and layout

    /// <summary>
    /// A value as the file would have it. <paramref name="indent"/> is the indentation of the line the
    /// value starts on; <c>null</c> means a line holding several members, where the value stays compact.
    /// </summary>
    private static string Render(JsonElement value, Layout layout, string? indent)
    {
        var options = new JsonWriterOptions
        {
            Indented = indent is not null,
            Encoder = layout.Encoder,
            NewLine = layout.NewLine,
            IndentCharacter = layout.Unit.Length > 0 ? layout.Unit[0] : ' ',
            IndentSize = Math.Max(1, layout.Unit.Length),
        };
        using var stream = new MemoryStream();
        using (var writer = new Utf8JsonWriter(stream, options)) Write(writer, value);
        var text = Encoding.UTF8.GetString(stream.ToArray());
        return indent is null ? text : text.Replace(layout.NewLine, layout.NewLine + indent);
    }

    /// <summary>
    /// <c>JsonElement.WriteTo</c> copies a string's bytes as they arrived, past the writer's encoder,
    /// so an escaped file would gain raw characters. Strings and keys go through the encoder; numbers
    /// keep the spelling they were sent with.
    /// </summary>
    private static void Write(Utf8JsonWriter writer, JsonElement value)
    {
        switch (value.ValueKind)
        {
            case JsonValueKind.Object:
                writer.WriteStartObject();
                foreach (var property in value.EnumerateObject())
                {
                    writer.WritePropertyName(property.Name);
                    Write(writer, property.Value);
                }
                writer.WriteEndObject();
                break;
            case JsonValueKind.Array:
                writer.WriteStartArray();
                foreach (var item in value.EnumerateArray()) Write(writer, item);
                writer.WriteEndArray();
                break;
            case JsonValueKind.String:
                writer.WriteStringValue(value.GetString());
                break;
            default:
                writer.WriteRawValue(value.GetRawText(), skipInputValidation: true);
                break;
        }
    }

    private static byte[] Splice(byte[] bytes, int start, int end, string text)
    {
        var insert = Encoding.UTF8.GetBytes(text);
        var result = new byte[bytes.Length - (end - start) + insert.Length];
        bytes.AsSpan(0, start).CopyTo(result);
        insert.CopyTo(result.AsSpan(start));
        bytes.AsSpan(end).CopyTo(result.AsSpan(start + insert.Length));
        return result;
    }

    /// <summary>The whitespace before <paramref name="at"/> on its line, or <c>null</c> if something else precedes it.</summary>
    private static string? IndentOf(byte[] bytes, int at)
    {
        var start = at;
        while (start > 0 && bytes[start - 1] is (byte)' ' or (byte)'\t') start--;
        return start == 0 || bytes[start - 1] is (byte)'\n' or (byte)'\r'
            ? Encoding.UTF8.GetString(bytes, start, at - start)
            : null;
    }

    /// <summary>The leading whitespace of the line <paramref name="at"/> is on.</summary>
    private static string LineIndent(byte[] bytes, int at)
    {
        var lineStart = at;
        while (lineStart > 0 && bytes[lineStart - 1] is not ((byte)'\n' or (byte)'\r')) lineStart--;
        var end = lineStart;
        while (end < bytes.Length && bytes[end] is (byte)' ' or (byte)'\t') end++;
        return Encoding.UTF8.GetString(bytes, lineStart, end - lineStart);
    }

    private sealed record Layout(string NewLine, string Unit, JavaScriptEncoder Encoder)
    {
        public static Layout Of(byte[] bytes)
        {
            var newLine = bytes.AsSpan().IndexOf("\r\n"u8) >= 0 ? "\r\n" : "\n";
            // The indentation of the root's first member that starts a line; two spaces when none does.
            var root = Parse(bytes);
            var unit = root.Members.Select(m => IndentOf(bytes, m.NameStart)).FirstOrDefault(i => !string.IsNullOrEmpty(i)) ?? "  ";
            // A file that holds raw non-ASCII characters is written that way; one that escapes them
            // (which is how System.Text.Json writes by default) keeps escaping them.
            var raw = bytes.AsSpan().IndexOfAnyInRange((byte)0x80, (byte)0xFF) >= 0;
            return new Layout(newLine, unit, raw ? JavaScriptEncoder.UnsafeRelaxedJsonEscaping : JavaScriptEncoder.Default);
        }
    }

    // ---------------------------------------------------------------- reading spans

    private sealed class JObject(int open)
    {
        public int Open { get; } = open;
        public int Close { get; set; }
        public List<Member> Members { get; } = [];
        public Member? Find(string name) => Members.FirstOrDefault(m => m.Name == name);
    }

    /// <param name="NameStart">The opening quote of the key.</param>
    /// <param name="ValueEnd">Just past the value's last byte.</param>
    private sealed record Member(string Name, int NameStart, int ValueStart, int ValueEnd, JObject? Object);

    private static JObject Parse(byte[] bytes)
    {
        try
        {
            var reader = new Utf8JsonReader(bytes, new JsonReaderOptions { AllowTrailingCommas = false });
            if (!reader.Read() || reader.TokenType != JsonTokenType.StartObject)
                throw new SidecarPatchRefusedException("UnreadableSidecar", "stemma.layout.json does not hold a JSON object.");
            var root = ReadObject(ref reader);
            if (reader.Read())
                throw new SidecarPatchRefusedException("UnreadableSidecar", "stemma.layout.json has text after its object.");
            return root;
        }
        catch (JsonException e)
        {
            throw new SidecarPatchRefusedException("UnreadableSidecar", $"stemma.layout.json cannot be read: {e.Message}");
        }
    }

    private static JObject ReadObject(ref Utf8JsonReader reader)
    {
        var obj = new JObject((int)reader.TokenStartIndex);
        while (reader.Read())
        {
            if (reader.TokenType == JsonTokenType.EndObject)
            {
                obj.Close = (int)reader.TokenStartIndex;
                return obj;
            }
            var name = reader.GetString()!;
            var nameStart = (int)reader.TokenStartIndex;
            reader.Read();
            var valueStart = (int)reader.TokenStartIndex;
            JObject? child = null;
            if (reader.TokenType == JsonTokenType.StartObject) child = ReadObject(ref reader);
            else if (reader.TokenType == JsonTokenType.StartArray) reader.Skip();
            obj.Members.Add(new Member(name, nameStart, valueStart, (int)reader.BytesConsumed, child));
        }
        throw new SidecarPatchRefusedException("UnreadableSidecar", "stemma.layout.json ends inside an object.");
    }
}
