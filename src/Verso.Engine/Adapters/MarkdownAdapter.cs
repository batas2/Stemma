using System.Text;

namespace Verso.Engine.Adapters;

/// <summary>
/// Lightweight Markdown adapter for narrative concept storage. Each narrative file follows
/// the convention:
///
/// <code>
/// ---
/// id: dec_001
/// title: Onboarding routes through Risk first
/// status: accepted
/// date: 2026-04-12
/// ---
///
/// ## Context
/// ...
///
/// ## Consequences
/// ...
/// </code>
///
/// Strict round-trip: leading frontmatter (between `---` fences) and the Markdown body are
/// preserved verbatim except for the keys/values the engine explicitly mutates. Frontmatter
/// key order is preserved; body bytes are byte-identical when only the frontmatter changes.
/// </summary>
public sealed class MarkdownDoc
{
    public List<KeyValuePair<string, string>> FrontmatterOrdered { get; } = new();
    public string Body { get; set; } = string.Empty;
    public string LineEnding { get; set; } = Environment.NewLine;

    public string? Get(string key) =>
        FrontmatterOrdered.FirstOrDefault(kv => string.Equals(kv.Key, key, StringComparison.OrdinalIgnoreCase)).Value;

    public void Set(string key, string? value)
    {
        var idx = FrontmatterOrdered.FindIndex(kv => string.Equals(kv.Key, key, StringComparison.OrdinalIgnoreCase));
        if (value is null)
        {
            if (idx >= 0) FrontmatterOrdered.RemoveAt(idx);
            return;
        }
        if (idx >= 0) FrontmatterOrdered[idx] = new(FrontmatterOrdered[idx].Key, value);
        else FrontmatterOrdered.Add(new(key, value));
    }
}

public static class MarkdownAdapter
{
    public static MarkdownDoc Parse(string text)
    {
        var doc = new MarkdownDoc();
        if (string.IsNullOrEmpty(text)) return doc;

        // Detect line ending.
        if (text.Contains("\r\n", StringComparison.Ordinal)) doc.LineEnding = "\r\n";
        else if (text.Contains('\n')) doc.LineEnding = "\n";

        // Detect YAML frontmatter (must start with `---` on the very first line).
        if (!text.StartsWith("---", StringComparison.Ordinal))
        {
            doc.Body = text;
            return doc;
        }

        // Find the closing `---`.
        var lines = text.Split('\n');
        var closeIndex = -1;
        for (var i = 1; i < lines.Length; i++)
        {
            var trimmed = lines[i].TrimEnd('\r');
            if (trimmed == "---" || trimmed == "...")
            {
                closeIndex = i;
                break;
            }
        }
        if (closeIndex < 0)
        {
            doc.Body = text;
            return doc;
        }

        for (var i = 1; i < closeIndex; i++)
        {
            var line = lines[i].TrimEnd('\r');
            if (string.IsNullOrWhiteSpace(line)) continue;
            var colon = line.IndexOf(':');
            if (colon <= 0) continue;
            var key = line[..colon].Trim();
            var rawValue = line[(colon + 1)..].Trim();
            doc.FrontmatterOrdered.Add(new(key, Unquote(rawValue)));
        }

        // Body = everything after the closing `---` line.
        var bodyStart = closeIndex + 1;
        var bodyParts = new List<string>(lines.Length - bodyStart);
        for (var i = bodyStart; i < lines.Length; i++) bodyParts.Add(lines[i]);
        doc.Body = string.Join('\n', bodyParts).TrimStart('\r', '\n');
        if (doc.LineEnding == "\r\n") doc.Body = doc.Body.Replace("\n", "\r\n");
        return doc;
    }

    public static string Render(MarkdownDoc doc)
    {
        var sb = new StringBuilder();
        if (doc.FrontmatterOrdered.Count > 0)
        {
            sb.Append("---").Append(doc.LineEnding);
            foreach (var kv in doc.FrontmatterOrdered)
            {
                sb.Append(kv.Key).Append(": ").Append(NeedsQuote(kv.Value) ? Quote(kv.Value) : kv.Value).Append(doc.LineEnding);
            }
            sb.Append("---").Append(doc.LineEnding);
            if (!doc.Body.StartsWith(doc.LineEnding)) sb.Append(doc.LineEnding);
        }
        sb.Append(doc.Body);
        return sb.ToString();
    }

    private static bool NeedsQuote(string value)
    {
        if (string.IsNullOrEmpty(value)) return true;
        return value.Contains(':') || value.Contains('#') || value.Contains('"')
            || value.Contains('\n') || value.StartsWith(' ') || value.EndsWith(' ');
    }

    private static string Quote(string value) =>
        "\"" + value.Replace("\\", "\\\\").Replace("\"", "\\\"") + "\"";

    private static string Unquote(string value)
    {
        if (value.Length >= 2 && value[0] == '"' && value[^1] == '"')
            return value[1..^1].Replace("\\\"", "\"").Replace("\\\\", "\\");
        return value;
    }
}
