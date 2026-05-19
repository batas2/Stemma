using System.Text;
using System.Text.RegularExpressions;

namespace Verso.Engine.Adapters.Yaml;

/// <summary>
/// Trivia-preserving emitter for <see cref="YamlConceptFile"/>. Untouched entries are
/// written byte-for-byte from <c>OriginalBlock</c>; modified entries are re-emitted
/// preserving original key order; new entries are emitted with canonical key order.
/// String-emit of YAML elsewhere is forbidden — see .doc/engineering/conventions.md.
/// </summary>
public static class YamlConceptWriter
{
    public static string Render(YamlConceptFile file)
    {
        var sb = new StringBuilder();
        var header = file.Header;
        if (header.Length == 0)
        {
            // Synthesize a minimal header when none exists (e.g. fresh file).
            sb.Append("version: ").Append(file.Version).Append('\n');
        }
        else
        {
            sb.Append(header);
        }

        WriteSection(sb, file, YamlSchema.ConceptsKey, file.Concepts.Count > 0, () =>
        {
            foreach (var c in file.Concepts)
                sb.Append(RenderConcept(c));
        });
        WriteSection(sb, file, YamlSchema.RelationsKey, file.Relations.Count > 0, () =>
        {
            foreach (var r in file.Relations)
                sb.Append(RenderRelation(r));
        });
        WriteSection(sb, file, YamlSchema.BooksKey, file.Books.Count > 0, () =>
        {
            foreach (var b in file.Books)
                sb.Append(RenderBook(b));
        });

        var text = sb.ToString();
        // Honour the input file's line ending if it differed from LF.
        if (file.LineEnding == "\r\n") text = text.Replace("\r\n", "\n").Replace("\n", "\r\n");
        return text;
    }

    private static void WriteSection(StringBuilder sb, YamlConceptFile file, string name, bool hasEntries, Action emit)
    {
        var wasPresent = file.SectionPresent.Contains(name);
        if (!hasEntries && !wasPresent) return;
        if (file.SectionHeaders.TryGetValue(name, out var headerLine))
            sb.Append(headerLine).Append('\n');
        else
            sb.Append(name).Append(":\n");
        if (file.SectionPreambles.TryGetValue(name, out var preamble))
            sb.Append(preamble);
        if (hasEntries) emit();
        if (file.SectionTrailers.TryGetValue(name, out var trailer))
            sb.Append(trailer);
    }

    private static string RenderConcept(YamlConceptEntry c)
    {
        if (!c.IsNew && !string.IsNullOrEmpty(c.OriginalBlock) && !c.Dirty)
            return c.OriginalBlock;
        if (c.Dirty && !string.IsNullOrEmpty(c.OriginalBlock))
            return EnsureTrailingNewline(RewriteBlock(c));
        return EnsureTrailingNewline(EmitFreshConcept(c));
    }

    private static string RenderRelation(YamlRelationEntry r)
    {
        if (!r.IsNew && !string.IsNullOrEmpty(r.OriginalBlock) && !r.Dirty)
            return r.OriginalBlock;
        if (r.Dirty && !string.IsNullOrEmpty(r.OriginalBlock))
            return EnsureTrailingNewline(RewriteRelationBlock(r));
        return EnsureTrailingNewline(EmitFreshRelation(r));
    }

    private static string RenderBook(YamlBookEntry b)
    {
        if (!b.IsNew && !string.IsNullOrEmpty(b.OriginalBlock) && !b.Dirty)
            return b.OriginalBlock;
        return EnsureTrailingNewline(EmitFreshBook(b));
    }

    private static string EnsureTrailingNewline(string s) => s.EndsWith('\n') ? s : s + "\n";

    private static string EmitFreshConcept(YamlConceptEntry c)
    {
        var sb = new StringBuilder();
        sb.Append("  - id: ").Append(c.Id).Append('\n');
        sb.Append("    kind: ").Append(c.Kind).Append('\n');
        sb.Append("    name: ").Append(EmitScalar(c.Name)).Append('\n');
        if (!string.IsNullOrEmpty(c.Layer)) sb.Append("    layer: ").Append(c.Layer).Append('\n');
        foreach (var p in c.Properties)
            sb.Append("    ").Append(p.Key).Append(": ").Append(EmitScalar(p.Value)).Append('\n');
        return sb.ToString();
    }

    private static string EmitFreshRelation(YamlRelationEntry r)
    {
        var sb = new StringBuilder();
        sb.Append("  - id: ").Append(r.Id).Append('\n');
        sb.Append("    kind: ").Append(r.Kind).Append('\n');
        sb.Append("    from: ").Append(r.From).Append('\n');
        sb.Append("    to: ").Append(r.To).Append('\n');
        foreach (var p in r.Properties)
            sb.Append("    ").Append(p.Key).Append(": ").Append(EmitScalar(p.Value)).Append('\n');
        return sb.ToString();
    }

    private static string EmitFreshBook(YamlBookEntry b)
    {
        var sb = new StringBuilder();
        sb.Append("  - id: ").Append(b.Id).Append('\n');
        sb.Append("    name: ").Append(EmitScalar(b.Name)).Append('\n');
        if (!string.IsNullOrEmpty(b.Audience)) sb.Append("    audience: ").Append(b.Audience).Append('\n');
        sb.Append("    pages:\n");
        foreach (var p in b.Pages)
        {
            sb.Append("      - viewId: ").Append(p.ViewId).Append('\n');
            sb.Append("        title: ").Append(EmitScalar(p.Title)).Append('\n');
            sb.Append("        narrative: ").Append(EmitScalar(p.Narrative)).Append('\n');
        }
        return sb.ToString();
    }

    /// <summary>
    /// Rewrites an entry block in place. Preserves the original line set in original order;
    /// updates values for keys whose value changed; appends new keys at the end of the
    /// block (after the last existing property line).
    /// </summary>
    private static string RewriteBlock(YamlConceptEntry c)
    {
        var current = new Dictionary<string, string>(StringComparer.Ordinal) { ["id"] = c.Id, ["kind"] = c.Kind, ["name"] = c.Name };
        if (c.Layer is not null) current["layer"] = c.Layer;
        foreach (var p in c.Properties) current[p.Key] = p.Value;
        return RewriteMappingBlock(c.OriginalBlock, current);
    }

    private static string RewriteRelationBlock(YamlRelationEntry r)
    {
        var current = new Dictionary<string, string>(StringComparer.Ordinal)
        {
            ["id"] = r.Id, ["kind"] = r.Kind, ["from"] = r.From, ["to"] = r.To
        };
        foreach (var p in r.Properties) current[p.Key] = p.Value;
        return RewriteMappingBlock(r.OriginalBlock, current);
    }

    private static string RewriteMappingBlock(string originalBlock, Dictionary<string, string> currentValues)
    {
        var sb = new StringBuilder();
        var seen = new HashSet<string>(StringComparer.Ordinal);
        var lines = originalBlock.Split('\n');
        for (var i = 0; i < lines.Length; i++)
        {
            var l = lines[i];
            var stripped = l.TrimEnd('\r');
            string? key = null; string? prefix = null;
            // First entry line: "  - key: value"
            var m1 = Regex.Match(stripped, @"^(  -\s+)([\w-]+)(\s*:\s*)(.*)$");
            if (i == 0 && m1.Success)
            {
                key = m1.Groups[2].Value;
                prefix = m1.Groups[1].Value + key + m1.Groups[3].Value;
            }
            else
            {
                var m2 = Regex.Match(stripped, @"^(    )([\w-]+)(\s*:\s*)(.*)$");
                if (m2.Success)
                {
                    key = m2.Groups[2].Value;
                    prefix = m2.Groups[1].Value + key + m2.Groups[3].Value;
                }
            }

            if (key is not null && currentValues.TryGetValue(key, out var newVal))
            {
                sb.Append(prefix).Append(EmitScalar(newVal));
                if (i < lines.Length - 1) sb.Append('\n');
                seen.Add(key);
            }
            else if (key is not null && !currentValues.ContainsKey(key))
            {
                // Key removed: skip this line.
                continue;
            }
            else
            {
                sb.Append(l);
                if (i < lines.Length - 1) sb.Append('\n');
            }
        }
        // Append unseen keys (additions).
        foreach (var kv in currentValues)
        {
            if (seen.Contains(kv.Key)) continue;
            if (sb.Length > 0 && sb[^1] != '\n') sb.Append('\n');
            sb.Append("    ").Append(kv.Key).Append(": ").Append(EmitScalar(kv.Value));
        }
        var result = sb.ToString();
        if (!result.EndsWith('\n')) result += "\n";
        return result;
    }

    internal static string EmitScalar(string value)
    {
        if (string.IsNullOrEmpty(value)) return "\"\"";
        if (value.Contains('\n') || value.Contains('"') || value.Contains(": ") || value.StartsWith(' ') || value.EndsWith(' '))
            return "\"" + value.Replace("\\", "\\\\").Replace("\"", "\\\"") + "\"";
        // Quote when the value looks like a YAML reserved scalar.
        if (value is "true" or "false" or "null" or "~") return "\"" + value + "\"";
        return value;
    }
}
