using System.Text;
using System.Text.Encodings.Web;
using System.Text.Json;
using System.Text.RegularExpressions;

namespace Stemma.Engine.Workspace;

/// <summary>
/// What both sidecar editors share (ADR-0021): where each key, value and list item of a JSON file
/// sits in its bytes, and new text laid out like the text around it. Nothing here re-serializes a
/// file; every edit is a splice of the span that changed, so every other byte stays where it was.
/// </summary>
internal static partial class JsonText
{
    // ---------------------------------------------------------------- reading spans

    internal sealed class JObject(int open)
    {
        public int Open { get; } = open;
        public int Close { get; set; }
        public List<Member> Members { get; } = [];
        public Member? Find(string name) => Members.FirstOrDefault(m => m.Name == name);
    }

    internal sealed class JArray(int open)
    {
        public int Open { get; } = open;
        public int Close { get; set; }
        public List<Item> Items { get; } = [];
    }

    /// <param name="NameStart">The opening quote of the key.</param>
    /// <param name="ValueEnd">Just past the value's last byte.</param>
    /// <param name="Text">The value, when it is a string.</param>
    internal sealed record Member(string Name, int NameStart, int ValueStart, int ValueEnd, JObject? Object, JArray? Array, string? Text);

    /// <param name="End">Just past the item's last byte.</param>
    internal sealed record Item(int Start, int End, JObject? Object, JArray? Array);

    /// <summary>The root object of <paramref name="bytes"/>, or a refusal naming <paramref name="file"/>.</summary>
    internal static JObject Parse(byte[] bytes, string file)
    {
        try
        {
            var reader = new Utf8JsonReader(bytes, new JsonReaderOptions { AllowTrailingCommas = false });
            if (!reader.Read() || reader.TokenType != JsonTokenType.StartObject)
                throw Unreadable(file, "does not hold a JSON object");
            var root = ReadObject(ref reader, file);
            if (reader.Read()) throw Unreadable(file, "has text after its object");
            return root;
        }
        catch (JsonException e)
        {
            // Said for whoever opens the file to fix it: the line as an editor counts it, and the
            // parser's reason without its own position suffix.
            var reason = PositionSuffix().Replace(e.Message, "").TrimEnd('.');
            var at = e.LineNumber is { } line ? $" at line {line + 1}" : "";
            throw Unreadable(file, $"cannot be read{at}: {reason}");
        }
    }

    [GeneratedRegex(@"\s*(Path: \S*\s*\|\s*)?LineNumber: \d+ \| BytePositionInLine: \d+\.?$")]
    private static partial Regex PositionSuffix();

    internal static SidecarPatchRefusedException Unreadable(string file, string what) =>
        new("UnreadableSidecar", $"{file} {what}.");

    private static JObject ReadObject(ref Utf8JsonReader reader, string file)
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
            var (child, array, text) = ReadValue(ref reader, file);
            obj.Members.Add(new Member(name, nameStart, valueStart, (int)reader.BytesConsumed, child, array, text));
        }
        throw Unreadable(file, "ends inside an object");
    }

    private static JArray ReadArray(ref Utf8JsonReader reader, string file)
    {
        var array = new JArray((int)reader.TokenStartIndex);
        while (reader.Read())
        {
            if (reader.TokenType == JsonTokenType.EndArray)
            {
                array.Close = (int)reader.TokenStartIndex;
                return array;
            }
            var start = (int)reader.TokenStartIndex;
            var (child, nested, _) = ReadValue(ref reader, file);
            array.Items.Add(new Item(start, (int)reader.BytesConsumed, child, nested));
        }
        throw Unreadable(file, "ends inside a list");
    }

    private static (JObject?, JArray?, string?) ReadValue(ref Utf8JsonReader reader, string file) => reader.TokenType switch
    {
        JsonTokenType.StartObject => (ReadObject(ref reader, file), null, null),
        JsonTokenType.StartArray => (null, ReadArray(ref reader, file), null),
        JsonTokenType.String => (null, null, reader.GetString()),
        _ => (null, null, null),
    };

    // ---------------------------------------------------------------- the edits

    /// <summary><paramref name="name"/> as the last member of <paramref name="obj"/>, laid out like the members before it.</summary>
    internal static byte[] AddMember(byte[] bytes, Layout layout, JObject obj, string name, JsonElement value)
    {
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

    /// <summary><paramref name="value"/> as the last item of <paramref name="array"/>, laid out like the items before it.</summary>
    internal static byte[] AppendItem(byte[] bytes, Layout layout, JArray array, JsonElement value)
    {
        if (array.Items.Count > 0)
        {
            var last = array.Items[^1];
            var indent = IndentOf(bytes, last.Start);
            // A list written on one line stays on it.
            if (indent is null) return Splice(bytes, last.End, last.End, $", {Render(value, layout, null)}");
            return Splice(bytes, last.End, last.End, $",{layout.NewLine}{indent}{Render(value, layout, indent)}");
        }

        // `[]`: open it onto lines, one level in from the line it is on.
        var outer = LineIndent(bytes, array.Open);
        var inner = outer + layout.Unit;
        return Splice(bytes, array.Open + 1, array.Close, $"{layout.NewLine}{inner}{Render(value, layout, inner)}{layout.NewLine}{outer}");
    }

    /// <summary>The item at <paramref name="index"/>, with its line and one comma.</summary>
    internal static byte[] RemoveItem(byte[] bytes, JArray array, int index)
    {
        var items = array.Items;
        if (items.Count == 1) return Splice(bytes, array.Open + 1, array.Close, ""); // `[]`
        // Not the last: it and what follows it up to the next item — its comma, its line.
        if (index < items.Count - 1) return Splice(bytes, items[index].Start, items[index + 1].Start, "");
        // The last: the comma before it, and it.
        return Splice(bytes, items[index - 1].End, items[index].End, "");
    }

    /// <summary>The value of <paramref name="member"/> replaced, unless it already is <paramref name="value"/>.</summary>
    internal static byte[] ReplaceValue(byte[] bytes, Layout layout, Member member, JsonElement value)
    {
        using var current = JsonDocument.Parse(bytes.AsMemory(member.ValueStart, member.ValueEnd - member.ValueStart));
        if (JsonElement.DeepEquals(current.RootElement, value)) return bytes;
        // A list or object the file wrote on one line, like `"order": ["a","b"]`, stays on that line:
        // a reorder is a one-line diff, not the list spread over several.
        var indent = WrittenOnOneLine(bytes, member) ? null : IndentOf(bytes, member.NameStart);
        return Splice(bytes, member.ValueStart, member.ValueEnd, Render(value, layout, indent));
    }

    /// <summary>
    /// Whether the value of <paramref name="member"/> is a list or object with something in it, written
    /// on one line. An empty one says nothing about how its contents are laid out, so it does not count.
    /// </summary>
    private static bool WrittenOnOneLine(byte[] bytes, Member member) =>
        (member.Array is { Items.Count: > 0 } || member.Object is { Members.Count: > 0 })
        && bytes.AsSpan(member.ValueStart, member.ValueEnd - member.ValueStart).IndexOfAny((byte)'\n', (byte)'\r') < 0;

    /// <summary>A list holding <paramref name="value"/>, for a member that does not exist yet.</summary>
    internal static JsonElement ListOf(JsonElement value)
    {
        using var stream = new MemoryStream();
        using (var writer = new Utf8JsonWriter(stream, new JsonWriterOptions { Encoder = JavaScriptEncoder.UnsafeRelaxedJsonEscaping }))
        {
            writer.WriteStartArray();
            Write(writer, value);
            writer.WriteEndArray();
        }
        return JsonDocument.Parse(stream.ToArray()).RootElement.Clone();
    }

    // ---------------------------------------------------------------- text and layout

    /// <summary>
    /// A value as the file would have it. <paramref name="indent"/> is the indentation of the line the
    /// value starts on; <c>null</c> means a line holding several values, where the value stays compact.
    /// </summary>
    internal static string Render(JsonElement value, Layout layout, string? indent)
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
    internal static void Write(Utf8JsonWriter writer, JsonElement value)
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

    internal static byte[] Splice(byte[] bytes, int start, int end, string text)
    {
        var insert = Encoding.UTF8.GetBytes(text);
        var result = new byte[bytes.Length - (end - start) + insert.Length];
        bytes.AsSpan(0, start).CopyTo(result);
        insert.CopyTo(result.AsSpan(start));
        bytes.AsSpan(end).CopyTo(result.AsSpan(start + insert.Length));
        return result;
    }

    /// <summary>The whitespace before <paramref name="at"/> on its line, or <c>null</c> if something else precedes it.</summary>
    internal static string? IndentOf(byte[] bytes, int at)
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

    internal sealed record Layout(string NewLine, string Unit, JavaScriptEncoder Encoder)
    {
        public static Layout Of(byte[] bytes, JObject root)
        {
            var newLine = bytes.AsSpan().IndexOf("\r\n"u8) >= 0 ? "\r\n" : "\n";
            // The indentation of the root's first member that starts a line; two spaces when none does.
            var unit = root.Members.Select(m => IndentOf(bytes, m.NameStart)).FirstOrDefault(i => !string.IsNullOrEmpty(i)) ?? "  ";
            // A file that escapes characters, as System.Text.Json writes by default, keeps escaping
            // them. One that holds them raw, or has never had one, gets them raw: it is read by
            // people, in diffs, and nothing in it says otherwise.
            var raw = bytes.AsSpan().IndexOfAnyInRange((byte)0x80, (byte)0xFF) >= 0;
            var escaping = !raw && HasEscapedCharacter(bytes);
            return new Layout(newLine, unit, escaping ? JavaScriptEncoder.Default : JavaScriptEncoder.UnsafeRelaxedJsonEscaping);
        }

        /// <summary>Whether a string in the file spells a character as a four-digit escape.</summary>
        private static bool HasEscapedCharacter(byte[] bytes)
        {
            for (var i = 0; i < bytes.Length - 1; i++)
            {
                if (bytes[i] != (byte)'\\') continue;
                if (bytes[i + 1] == (byte)'u') return true;
                i++; // an escaped backslash or quote is not the start of another escape
            }
            return false;
        }
    }
}
