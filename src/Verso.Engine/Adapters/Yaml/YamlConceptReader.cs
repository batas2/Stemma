using System.Text.RegularExpressions;

namespace Verso.Engine.Adapters.Yaml;

/// <summary>
/// Trivia-preserving parser for <c>*.verso.yaml</c> files. Splits the file into a
/// header byte range + per-entry byte ranges within each section. Each entry keeps
/// its original bytes verbatim so the writer can emit untouched entries byte-identically.
/// </summary>
public static class YamlConceptReader
{
    public static YamlConceptFile Parse(string filePath, string text)
    {
        var file = new YamlConceptFile { FilePath = filePath, Text = text };
        if (string.IsNullOrEmpty(text)) return file;
        if (text.Contains("\r\n", StringComparison.Ordinal)) file.LineEnding = "\r\n";
        else if (text.Contains('\n')) file.LineEnding = "\n";

        var lines = text.Split('\n');
        // lineStarts[i] = char offset of start of line i; lineStarts[N] = text.Length
        var lineStarts = new int[lines.Length + 1];
        var pos = 0;
        for (var i = 0; i < lines.Length; i++)
        {
            lineStarts[i] = pos;
            pos += lines[i].Length + 1; // +1 for the consumed '\n'
        }
        lineStarts[lines.Length] = text.Length;

        // First pass: find section header positions.
        var sections = new List<(string Name, int HeaderLineIndex)>();
        for (var i = 0; i < lines.Length; i++)
        {
            var l = lines[i].TrimEnd('\r');
            if (l.Length == 0 || char.IsWhiteSpace(l[0])) continue;
            var m = Regex.Match(l, @"^(\w[\w-]*)\s*:\s*$");
            if (!m.Success) continue;
            var key = m.Groups[1].Value;
            if (key is YamlSchema.ConceptsKey or YamlSchema.RelationsKey or YamlSchema.BooksKey)
                sections.Add((key, i));
        }

        var firstSectionLine = sections.Count > 0 ? sections[0].HeaderLineIndex : lines.Length;
        // Header bytes = text from start to start of first section header line.
        file.Header = text[..lineStarts[firstSectionLine]];
        for (var i = 0; i < firstSectionLine; i++)
        {
            var vm = Regex.Match(lines[i].TrimEnd('\r'), @"^version\s*:\s*(\d+)\s*$");
            if (vm.Success) file.Version = int.Parse(vm.Groups[1].Value);
        }

        // Tail bytes = anything after the last section's last entry.
        for (var s = 0; s < sections.Count; s++)
        {
            var sect = sections[s];
            file.SectionPresent.Add(sect.Name);
            file.SectionHeaders[sect.Name] = lines[sect.HeaderLineIndex];
            var sectionStart = sect.HeaderLineIndex + 1;
            var sectionEndLine = s + 1 < sections.Count ? sections[s + 1].HeaderLineIndex : lines.Length;
            var entries = SplitEntries(lines, sectionStart, sectionEndLine);
            foreach (var (entryStart, entryEnd) in entries)
            {
                var block = text[lineStarts[entryStart]..lineStarts[entryEnd + 1]];
                var entryLines = new List<string>();
                for (var i = entryStart; i <= entryEnd; i++) entryLines.Add(lines[i]);
                switch (sect.Name)
                {
                    case YamlSchema.ConceptsKey: file.Concepts.Add(ParseConcept(entryLines, block)); break;
                    case YamlSchema.RelationsKey: file.Relations.Add(ParseRelation(entryLines, block)); break;
                    case YamlSchema.BooksKey: file.Books.Add(ParseBook(entryLines, block)); break;
                }
            }
            // Trailing trivia inside this section (lines after last entry but before next section).
            // Captured in `file.SectionTrailer[name]`.
            var lastEnd = entries.Count > 0 ? entries[^1].End + 1 : sectionStart;
            if (lastEnd < sectionEndLine)
            {
                var trailer = text[lineStarts[lastEnd]..lineStarts[sectionEndLine]];
                file.SectionTrailers[sect.Name] = trailer;
            }
        }

        // Tail (after the last section's content, e.g. trailing comments).
        if (sections.Count > 0)
        {
            var lastSect = sections[^1];
            var endLine = lines.Length;
            var entries = SplitEntries(lines, lastSect.HeaderLineIndex + 1, endLine);
            var lastEntryEnd = entries.Count > 0 ? entries[^1].End + 1 : lastSect.HeaderLineIndex + 1;
            // Already covered by SectionTrailer; nothing else needed.
            _ = lastEntryEnd;
        }
        return file;
    }

    private static List<(int Start, int End)> SplitEntries(string[] lines, int start, int end)
    {
        var result = new List<(int, int)>();
        int? curStart = null;
        for (var i = start; i < end; i++)
        {
            var l = lines[i].TrimEnd('\r');
            if (Regex.IsMatch(l, @"^  -(\s|$)"))
            {
                if (curStart is int s) result.Add((s, i - 1));
                curStart = i;
            }
        }
        if (curStart is int s2)
        {
            // Walk backwards from `end-1` past trailing blank/comment lines that belong to a section trailer.
            var last = end - 1;
            while (last > s2)
            {
                var l = lines[last].TrimEnd('\r');
                if (l.Length == 0 || l.TrimStart().StartsWith('#') || (l.Length > 0 && !char.IsWhiteSpace(l[0]) && l != ""))
                    last--;
                else
                    break;
            }
            // For now, attach trailing blanks to the entry (simpler; trailing comments before next section move there too).
            result.Add((s2, end - 1));
        }
        return result;
    }

    private static YamlConceptEntry ParseConcept(List<string> lines, string block)
    {
        var entry = new YamlConceptEntry { OriginalBlock = block };
        ParseMapping(lines, (k, v) =>
        {
            switch (k)
            {
                case "id": entry.Id = v; break;
                case "kind": entry.Kind = v; break;
                case "name": entry.Name = v; break;
                case "layer": entry.Layer = v; break;
                default:
                    if (k.Length > 0) entry.Properties.Add(new(k, v));
                    break;
            }
        });
        return entry;
    }

    private static YamlRelationEntry ParseRelation(List<string> lines, string block)
    {
        var entry = new YamlRelationEntry { OriginalBlock = block };
        ParseMapping(lines, (k, v) =>
        {
            switch (k)
            {
                case "id": entry.Id = v; break;
                case "kind": entry.Kind = v; break;
                case "from": entry.From = v; break;
                case "to": entry.To = v; break;
                default:
                    if (k.Length > 0) entry.Properties.Add(new(k, v));
                    break;
            }
        });
        return entry;
    }

    private static YamlBookEntry ParseBook(List<string> lines, string block)
    {
        var entry = new YamlBookEntry { OriginalBlock = block };
        ParseMapping(lines, (k, v) =>
        {
            switch (k)
            {
                case "id": entry.Id = v; break;
                case "name": entry.Name = v; break;
                case "audience": entry.Audience = v; break;
            }
        });
        var inPages = false;
        YamlBookPage? cur = null;
        foreach (var raw in lines)
        {
            var l = raw.TrimEnd('\r');
            if (Regex.IsMatch(l, @"^    pages\s*:\s*$")) { inPages = true; continue; }
            if (!inPages) continue;
            var pm = Regex.Match(l, @"^      -\s+viewId\s*:\s*(.*)$");
            if (pm.Success)
            {
                cur = new YamlBookPage { ViewId = Unquote(pm.Groups[1].Value.Trim()) };
                entry.Pages.Add(cur);
                continue;
            }
            if (cur is null) continue;
            var fm = Regex.Match(l, @"^        ([\w-]+)\s*:\s*(.*)$");
            if (fm.Success)
            {
                var k2 = fm.Groups[1].Value;
                var v2 = Unquote(fm.Groups[2].Value.Trim());
                if (k2 == "title") cur.Title = v2;
                else if (k2 == "narrative") cur.Narrative = v2;
                else if (k2 == "viewId") cur.ViewId = v2;
            }
        }
        return entry;
    }

    private static void ParseMapping(List<string> lines, Action<string, string> emit)
    {
        for (var i = 0; i < lines.Count; i++)
        {
            var l = lines[i].TrimEnd('\r');
            if (i == 0)
            {
                var m1 = Regex.Match(l, @"^  -\s+([\w-]+)\s*:\s*(.*)$");
                if (m1.Success)
                {
                    emit(m1.Groups[1].Value, Unquote(m1.Groups[2].Value.Trim()));
                    continue;
                }
            }
            var m2 = Regex.Match(l, @"^    ([\w-]+)\s*:\s*(.*)$");
            if (m2.Success)
                emit(m2.Groups[1].Value, Unquote(m2.Groups[2].Value.Trim()));
        }
    }

    private static string Unquote(string s)
    {
        if (s.Length >= 2 && ((s[0] == '"' && s[^1] == '"') || (s[0] == '\'' && s[^1] == '\'')))
            return s[1..^1];
        return s;
    }
}
