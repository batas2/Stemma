using System.Text;
using System.Text.Encodings.Web;
using System.Text.Json;

namespace Stemma.Engine.Workspace;

/// <summary>
/// What both sidecar editors share (ADR-0021): where each key, value and list item of a JSON file
/// sits in its bytes, and new text laid out like the text around it. Nothing here re-serializes a
/// file; every edit is a splice of the span that changed, so every other byte stays where it was.
/// </summary>
internal static class JsonText
{
    // ---------------------------------------------------------------- reading spans

    internal sealed class JObject(int open)
    {
        private readonly Dictionary<string, Member> _byName = new(StringComparer.Ordinal);
        public int Open { get; } = open;
        public int Close { get; set; }
        public List<Member> Members { get; } = [];
        public Member? Find(string name) => _byName.GetValueOrDefault(name);

        /// <summary>The member, or the one already there by its name.</summary>
        public Member? Add(Member member)
        {
            if (!_byName.TryAdd(member.Name, member)) return _byName[member.Name];
            Members.Add(member);
            return null;
        }
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

    /// <summary>How many objects and lists deep a sidecar is read: System.Text.Json's own default.</summary>
    internal const int MaxDepth = 64;

    /// <summary>The root object of <paramref name="bytes"/>, or a refusal naming <paramref name="file"/>.</summary>
    internal static JObject Parse(byte[] bytes, string file)
    {
        try
        {
            var reader = new Utf8JsonReader(bytes, new JsonReaderOptions { AllowTrailingCommas = false, MaxDepth = MaxDepth });
            if (!reader.Read() || reader.TokenType != JsonTokenType.StartObject)
                throw Unreadable(file, "does not hold a JSON object");
            var root = ReadObject(ref reader, new Source(bytes, file));
            if (reader.Read()) throw Unreadable(file, "has text after its object");
            return root;
        }
        catch (JsonException e)
        {
            throw Unreadable(file, Describe(bytes, e));
        }
    }

    /// <summary>
    /// What is wrong with the file, said for whoever opens it to fix it, with the line as an editor
    /// counts it. The parser's own words used to reach them — "not supported in this mode. Change the
    /// reader options." for a trailing comma — so the common cases are told apart by what is at the
    /// place it stopped, and anything else names the character there.
    /// </summary>
    private static string Describe(byte[] bytes, JsonException e)
    {
        if (ConflictMarker(bytes) is { } marker) return $"has merge conflict markers at line {marker}; resolve the conflict and save it";
        if (bytes.AsSpan().IndexOfAnyExcept(" \t\r\n"u8) < 0) return "is empty";
        if (e.LineNumber is not { } line || e.BytePositionInLine is not { } column) return "cannot be read";

        var lineStart = 0;
        for (var n = 0; n < line && lineStart >= 0; n++)
        {
            var next = bytes.AsSpan(lineStart).IndexOf((byte)'\n');
            lineStart = next < 0 ? -1 : lineStart + next + 1;
        }
        var at = lineStart < 0 ? bytes.Length : (int)Math.Min(bytes.Length, lineStart + column);
        var rest = bytes.AsSpan(at);
        var skipped = rest.IndexOfAnyExcept(" \t\r\n"u8);
        if (skipped < 0) return "ends before everything it opens is closed";
        at += skipped;
        if (bytes[at] == '/' && at + 1 < bytes.Length && bytes[at + 1] is (byte)'/' or (byte)'*')
            return $"has a comment at line {LineOf(bytes, at)}; JSON does not allow comments";
        if (bytes[at] is (byte)'}' or (byte)']')
        {
            var before = bytes.AsSpan(0, at).LastIndexOfAnyExcept(" \t\r\n"u8);
            if (before >= 0 && bytes[before] == ',')
                return $"has a comma after its last entry at line {LineOf(bytes, before)}; JSON does not allow one there";
        }
        var lineText = Encoding.UTF8.GetString(bytes, Math.Max(0, lineStart), at - Math.Max(0, lineStart));
        var found = Rune.DecodeFromUtf8(bytes.AsSpan(at), out var rune, out _) == System.Buffers.OperationStatus.Done ? rune.ToString() : "?";
        return $"has '{found}' at line {LineOf(bytes, at)}, column {lineText.Length + 1}, where JSON does not allow it";
    }

    /// <summary>The line of the first merge conflict marker in the file, if it has one.</summary>
    private static int? ConflictMarker(byte[] bytes)
    {
        var line = 1;
        for (var i = 0; i < bytes.Length; i++)
        {
            if (i == 0 || bytes[i - 1] == '\n')
            {
                var rest = bytes.AsSpan(i);
                if (rest.StartsWith("<<<<<<<"u8) || rest.StartsWith("======="u8) || rest.StartsWith(">>>>>>>"u8) || rest.StartsWith("|||||||"u8))
                    return line;
            }
            if (bytes[i] == '\n') line++;
        }
        return null;
    }

    private static int LineOf(byte[] bytes, int offset) => bytes.AsSpan(0, offset).Count((byte)'\n') + 1;

    internal static SidecarPatchRefusedException Unreadable(string file, string what) =>
        new("UnreadableSidecar", $"{file} {what}.");

    /// <summary>The text being read, for a refusal that names a line.</summary>
    private sealed record Source(byte[] Bytes, string File);

    private const string HalfACharacter = "half of a character, such as an emoji cut in two";

    /// <summary>
    /// The string at the reader, or a refusal with its line. Text holding half of a UTF-16 surrogate
    /// pair cannot be read as a string; it threw where every caller expects a refusal, so a read of the
    /// file answered 500 rather than saying what to fix.
    /// </summary>
    private static string ReadString(ref Utf8JsonReader reader, Source source)
    {
        try { return reader.GetString()!; }
        catch (InvalidOperationException)
        {
            throw Unreadable(source.File,
                $"has text that is not valid Unicode at line {LineOf(source.Bytes, (int)reader.TokenStartIndex)} ({HalfACharacter})");
        }
    }

    /// <summary>
    /// Refuse a change whose text is not valid Unicode, before anything is written. Writing it threw,
    /// which the endpoint answered with a 500, and the canvas, which sends a failed change again with
    /// the next, failed every save after it. As a refusal it is a bad change, said once.
    /// </summary>
    internal static void RefuseInvalidText(JsonElement value, string what)
    {
        try
        {
            switch (value.ValueKind)
            {
                case JsonValueKind.Object:
                    foreach (var property in value.EnumerateObject())
                    {
                        _ = property.Name;
                        RefuseInvalidText(property.Value, what);
                    }
                    break;
                case JsonValueKind.Array:
                    foreach (var item in value.EnumerateArray()) RefuseInvalidText(item, what);
                    break;
                case JsonValueKind.String:
                    _ = value.GetString();
                    break;
            }
        }
        catch (InvalidOperationException e) when (e is not SidecarPatchRefusedException)
        {
            throw InvalidText(what);
        }
    }

    /// <inheritdoc cref="RefuseInvalidText(JsonElement, string)"/>
    internal static void RefuseInvalidText(string text, string what)
    {
        for (var i = 0; i < text.Length; i++)
        {
            if (char.IsHighSurrogate(text[i]) && i + 1 < text.Length && char.IsLowSurrogate(text[i + 1])) i++;
            else if (char.IsSurrogate(text[i])) throw InvalidText(what);
        }
    }

    private static SidecarPatchRefusedException InvalidText(string what) =>
        new("InvalidText", $"{what} holds text that is not valid Unicode ({HalfACharacter}), so it was not saved.");

    private static JObject ReadObject(ref Utf8JsonReader reader, Source source)
    {
        var obj = new JObject((int)reader.TokenStartIndex);
        while (reader.Read())
        {
            if (reader.TokenType == JsonTokenType.EndObject)
            {
                obj.Close = (int)reader.TokenStartIndex;
                return obj;
            }
            var name = ReadString(ref reader, source);
            var nameStart = (int)reader.TokenStartIndex;
            reader.Read();
            var valueStart = (int)reader.TokenStartIndex;
            var (child, array, text) = ReadValue(ref reader, source);
            // Two values for one key: an edit would change the first, JSON.parse in the browser keeps
            // the last, and the edit would look lost. Which one is meant is the author's to say.
            if (obj.Add(new Member(name, nameStart, valueStart, (int)reader.BytesConsumed, child, array, text)) is { } first)
                throw Unreadable(source.File,
                    $"has the key \"{name}\" twice in one object, at lines {LineOf(source.Bytes, first.NameStart)} and {LineOf(source.Bytes, nameStart)}; " +
                    "keep the one that is meant and remove the other");
        }
        throw Unreadable(source.File, "ends inside an object");
    }

    private static JArray ReadArray(ref Utf8JsonReader reader, Source source)
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
            var (child, nested, _) = ReadValue(ref reader, source);
            array.Items.Add(new Item(start, (int)reader.BytesConsumed, child, nested));
        }
        throw Unreadable(source.File, "ends inside a list");
    }

    private static (JObject?, JArray?, string?) ReadValue(ref Utf8JsonReader reader, Source source) => reader.TokenType switch
    {
        JsonTokenType.StartObject => (ReadObject(ref reader, source), null, null),
        JsonTokenType.StartArray => (null, ReadArray(ref reader, source), null),
        JsonTokenType.String => (null, null, ReadString(ref reader, source)),
        _ => (null, null, null),
    };

    // ---------------------------------------------------------------- the edits

    /// <summary><paramref name="name"/> as the last member of <paramref name="obj"/>, laid out like the members before it.</summary>
    internal static byte[] AddMember(byte[] bytes, Layout layout, JObject obj, string name, JsonElement value)
    {
        var key = Key(name, layout);
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
    internal static bool WrittenOnOneLine(byte[] bytes, Member member) =>
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
    internal static string Render(JsonElement value, Layout layout, string? indent) =>
        Render(writer => Write(writer, value), layout, indent);

    /// <inheritdoc cref="Render(JsonElement, Layout, string?)"/>
    internal static string Render(Action<Utf8JsonWriter> write, Layout layout, string? indent)
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
        using (var writer = new Utf8JsonWriter(stream, options)) write(writer);
        var text = layout.Raw(Encoding.UTF8.GetString(stream.ToArray()));
        return indent is null ? text : text.Replace(layout.NewLine, layout.NewLine + indent);
    }

    /// <summary>A key as the file writes it, with what follows it before the value.</summary>
    internal static string Key(string name, Layout layout) => $"\"{layout.Raw(JsonEncodedText.Encode(name, layout.Encoder).ToString())}\": ";

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
    internal static string LineIndent(byte[] bytes, int at)
    {
        var lineStart = at;
        while (lineStart > 0 && bytes[lineStart - 1] is not ((byte)'\n' or (byte)'\r')) lineStart--;
        var end = lineStart;
        while (end < bytes.Length && bytes[end] is (byte)' ' or (byte)'\t') end++;
        return Encoding.UTF8.GetString(bytes, lineStart, end - lineStart);
    }

    internal sealed record Layout(string NewLine, string Unit, JavaScriptEncoder Encoder)
    {
        private bool Escaping => Encoder == JavaScriptEncoder.Default;

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

        /// <summary>
        /// Whether a string in the file spells a character as a four-digit escape when it did not have
        /// to. A control character must be escaped, and System.Text.Json escapes an emoji (a surrogate
        /// pair) whatever it is told, so neither says how the file is written: counted, one emoji in
        /// an all-ASCII file made it an escaping file, and every Polish letter, apostrophe, &lt;, &amp;
        /// and + after it was escaped.
        /// </summary>
        private static bool HasEscapedCharacter(byte[] bytes)
        {
            for (var i = 0; i < bytes.Length - 1; i++)
            {
                if (bytes[i] != (byte)'\\') continue;
                if (bytes[i + 1] == (byte)'u' && Hex(bytes.AsSpan(i + 2)) is { } c && c >= 0x20 && !char.IsSurrogate((char)c)) return true;
                i++; // an escaped backslash or quote is not the start of another escape
            }
            return false;
        }

        private static int? Hex(ReadOnlySpan<byte> digits) =>
            digits.Length >= 4 && int.TryParse(Encoding.ASCII.GetString(digits[..4]), System.Globalization.NumberStyles.AllowHexSpecifier, null, out var c)
                ? c
                : null;

        /// <summary>
        /// New text for a file that holds its characters raw: every four-digit escape the writer made
        /// that JSON does not require, spelled as the character — an emoji included, which the writer
        /// escapes even when told not to. A control character, a quote and a backslash stay escaped,
        /// and so does half of a surrogate pair, which has no character to be.
        /// </summary>
        public string Raw(string text)
        {
            if (Escaping || !text.Contains("\\u", StringComparison.Ordinal)) return text;
            var sb = new StringBuilder(text.Length);
            for (var i = 0; i < text.Length; i++)
            {
                if (text[i] != '\\' || i + 1 >= text.Length)
                {
                    sb.Append(text[i]);
                    continue;
                }
                if (text[i + 1] != 'u' || Hex16(text, i + 2) is not { } c)
                {
                    sb.Append(text, i, 2); // \" \\ \n and the like, whole
                    i++;
                    continue;
                }
                if (char.IsHighSurrogate(c) && i + 12 <= text.Length && text[i + 6] == '\\' && text[i + 7] == 'u'
                    && Hex16(text, i + 8) is { } low && char.IsLowSurrogate(low))
                {
                    sb.Append(c).Append(low);
                    i += 11;
                }
                else if (c >= 0x20 && c != '"' && c != '\\' && !char.IsSurrogate(c))
                {
                    sb.Append(c);
                    i += 5;
                }
                else
                {
                    sb.Append(text, i, 6);
                    i += 5;
                }
            }
            return sb.ToString();
        }

        private static char? Hex16(string text, int at) =>
            at + 4 <= text.Length && ushort.TryParse(text.AsSpan(at, 4), System.Globalization.NumberStyles.AllowHexSpecifier, null, out var c)
                ? (char)c
                : null;
    }
}
