using System.Text;
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
///
/// A batch of changes is applied in order to one reading of the file, and written in one pass: the
/// layout is the file's as it was read, and what a batch writes is what its changes would write one
/// at a time.
/// </summary>
public static class SidecarPatch
{
    private const string File = "stemma.layout.json";

    public static string Apply(string text, IEnumerable<SidecarChange> changes)
    {
        var bytes = Encoding.UTF8.GetBytes(text);
        var root = JsonText.Parse(bytes, File); // refuse an unreadable file before anything, even when there is nothing to change
        var list = changes.ToList();
        foreach (var change in list)
        {
            foreach (var key in change.Path) JsonText.RefuseInvalidText(key, "A change");
            if (change.Value is { } value) JsonText.RefuseInvalidText(value, "A change");
        }
        if (list.Count == 0) return text;

        // The file is read once, and every change is made to that reading: an object in the file holds
        // the edits made inside it, and the new text is written in one pass at the end. Each change
        // used to parse the whole file again, scan it for its layout and copy it, which made a batch
        // quadratic in the file's size — a thousand changes to 1.5 MB held the file's lock for 13 s.
        var edit = new Edit(bytes, JsonText.Layout.Of(bytes, root), new Existing(root));
        foreach (var change in list)
        {
            if (change.Path.Count == 0) throw new SidecarPatchRefusedException("EmptyPath", "A change must name a key.");
            // The file is read to so many levels and no deeper; a value nested past that would be a file
            // that cannot be read again. It threw where it was nested, which answered 500.
            if (change.Value is { } deep && change.Path.Count + Depth(deep) > JsonText.MaxDepth)
                throw new SidecarPatchRefusedException("TooDeep",
                    $"A change nests {change.Path.Count + Depth(deep)} levels deep, and the layout file holds {JsonText.MaxDepth} at most, so it was not saved.");
            if (change.Value is { } value) edit.Set(edit.Root, change.Path, 0, value);
            else edit.Remove(edit.Root, change.Path, 0);
        }
        return edit.Write();
    }

    private static int Depth(JsonElement value) => value.ValueKind switch
    {
        JsonValueKind.Object => 1 + value.EnumerateObject().Select(p => Depth(p.Value)).DefaultIfEmpty(0).Max(),
        JsonValueKind.Array => 1 + value.EnumerateArray().Select(Depth).DefaultIfEmpty(0).Max(),
        _ => 0,
    };

    // ---------------------------------------------------------------- what a batch does to the file

    /// <summary>A value written by this batch: one that came with a change, or an object built up by several.</summary>
    private abstract class Node;

    private sealed class Leaf(JsonElement value) : Node
    {
        public JsonElement Value { get; } = value;
    }

    /// <summary>An object this batch is writing, its members in the order they will be written.</summary>
    private sealed class Built : Node
    {
        public List<(string Name, Node Value)> Members { get; } = [];

        /// <summary>
        /// Made only to hold a path that did not exist: it goes again when the last thing it held is
        /// removed in the same batch, so adding a key and removing it leaves the file as it was.
        /// </summary>
        public bool Holder { get; set; }
        public int IndexOf(string name) => Members.FindIndex(m => m.Name == name);

        public static Built From(JsonElement obj)
        {
            var built = new Built();
            foreach (var property in obj.EnumerateObject()) built.Members.Add((property.Name, new Leaf(property.Value)));
            return built;
        }
    }

    /// <summary>
    /// An object that is in the file, and what the batch does to it: members removed, values replaced,
    /// edits inside members that are objects themselves, and new members after the last.
    /// </summary>
    private sealed class Existing(JsonText.JObject source)
    {
        public JsonText.JObject Source { get; } = source;
        public HashSet<JsonText.Member> Removed { get; } = new(ReferenceEqualityComparer.Instance);
        public Dictionary<JsonText.Member, Node> Replaced { get; } = new(ReferenceEqualityComparer.Instance);
        public Dictionary<JsonText.Member, Existing> Inner { get; } = new(ReferenceEqualityComparer.Instance);
        public List<(string Name, Node Value)> Added { get; } = [];

        /// <summary>The member by that name, unless the batch has removed it.</summary>
        public JsonText.Member? Find(string name) => Source.Find(name) is { } m && !Removed.Contains(m) ? m : null;

        public Existing InnerOf(JsonText.Member member)
        {
            if (!Inner.TryGetValue(member, out var inner)) Inner[member] = inner = new Existing(member.Object!);
            return inner;
        }

        /// <summary>The names it will have, in order.</summary>
        public IEnumerable<string> Names() =>
            Source.Members.Where(m => !Removed.Contains(m)).Select(m => m.Name).Concat(Added.Select(a => a.Name));
    }

    private sealed class Edit(byte[] bytes, JsonText.Layout layout, Existing root)
    {
        public Existing Root { get; } = root;

        // ---- setting

        public void Set(Existing obj, IReadOnlyList<string> path, int i, JsonElement value)
        {
            var name = path[i];
            var last = i == path.Count - 1;
            if (obj.Find(name) is { } member)
            {
                if (last) SetMember(obj, member, path, value);
                else if (obj.Replaced.TryGetValue(member, out var replaced)) obj.Replaced[member] = SetIn(replaced, path, i + 1, value);
                else if (member.Object is not null) Set(obj.InnerOf(member), path, i + 1, value);
                // A null on the way, as a hand edit leaves `"views": null`, is nothing there yet.
                else if (IsNull(member)) obj.Replaced[member] = Nest(path, i + 1, value);
                else throw NotAnObject(path, i);
                return;
            }
            var added = obj.Added.FindIndex(a => a.Name == name);
            if (added < 0) obj.Added.Add((name, Nest(path, i + 1, value)));
            else obj.Added[added] = (name, last ? Assign(obj.Added[added].Value, value) : SetIn(obj.Added[added].Value, path, i + 1, value));
        }

        /// <summary>
        /// A member of the file set to <paramref name="value"/>. An object onto an object changes what
        /// differs inside it, so the members that did not change keep their text and their place; a
        /// value set to what the file already says is no edit at all.
        /// </summary>
        private void SetMember(Existing obj, JsonText.Member member, IReadOnlyList<string> path, JsonElement value)
        {
            if (obj.Replaced.TryGetValue(member, out var replaced))
            {
                obj.Replaced[member] = Assign(replaced, value);
                if (obj.Replaced[member] is Leaf leaf && Says(member, leaf.Value)) obj.Replaced.Remove(member);
                return;
            }
            if (member.Object is not null && value.ValueKind == JsonValueKind.Object)
            {
                var inner = obj.InnerOf(member);
                foreach (var property in value.EnumerateObject()) Set(inner, [.. path, property.Name], path.Count, property.Value);
                foreach (var gone in inner.Names().Where(n => !value.TryGetProperty(n, out _)).ToList()) Remove(inner, [.. path, gone], path.Count);
                return;
            }
            obj.Inner.Remove(member);
            if (!Says(member, value)) obj.Replaced[member] = new Leaf(value);
        }

        private bool IsNull(JsonText.Member member) => member.Object is null && member.Array is null && bytes[member.ValueStart] == 'n';

        private bool Says(JsonText.Member member, JsonElement value)
        {
            using var current = JsonDocument.Parse(bytes.AsMemory(member.ValueStart, member.ValueEnd - member.ValueStart));
            return JsonElement.DeepEquals(current.RootElement, value);
        }

        /// <summary><paramref name="node"/> with the value at <paramref name="path"/>[<paramref name="i"/>..] set.</summary>
        private static Node SetIn(Node node, IReadOnlyList<string> path, int i, JsonElement value)
        {
            var built = AsBuilt(node)
                ?? (node is Leaf { Value.ValueKind: JsonValueKind.Null } ? new Built { Holder = true } : throw NotAnObject(path, i - 1));
            var at = built.IndexOf(path[i]);
            if (at < 0) built.Members.Add((path[i], Nest(path, i + 1, value)));
            else if (i == path.Count - 1) built.Members[at] = (path[i], Assign(built.Members[at].Value, value));
            else built.Members[at] = (path[i], SetIn(built.Members[at].Value, path, i + 1, value));
            return built;
        }

        /// <summary>A value this batch writes, set again: an object onto an object merges, as it does in the file.</summary>
        private static Node Assign(Node current, JsonElement value)
        {
            if (value.ValueKind != JsonValueKind.Object || AsBuilt(current) is not { } built) return new Leaf(value);
            built.Holder = false; // set on purpose now, so it stays when emptied
            foreach (var property in value.EnumerateObject())
            {
                var at = built.IndexOf(property.Name);
                if (at < 0) built.Members.Add((property.Name, new Leaf(property.Value)));
                else built.Members[at] = (property.Name, Assign(built.Members[at].Value, property.Value));
            }
            built.Members.RemoveAll(m => !value.TryGetProperty(m.Name, out _));
            return built;
        }

        private static Built? AsBuilt(Node node) => node switch
        {
            Built built => built,
            Leaf { Value.ValueKind: JsonValueKind.Object } leaf => Built.From(leaf.Value),
            _ => null,
        };

        /// <summary>The rest of a path that does not exist yet, as the objects that will hold the value.</summary>
        private static Node Nest(IReadOnlyList<string> path, int from, JsonElement value)
        {
            if (from >= path.Count) return new Leaf(value);
            var holder = new Built { Holder = true };
            holder.Members.Add((path[from], Nest(path, from + 1, value)));
            return holder;
        }

        private static SidecarPatchRefusedException NotAnObject(IReadOnlyList<string> path, int i) =>
            new("NotAnObject", $"'{string.Join(".", path.Take(i + 1))}' is not an object, so it has no '{path[i + 1]}'.");

        // ---- removing

        public void Remove(Existing obj, IReadOnlyList<string> path, int i)
        {
            var name = path[i];
            var last = i == path.Count - 1;
            if (obj.Find(name) is { } member)
            {
                if (last)
                {
                    obj.Removed.Add(member);
                    obj.Replaced.Remove(member);
                    obj.Inner.Remove(member);
                }
                else if (obj.Replaced.TryGetValue(member, out var replaced))
                {
                    // Emptied of what it was made to hold: what the file had there comes back.
                    if (RemoveIn(replaced, path, i + 1) is { } kept) obj.Replaced[member] = kept;
                    else obj.Replaced.Remove(member);
                }
                else if (member.Object is not null) Remove(obj.InnerOf(member), path, i + 1);
                return;
            }
            var added = obj.Added.FindIndex(a => a.Name == name);
            if (added < 0) return;
            if (!last && RemoveIn(obj.Added[added].Value, path, i + 1) is { } left) obj.Added[added] = (name, left);
            else obj.Added.RemoveAt(added);
        }

        /// <summary><paramref name="node"/> without the value at the path, or null when nothing it was made to hold is left.</summary>
        private static Node? RemoveIn(Node node, IReadOnlyList<string> path, int i)
        {
            if (AsBuilt(node) is not { } built) return node;
            var at = built.IndexOf(path[i]);
            if (at < 0) return node;
            if (i < path.Count - 1 && RemoveIn(built.Members[at].Value, path, i + 1) is { } kept) built.Members[at] = (path[i], kept);
            else built.Members.RemoveAt(at);
            return built.Holder && built.Members.Count == 0 ? null : built;
        }

        // ---- writing

        /// <summary>The file with every edit made: the spans that changed, in order, and every other byte as it was.</summary>
        public string Write()
        {
            var splices = new List<(int Start, int End, string Text)>();
            Collect(Root, splices);
            splices.Sort((a, b) => a.Start.CompareTo(b.Start));
            var output = new MemoryStream(bytes.Length + splices.Sum(s => s.Text.Length));
            var at = 0;
            foreach (var (start, end, text) in splices)
            {
                output.Write(bytes, at, start - at);
                output.Write(Encoding.UTF8.GetBytes(text));
                at = end;
            }
            output.Write(bytes, at, bytes.Length - at);
            return Encoding.UTF8.GetString(output.GetBuffer(), 0, (int)output.Length);
        }

        /// <summary>
        /// What changes in <paramref name="obj"/>'s text. A replaced value keeps its place and, written
        /// on one line, its line. A removed member takes its lines and one comma — up to the next
        /// member that stays, or after the last that stays — and the last one out leaves <c>{}</c>. New
        /// members go after the last that stays, laid out like it; in an object left with none, they
        /// open it onto lines one level in from the line it is on.
        /// </summary>
        private void Collect(Existing obj, List<(int, int, string)> splices)
        {
            var members = obj.Source.Members;
            var lastKept = -1;
            for (var k = 0; k < members.Count; k++)
            {
                var member = members[k];
                if (obj.Removed.Contains(member)) continue;
                lastKept = k;
                if (obj.Replaced.TryGetValue(member, out var value))
                {
                    var indent = JsonText.WrittenOnOneLine(bytes, member) ? null : JsonText.IndentOf(bytes, member.NameStart);
                    splices.Add((member.ValueStart, member.ValueEnd, Render(value, indent)));
                }
                else if (obj.Inner.TryGetValue(member, out var inner)) Collect(inner, splices);
            }
            if (obj.Removed.Count == 0 && obj.Added.Count == 0) return;

            if (lastKept < 0 && obj.Added.Count == 0)
            {
                splices.Add((obj.Source.Open + 1, obj.Source.Close, "")); // `{}`
                return;
            }
            if (members.Count == 0)
            {
                var outer = JsonText.LineIndent(bytes, obj.Source.Open);
                var inner = outer + layout.Unit;
                splices.Add((obj.Source.Open + 1, obj.Source.Close,
                    string.Concat(obj.Added.Select((a, n) => $"{(n == 0 ? "" : ",")}{layout.NewLine}{inner}{JsonText.Key(a.Name, layout)}{Render(a.Value, inner)}"))
                    + $"{layout.NewLine}{outer}"));
                return;
            }
            if (lastKept < 0)
            {
                // Every member replaced by new ones: they take the old ones' place, laid out like them.
                var indent = JsonText.IndentOf(bytes, members[^1].NameStart);
                splices.Add((members[0].NameStart, members[^1].ValueEnd, string.Concat(obj.Added.Select((a, n) =>
                    $"{(n == 0 ? "" : indent is null ? ", " : $",{layout.NewLine}{indent}")}{JsonText.Key(a.Name, layout)}{Render(a.Value, indent)}"))));
                return;
            }

            // Removed members before one that stays: each run, up to the next name that stays.
            for (var k = 0; k < lastKept; k++)
            {
                if (!obj.Removed.Contains(members[k])) continue;
                var from = k;
                while (obj.Removed.Contains(members[k])) k++;
                splices.Add((members[from].NameStart, members[k].NameStart, ""));
            }
            // After the last that stays: the removed ones, then what is new.
            var kept = members[lastKept];
            var keptIndent = JsonText.IndentOf(bytes, kept.NameStart);
            var appended = string.Concat(obj.Added.Select(a => keptIndent is null
                ? $", {JsonText.Key(a.Name, layout)}{Render(a.Value, null)}"
                : $",{layout.NewLine}{keptIndent}{JsonText.Key(a.Name, layout)}{Render(a.Value, keptIndent)}"));
            var tailEnd = members[^1].ValueEnd;
            if (tailEnd > kept.ValueEnd || appended.Length > 0) splices.Add((kept.ValueEnd, tailEnd, appended));
        }

        private string Render(Node node, string? indent) => JsonText.Render(writer => WriteNode(writer, node), layout, indent);

        private static void WriteNode(Utf8JsonWriter writer, Node node)
        {
            if (node is Leaf leaf)
            {
                JsonText.Write(writer, leaf.Value);
                return;
            }
            writer.WriteStartObject();
            foreach (var (name, value) in ((Built)node).Members)
            {
                writer.WritePropertyName(name);
                WriteNode(writer, value);
            }
            writer.WriteEndObject();
        }
    }
}
