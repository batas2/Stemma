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

    public static YamlBookEntry AddBook(YamlAdapter adapter, string fileName, string id, string name, string? audience = null)
    {
        var file = adapter.GetOrCreate(fileName);
        if (file.Books.Any(b => b.Id == id))
            throw new InvalidOperationException($"book id `{id}` already present in {fileName}");
        var entry = new YamlBookEntry { Id = id, Name = name, Audience = audience, IsNew = true };
        file.Books.Add(entry);
        EnsureSection(file, YamlSchema.BooksKey);
        return entry;
    }

    public static void RemoveBook(YamlConceptFile file, string id) =>
        file.Books.RemoveAll(b => b.Id == id);

    public static void RenameBook(YamlBookEntry entry, string newName)
    {
        if (entry.Name == newName) return;
        entry.Name = newName;
        // Books are always fully re-emitted (no in-place rewrite path), so mark IsNew so the
        // writer rebuilds the block. This preserves trivia of *sibling* books, not this one.
        entry.IsNew = true;
        entry.OriginalBlock = string.Empty;
    }

    public static YamlBookPage AddBookPage(YamlBookEntry book, string viewId, string title, string narrative = "")
    {
        var page = new YamlBookPage { ViewId = viewId, Title = title, Narrative = narrative };
        book.Pages.Add(page);
        book.IsNew = true;
        book.OriginalBlock = string.Empty;
        return page;
    }

    public static void RemoveBookPage(YamlBookEntry book, int pageIndex)
    {
        if (pageIndex < 0 || pageIndex >= book.Pages.Count)
            throw new ArgumentOutOfRangeException(nameof(pageIndex), $"page index {pageIndex} out of range (0..{book.Pages.Count - 1})");
        book.Pages.RemoveAt(pageIndex);
        book.IsNew = true;
        book.OriginalBlock = string.Empty;
    }

    public static void ReorderBookPages(YamlBookEntry book, IReadOnlyList<int> newOrder)
    {
        if (newOrder.Count != book.Pages.Count)
            throw new ArgumentException($"new order length {newOrder.Count} must equal page count {book.Pages.Count}", nameof(newOrder));
        var distinct = new HashSet<int>(newOrder);
        if (distinct.Count != newOrder.Count) throw new ArgumentException("new order contains duplicate indices", nameof(newOrder));
        foreach (var i in newOrder)
            if (i < 0 || i >= book.Pages.Count)
                throw new ArgumentException($"index {i} out of range", nameof(newOrder));
        var reordered = newOrder.Select(i => book.Pages[i]).ToList();
        book.Pages.Clear();
        book.Pages.AddRange(reordered);
        book.IsNew = true;
        book.OriginalBlock = string.Empty;
    }

    public static void SetBookPageNarrative(YamlBookEntry book, int pageIndex, string narrative)
    {
        if (pageIndex < 0 || pageIndex >= book.Pages.Count)
            throw new ArgumentOutOfRangeException(nameof(pageIndex), $"page index {pageIndex} out of range (0..{book.Pages.Count - 1})");
        book.Pages[pageIndex].Narrative = narrative;
        book.IsNew = true;
        book.OriginalBlock = string.Empty;
    }

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

// === Track A — View Book ops ===

public sealed record AddBookOp(
    string OpId,
    string Id,
    string Name,
    string? Audience = null) : OperationBase(OpId);

public sealed record RemoveBookOp(
    string OpId,
    string Id) : OperationBase(OpId);

public sealed record RenameBookOp(
    string OpId,
    string Id,
    string NewName) : OperationBase(OpId);

public sealed record AddBookPageOp(
    string OpId,
    string BookId,
    string ViewId,
    string Title,
    string Narrative = "") : OperationBase(OpId);

public sealed record RemoveBookPageOp(
    string OpId,
    string BookId,
    int PageIndex) : OperationBase(OpId);

public sealed record ReorderBookPagesOp(
    string OpId,
    string BookId,
    IReadOnlyList<int> NewOrder) : OperationBase(OpId);

public sealed record SetBookPageNarrativeOp(
    string OpId,
    string BookId,
    int PageIndex,
    string Narrative) : OperationBase(OpId);

// === Track C sugar ops — emit YAML under the hood ===

public sealed record AddAggregateRootOp(
    string OpId,
    string Id,
    string Name,
    string? ContextId = null) : OperationBase(OpId);

public sealed record AddDomainEntityOp(
    string OpId,
    string Id,
    string Name,
    string ParentAggregateId) : OperationBase(OpId);

public sealed record AddValueObjectOp(
    string OpId,
    string Id,
    string Name) : OperationBase(OpId);

public sealed record AddResourceOp(
    string OpId,
    string Id,
    string Name,
    string? ParentResourceId = null,
    IReadOnlyList<string>? Actions = null) : OperationBase(OpId);

public sealed record MoveEntityToAggregateOp(
    string OpId,
    string EntityId,
    string NewParentAggregateId) : OperationBase(OpId);

public sealed record MoveResourceUnderParentOp(
    string OpId,
    string ResourceId,
    string NewParentResourceId) : OperationBase(OpId);

public sealed record SetResourceActionsOp(
    string OpId,
    string ResourceId,
    IReadOnlyList<string> Actions) : OperationBase(OpId);

/// <summary>
/// Convenience helpers that apply Track C ops as YAML primitives. Each sugar op resolves
/// to one or more <see cref="YamlMutations"/> calls so the trivia-preserving contract
/// applies uniformly.
/// </summary>
public static class DataLayerOps
{
    public const string DataModelFile = "data-model.verso.yaml";
    public const string ResourcesFile = "resources.verso.yaml";

    public static YamlConceptEntry AddAggregateRoot(YamlAdapter adapter, string id, string name, string? contextId = null)
    {
        var props = contextId is not null ? new[] { new KeyValuePair<string, string>("contextId", contextId) } : null;
        return YamlMutations.AddConcept(adapter, DataModelFile, id, "AggregateRoot", name, layer: "data", properties: props);
    }

    public static YamlConceptEntry AddDomainEntity(YamlAdapter adapter, string id, string name, string parentAggregateId)
    {
        return YamlMutations.AddConcept(adapter, DataModelFile, id, "DomainEntity", name, layer: "data",
            properties: new[] { new KeyValuePair<string, string>("parent", parentAggregateId) });
    }

    public static YamlConceptEntry AddValueObject(YamlAdapter adapter, string id, string name)
    {
        return YamlMutations.AddConcept(adapter, DataModelFile, id, "ValueObject", name, layer: "data");
    }

    public static YamlConceptEntry AddResource(YamlAdapter adapter, string id, string name, string? parent = null, IReadOnlyList<string>? actions = null)
    {
        var props = new List<KeyValuePair<string, string>>();
        if (parent is not null) props.Add(new("parent", parent));
        if (actions is { Count: > 0 }) props.Add(new("actions", string.Join(",", actions)));
        return YamlMutations.AddConcept(adapter, ResourcesFile, id, "Resource", name, layer: "data", properties: props);
    }

    public static void MoveEntityToAggregate(YamlAdapter adapter, string entityId, string newParent)
    {
        var entry = adapter.FindConcept(entityId) ?? throw new InvalidOperationException($"entity `{entityId}` not found");
        YamlMutations.UpdateConceptProperty(entry, "parent", newParent);
    }

    public static void MoveResourceUnderParent(YamlAdapter adapter, string resourceId, string newParent)
    {
        var entry = adapter.FindConcept(resourceId) ?? throw new InvalidOperationException($"resource `{resourceId}` not found");
        YamlMutations.UpdateConceptProperty(entry, "parent", newParent);
    }

    public static void SetResourceActions(YamlAdapter adapter, string resourceId, IReadOnlyList<string> actions)
    {
        var entry = adapter.FindConcept(resourceId) ?? throw new InvalidOperationException($"resource `{resourceId}` not found");
        YamlMutations.UpdateConceptProperty(entry, "actions", string.Join(",", actions));
    }
}
