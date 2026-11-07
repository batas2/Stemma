namespace Stemma.Engine.ArchModel;

public enum ChangeKind { Added, Removed, Changed }

/// <param name="Element">The element as it is now, or as it was for a removal.</param>
/// <param name="Details">What changed about it, one sentence fragment each; empty for an addition or a removal.</param>
public sealed record ElementChange(string Id, ChangeKind Change, ArchElement Element, IReadOnlyList<string> Details);

public sealed record LinkChange(string Id, ChangeKind Change, ArchLink Link, IReadOnlyList<string> Details);

public sealed record ModelChanges(IReadOnlyList<ElementChange> Elements, IReadOnlyList<LinkChange> Links)
{
    public int Added => Count(ChangeKind.Added);
    public int Removed => Count(ChangeKind.Removed);
    public int Changed => Count(ChangeKind.Changed);
    public int Total => Elements.Count + Links.Count;

    private int Count(ChangeKind kind) => Elements.Count(c => c.Change == kind) + Links.Count(c => c.Change == kind);
}

/// <summary>
/// What changed between two versions of the model, matched by id — the ids are stable, so a rename is a
/// change to one element, not a removal and an addition. Each change says, in words, what changed about it.
///
/// The client has the same comparison in <c>lib/modelDiff.ts</c>, where it recomputes as the person
/// edits (ADR-0024); this one is for the command line (<c>stemma diff</c>, ADR-0031). The two are held to
/// one set of cases, <c>tests/shared/model-diff.cases.json</c>: the same two models give the same changes
/// in the same words, and a change to the wording is made in both or the cases fail.
/// </summary>
public static class ModelDiff
{
    private static readonly ArchModel Empty = new("", [], [], []);

    public static ModelChanges Compare(ArchModel? beforeModel, ArchModel after)
    {
        var before = beforeModel ?? Empty;
        var beforeById = ById(before.Elements, e => e.Id);
        var afterById = ById(after.Elements, e => e.Id);
        var tagsBefore = TagsOf(before);
        var tagsAfter = TagsOf(after);
        string NameBefore(string id) => Quoted(beforeById.GetValueOrDefault(id)?.Name ?? id);
        string NameAfter(string id) => Quoted(afterById.GetValueOrDefault(id)?.Name ?? id);

        var elements = new List<ElementChange>();
        foreach (var e in after.Elements)
        {
            if (!beforeById.TryGetValue(e.Id, out var was)) { elements.Add(new(e.Id, ChangeKind.Added, e, [])); continue; }
            var details = new List<string>();
            if (was.Name != e.Name) details.Add($"Renamed from {Quoted(was.Name)}");
            if (was.Kind != e.Kind) details.Add($"Now a {KindLabel(e.Kind)} (was a {KindLabel(was.Kind)})");
            Moved(details, "Moved to", Attr(was, "contextId"), Attr(e, "contextId"), NameBefore, NameAfter);
            Moved(details, "Now part of", Attr(was, "systemId"), Attr(e, "systemId"), NameBefore, NameAfter);
            Moved(details, "Now about", Attr(was, "aboutId"), Attr(e, "aboutId"), NameBefore, NameAfter);
            foreach (var (key, label) in new[] { ("kind", "Container kind"), ("role", "Role") })
            {
                var (a, b) = (Attr(was, key), Attr(e, key));
                if (a != b) details.Add($"{label} {a ?? "none"} → {b ?? "none"}");
            }
            var (techA, techB) = (Attr(was, "technology"), Attr(e, "technology"));
            if (techA != techB) details.Add($"Technology {Quoted(techA)} → {Quoted(techB)}");
            if (Attr(was, "description") is var descA && Attr(e, "description") is var descB && descA != descB)
                details.Add(string.IsNullOrEmpty(descA) ? "Description added" : string.IsNullOrEmpty(descB) ? "Description removed" : "Description changed");
            details.AddRange(TagDetails(tagsBefore.GetValueOrDefault(e.Id), tagsAfter.GetValueOrDefault(e.Id)));
            if (details.Count > 0) elements.Add(new(e.Id, ChangeKind.Changed, e, details));
        }
        foreach (var e in before.Elements)
            if (!afterById.ContainsKey(e.Id)) elements.Add(new(e.Id, ChangeKind.Removed, e, []));

        var linksBefore = ById(before.Links, l => l.Id);
        var linksAfter = ById(after.Links, l => l.Id);
        var links = new List<LinkChange>();
        foreach (var l in after.Links)
        {
            if (!linksBefore.TryGetValue(l.Id, out var was)) { links.Add(new(l.Id, ChangeKind.Added, l, [])); continue; }
            var details = new List<string>();
            if (was.FromId != l.FromId) details.Add($"Now from {NameAfter(l.FromId)} (was {NameBefore(was.FromId)})");
            if (was.ToId != l.ToId) details.Add($"Now to {NameAfter(l.ToId)} (was {NameBefore(was.ToId)})");
            foreach (var key in new[] { "payload", "kind", "direction", "label", "technology" })
            {
                var (a, b) = (Attr(was, key), Attr(l, key));
                if (a != b) details.Add($"{char.ToUpperInvariant(key[0])}{key[1..]} {Quoted(a)} → {Quoted(b)}");
            }
            details.AddRange(TagDetails(tagsBefore.GetValueOrDefault(l.Id), tagsAfter.GetValueOrDefault(l.Id)));
            if (details.Count > 0) links.Add(new(l.Id, ChangeKind.Changed, l, details));
        }
        foreach (var l in before.Links)
            if (!linksAfter.ContainsKey(l.Id)) links.Add(new(l.Id, ChangeKind.Removed, l, []));

        return new ModelChanges(elements, links);
    }

    /// <summary>An element kind in words: "Software System".</summary>
    public static string KindLabel(ArchElementKind kind) => kind switch
    {
        ArchElementKind.BoundedContext => "Bounded Context",
        ArchElementKind.SoftwareSystem => "Software System",
        ArchElementKind.UseCase => "Use Case",
        _ => kind.ToString(),
    };

    /// <summary>One line for the counts: "3 added · 1 removed · 2 changed", or "No changes".</summary>
    public static string DescribeCounts(ModelChanges c)
    {
        if (c.Total == 0) return "No changes";
        return string.Join(" · ", new[]
        {
            c.Added > 0 ? $"{c.Added} added" : null,
            c.Removed > 0 ? $"{c.Removed} removed" : null,
            c.Changed > 0 ? $"{c.Changed} changed" : null,
        }.Where(s => s is not null));
    }

    /// <summary>A link in words: "Authorise → Settle · Authorised".</summary>
    public static string DescribeLink(ArchLink l, Func<string, string> names)
    {
        var label = Attr(l, "payload") ?? Attr(l, "label") ?? Attr(l, "kind") ?? "";
        return $"{names(l.FromId)} → {names(l.ToId)}{(label.Length > 0 ? $" · {label}" : "")}";
    }

    /// <summary>A value in quotation marks, or <c>none</c>.</summary>
    public static string Quoted(string? value) => string.IsNullOrEmpty(value) ? "none" : $"“{value}”";

    private static void Moved(List<string> details, string label, string? from, string? to, Func<string, string> nameBefore, Func<string, string> nameAfter)
    {
        // An empty reference is no reference: "" and absent are the same, and naming nothing is not a move.
        if (string.IsNullOrEmpty(from) && string.IsNullOrEmpty(to) || from == to) return;
        if (string.IsNullOrEmpty(from)) details.Add($"{label} {nameAfter(to!)}");
        else if (string.IsNullOrEmpty(to)) details.Add($"No longer in {nameBefore(from)}");
        else details.Add($"{label} {nameAfter(to)} (was {nameBefore(from)})");
    }

    private static IEnumerable<string> TagDetails(ArchTag? before, ArchTag? after)
    {
        IEnumerable<string> Pair(string label, string? a, string? b) => a == b ? [] : [$"{label} {a ?? "none"} → {b ?? "none"}"];
        return Pair("Status", before?.Lifecycle?.Status, after?.Lifecycle?.Status)
            .Concat(Pair("Phase", before?.Lifecycle?.Phase, after?.Lifecycle?.Phase))
            .Concat(Pair("Squad", before?.Ownership?.Squad, after?.Ownership?.Squad))
            .Concat(Pair("Domain", before?.Ownership?.Domain, after?.Ownership?.Domain));
    }

    /// <summary>
    /// One tag per target. A target may have two <c>Tag.For</c> calls — a lifecycle in one, an ownership in
    /// the other — and the reader keeps both, so each part is taken from the last tag that has it.
    /// </summary>
    private static Dictionary<string, ArchTag> TagsOf(ArchModel model)
    {
        var map = new Dictionary<string, ArchTag>(StringComparer.Ordinal);
        foreach (var t in model.Tags)
            map[t.TargetId] = map.TryGetValue(t.TargetId, out var was)
                ? new ArchTag(t.TargetId, t.Lifecycle ?? was.Lifecycle, t.Ownership ?? was.Ownership)
                : t;
        return map;
    }

    private static string? Attr(ArchElement e, string key) => e.Attributes.GetValueOrDefault(key);
    private static string? Attr(ArchLink l, string key) => l.Attributes.GetValueOrDefault(key);

    /// <summary>By id, the first of each — a model read from two files that both declare an id keeps the first, as the merge does.</summary>
    private static Dictionary<string, T> ById<T>(IEnumerable<T> items, Func<T, string> id)
    {
        var map = new Dictionary<string, T>(StringComparer.Ordinal);
        foreach (var item in items) map.TryAdd(id(item), item);
        return map;
    }
}
