using Verso.Engine.Operations;

namespace Verso.Engine.Adapters.Yaml;

/// <summary>
/// Mutation primitives for the YAML adapter. Each method preserves the trivia
/// invariants of <see cref="YamlConceptWriter"/>: unchanged entries stay byte-
/// identical; changed entries rewrite only the affected lines; new entries are
/// emitted with canonical key order.
/// </summary>
public static class YamlMutations
{
    /// <summary>Add a new concept to the named file. File is created on first add.</summary>
    public static YamlConceptEntry AddConcept(YamlAdapter adapter, string fileName, string id, string kind, string name, string? layer = null, IEnumerable<KeyValuePair<string, string>>? properties = null)
    {
        var file = adapter.GetOrCreate(fileName);
        if (file.Concepts.Any(c => c.Id == id))
            throw new InvalidOperationException($"concept id `{id}` already present in {fileName}");
        var entry = new YamlConceptEntry
        {
            Id = id, Kind = kind, Name = name, Layer = layer, IsNew = true
        };
        if (properties is not null) foreach (var p in properties) entry.Properties.Add(p);
        file.Concepts.Add(entry);
        EnsureSection(file, YamlSchema.ConceptsKey);
        return entry;
    }

    public static void UpdateConceptProperty(YamlConceptEntry entry, string key, string value)
    {
        switch (key)
        {
            case "name": entry.Name = value; break;
            case "kind": entry.Kind = value; break;
            case "layer": entry.Layer = value; break;
            default:
                var idx = entry.Properties.FindIndex(p => p.Key == key);
                if (idx >= 0) entry.Properties[idx] = new(key, value);
                else entry.Properties.Add(new(key, value));
                break;
        }
        entry.Dirty = true;
    }

    public static void RemoveConceptProperty(YamlConceptEntry entry, string key)
    {
        entry.Properties.RemoveAll(p => p.Key == key);
        entry.Dirty = true;
    }

    public static void RemoveConcept(YamlConceptFile file, string id)
    {
        file.Concepts.RemoveAll(c => c.Id == id);
    }

    public static void RenameConcept(YamlConceptEntry entry, string newName)
    {
        if (entry.Name != newName)
        {
            entry.Aliases.Insert(0, entry.Name);
            entry.Name = newName;
            entry.Dirty = true;
        }
    }

    public static YamlRelationEntry AddRelation(YamlAdapter adapter, string fileName, string id, string kind, string from, string to)
    {
        var file = adapter.GetOrCreate(fileName);
        if (file.Relations.Any(r => r.Id == id))
            throw new InvalidOperationException($"relation id `{id}` already present in {fileName}");
        var entry = new YamlRelationEntry { Id = id, Kind = kind, From = from, To = to, IsNew = true };
        file.Relations.Add(entry);
        EnsureSection(file, YamlSchema.RelationsKey);
        return entry;
    }

    public static void UpdateRelation(YamlRelationEntry entry, string? kind = null, string? from = null, string? to = null)
    {
        if (kind is not null) entry.Kind = kind;
        if (from is not null) entry.From = from;
        if (to is not null) entry.To = to;
        entry.Dirty = true;
    }

    public static void RemoveRelation(YamlConceptFile file, string id) =>
        file.Relations.RemoveAll(r => r.Id == id);

    private static void EnsureSection(YamlConceptFile file, string sectionName)
    {
        if (file.SectionPresent.Contains(sectionName)) return;
        file.SectionPresent.Add(sectionName);
        file.SectionHeaders[sectionName] = sectionName + ":";
        // If header didn't end with a newline, add one before the synthesized section.
        if (file.Header.Length > 0 && !file.Header.EndsWith('\n'))
            file.Header += "\n";
    }
}

// === op records ===

public sealed record AddYamlConceptOp(
    string OpId,
    string FileName,
    string Id,
    string Kind,
    string Name,
    string? Layer = null) : OperationBase(OpId);

public sealed record UpdateYamlConceptOp(
    string OpId,
    string Id,
    string Key,
    string Value) : OperationBase(OpId);

public sealed record RemoveYamlConceptOp(
    string OpId,
    string Id) : OperationBase(OpId);

public sealed record RenameYamlConceptOp(
    string OpId,
    string Id,
    string NewName) : OperationBase(OpId);

public sealed record AddYamlRelationOp(
    string OpId,
    string FileName,
    string Id,
    string Kind,
    string From,
    string To) : OperationBase(OpId);

public sealed record UpdateYamlRelationOp(
    string OpId,
    string Id,
    string? Kind = null,
    string? From = null,
    string? To = null) : OperationBase(OpId);

public sealed record RemoveYamlRelationOp(
    string OpId,
    string Id) : OperationBase(OpId);
