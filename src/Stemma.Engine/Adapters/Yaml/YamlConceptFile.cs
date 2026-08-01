namespace Stemma.Engine.Adapters.Yaml;

/// <summary>
/// In-memory representation of a parsed <c>*.stemma.yaml</c> concept file. Holds the
/// original byte text plus per-entry byte ranges so that mutations can be applied
/// surgically — untouched concepts stay byte-identical after a save round-trip.
/// </summary>
public sealed class YamlConceptFile
{
    public string FilePath { get; init; } = string.Empty;
    public string Text { get; internal set; } = string.Empty;
    public int Version { get; internal set; } = 0;
    public string LineEnding { get; internal set; } = "\n";
    public List<YamlConceptEntry> Concepts { get; } = new();
    public List<YamlRelationEntry> Relations { get; } = new();
    public List<YamlBookEntry> Books { get; } = new();

    /// <summary>Header bytes (everything before the first list-section, or whole file when empty).</summary>
    public string Header { get; internal set; } = string.Empty;

    /// <summary>Sections present in the original file, in declaration order.</summary>
    public List<string> SectionPresent { get; } = new();

    /// <summary>Original section-header line (e.g. <c>concepts:</c>) keyed by section name.</summary>
    public Dictionary<string, string> SectionHeaders { get; } = new(StringComparer.Ordinal);

    /// <summary>Original trailing bytes inside a section (between last entry and next section).</summary>
    public Dictionary<string, string> SectionTrailers { get; } = new(StringComparer.Ordinal);

    /// <summary>Original leading bytes inside a section (between section header and first entry).</summary>
    public Dictionary<string, string> SectionPreambles { get; } = new(StringComparer.Ordinal);

    public YamlConceptEntry? FindConcept(string id) =>
        Concepts.FirstOrDefault(c => string.Equals(c.Id, id, StringComparison.Ordinal));

    public YamlRelationEntry? FindRelation(string id) =>
        Relations.FirstOrDefault(r => string.Equals(r.Id, id, StringComparison.Ordinal));

    public YamlBookEntry? FindBook(string id) =>
        Books.FirstOrDefault(b => string.Equals(b.Id, id, StringComparison.Ordinal));
}

public sealed class YamlConceptEntry
{
    public string Id { get; set; } = string.Empty;
    public string Kind { get; set; } = string.Empty;
    public string Name { get; set; } = string.Empty;
    public string? Layer { get; set; }
    public List<KeyValuePair<string, string>> Properties { get; } = new();
    public List<string> Aliases { get; } = new();

    /// <summary>Original text of this concept block. Includes leading list marker and trailing newline.</summary>
    public string OriginalBlock { get; internal set; } = string.Empty;

    /// <summary>True if entry was added by an op and has no original bytes.</summary>
    public bool IsNew { get; internal set; }

    /// <summary>True if any field changed since parse — writer rewrites the block.</summary>
    public bool Dirty { get; internal set; }
}

public sealed class YamlRelationEntry
{
    public string Id { get; set; } = string.Empty;
    public string Kind { get; set; } = string.Empty;
    public string From { get; set; } = string.Empty;
    public string To { get; set; } = string.Empty;
    public List<KeyValuePair<string, string>> Properties { get; } = new();
    public string OriginalBlock { get; internal set; } = string.Empty;
    public bool IsNew { get; internal set; }
    public bool Dirty { get; internal set; }
}

public sealed class YamlBookEntry
{
    public string Id { get; set; } = string.Empty;
    public string Name { get; set; } = string.Empty;
    public string? Audience { get; set; }
    public List<YamlBookPage> Pages { get; } = new();
    public string OriginalBlock { get; internal set; } = string.Empty;
    public bool IsNew { get; internal set; }
    public bool Dirty { get; internal set; }
}

public sealed class YamlBookPage
{
    public string ViewId { get; set; } = string.Empty;
    public string Title { get; set; } = string.Empty;
    public string Narrative { get; set; } = string.Empty;
}
