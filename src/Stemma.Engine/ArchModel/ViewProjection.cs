using Stemma.Engine.Validation;

namespace Stemma.Engine.ArchModel;

/// <summary>
/// A relationship drawn between two elements of a view that the model does not relate directly: one
/// end, or both, is a container the view shows as its system. Derived, never stored (ADR-0026).
/// </summary>
/// <param name="Id"><c>__implied__&lt;from&gt;__&lt;to&gt;</c> — not a link id, and never editable.</param>
/// <param name="LinkIds">The model's links it stands for, in the order the model declares them.</param>
public sealed record ImpliedLink(string Id, string FromId, string ToId, IReadOnlyList<string> LinkIds);

/// <summary>Something wrong with how a view is written: its scope, a rule, a member.</summary>
/// <param name="Rule">As <c>stemma validate</c> names it: <c>view/bad-scope</c>, <c>view/bad-selector</c>, ….</param>
/// <param name="ElementId">The id the problem is about, when there is one.</param>
public sealed record ViewProblem(string Rule, Severity Severity, string Message, string? ElementId = null);

/// <summary>What a view draws, resolved from its lens, its list and its rules.</summary>
/// <param name="Members">Lens members, then the listed ids, then what the includes select, minus what the excludes select.</param>
/// <param name="Provenance">What brought each member in: <c>lens</c>, <c>elementIds</c>, or <c>include:&lt;selector&gt;</c>.</param>
/// <param name="LinkIds">The links drawn: both ends members.</param>
/// <param name="Implied">For a C4 lens, the relationships drawn to a container's system.</param>
/// <param name="LeftOut">Links with one end in the view and nothing drawn for them — the half-links.</param>
public sealed record ViewResolution(
    IReadOnlyList<string> Members,
    IReadOnlyDictionary<string, string> Provenance,
    IReadOnlyList<string> LinkIds,
    IReadOnlyList<ImpliedLink> Implied,
    IReadOnlyList<string> LeftOut,
    IReadOnlyList<ViewProblem> Problems);

/// <summary>
/// The one answer to "what does this view draw" (ADR-0026). The canvas gets it from the API, and
/// <c>validate</c>, <c>render</c>, <c>inspect</c> and the draw.io export use it, so a view is never
/// resolved two ways. A pure function of the view and the model.
///
/// The two C4 lenses take a <c>Scope</c> naming a software system (F-023 AC2–AC3). <c>systemContext</c>
/// draws the system and every person and software system related to it or to one of its containers.
/// <c>container</c> draws the system around its containers, and every person, software system and
/// other system's container related to them. A container that is not in the view but whose system
/// is — the scope's own in a system context, another system's in either — is drawn as its system:
/// its relationships are lifted to it as implied links, one per pair of ends in each direction,
/// unless a real link already joins those two ends that way. The other lenses add no members: their
/// members are the list and the rules, and the canvas keeps only the kinds the lens draws.
/// </summary>
public static class ViewProjection
{
    /// <summary>The lenses drawn around a software system.</summary>
    public static bool IsC4Lens(string baseView) => baseView is "systemContext" or "container";

    public static ViewResolution Resolve(ArchView view, ArchModel model) => Resolve(view, new SelectorScope(model));

    internal static ViewResolution Resolve(ArchView view, SelectorScope scope)
    {
        var problems = new List<ViewProblem>();
        var provenance = new Dictionary<string, string>(StringComparer.Ordinal);
        var members = new List<string>();
        void Add(string id, string source)
        {
            if (provenance.TryAdd(id, source)) members.Add(id);
        }

        var system = ScopeOf(view, scope, problems);
        if (system is not null)
            foreach (var id in scope.InModelOrder(LensMembers(view.BaseView, system, scope)))
                Add(id, "lens");

        foreach (var id in view.ElementIds)
        {
            if (scope.Element(id) is not null) Add(id, "elementIds");
            else problems.Add(new("view/dangling-member", Severity.Error, $"view '{view.Id}' lists '{id}', which is not an element", id));
        }

        // Every include's selection, in the order the model declares them; each member credited to the
        // first include that selected it.
        var included = new Dictionary<string, string>(StringComparer.Ordinal);
        foreach (var text in view.Include ?? [])
        {
            if (Parse(view, text, "includes", problems) is not { } selector) continue;
            var selected = selector.Select(scope);
            if (selector.NamedId is { } named && scope.Element(named) is null)
                problems.Add(new("view/dangling-include", Severity.Error,
                    $"view '{view.Id}' includes \"{text}\", but '{named}' is not an element, so it brings in nothing", named));
            else if (selected.Count == 0)
                problems.Add(new("view/dangling-include", Severity.Warning,
                    $"view '{view.Id}' includes \"{text}\", which selects nothing in the model"));
            foreach (var id in selected) included.TryAdd(id, $"include:{text}");
        }
        foreach (var id in scope.InModelOrder(included.Keys)) Add(id, included[id]);

        var excluded = new HashSet<string>(StringComparer.Ordinal);
        foreach (var text in view.Exclude ?? [])
        {
            if (Parse(view, text, "excludes", problems) is not { } selector) continue;
            if (selector.IsPlainId && scope.Element(selector.NamedId!) is null)
                problems.Add(new("view/dangling-exclude", Severity.Warning,
                    $"view '{view.Id}' excludes '{selector.NamedId}', which is not an element, so the exclude does nothing", selector.NamedId));
            excluded.UnionWith(selector.Select(scope));
        }
        members.RemoveAll(excluded.Contains);
        foreach (var id in excluded) provenance.Remove(id);

        var (drawn, implied, leftOut) = Links(members.ToHashSet(StringComparer.Ordinal), scope, lifting: system is not null);
        return new ViewResolution(members, provenance, drawn, implied, leftOut, problems);
    }

    /// <summary>The software system a C4 lens is drawn around, or null — with the problem said — when there is none.</summary>
    private static ArchElement? ScopeOf(ArchView view, SelectorScope scope, List<ViewProblem> problems)
    {
        var written = string.IsNullOrEmpty(view.Scope) ? null : view.Scope;
        if (!IsC4Lens(view.BaseView))
        {
            if (written is not null)
                problems.Add(new("view/bad-scope", Severity.Warning,
                    $"view '{view.Id}' has Scope '{written}', which the {view.BaseView} lens does not use, so it is ignored " +
                    "(a scope is for the systemContext and container lenses)", written));
            return null;
        }
        if (written is null)
        {
            problems.Add(new("view/bad-scope", Severity.Error,
                $"view '{view.Id}' uses the {view.BaseView} lens, which is drawn around a software system, and has no Scope; " +
                "write Scope: \"<system id>\""));
            return null;
        }
        var element = scope.Element(written);
        if (element is { Kind: ArchElementKind.SoftwareSystem }) return element;
        problems.Add(new("view/bad-scope", Severity.Error, element is null
            ? $"view '{view.Id}' has Scope '{written}', which is not an element, so the {view.BaseView} lens draws nothing"
            : $"view '{view.Id}' has Scope '{written}', which is a {element.Kind}, not a software system, so the {view.BaseView} lens draws nothing",
            written));
        return null;
    }

    private static Selector? Parse(ArchView view, string text, string verb, List<ViewProblem> problems)
    {
        if (Selector.TryParse(text, out var selector, out var error)) return selector;
        problems.Add(new("view/bad-selector", Severity.Error,
            $"view '{view.Id}' {verb} \"{text}\", which is not a selector: {error.Message} (character {error.Position})"));
        return null;
    }

    /// <summary>
    /// A C4 lens's members: the system, its containers for the container lens, and what relates to
    /// either — a person or a software system as itself, another system's container as its system.
    /// </summary>
    private static IEnumerable<string> LensMembers(string lens, ArchElement system, SelectorScope scope)
    {
        var inner = scope.ChildrenOf(system.Id).Where(e => e.Kind == ArchElementKind.Container).Select(e => e.Id)
            .Append(system.Id).ToHashSet(StringComparer.Ordinal);
        var members = new HashSet<string>(StringComparer.Ordinal) { system.Id };
        if (lens == "container") members.UnionWith(inner);

        foreach (var link in scope.Model.Links)
        {
            foreach (var (near, far) in new[] { (link.FromId, link.ToId), (link.ToId, link.FromId) })
            {
                if (!inner.Contains(near) || inner.Contains(far) || scope.Element(far) is not { } other) continue;
                if (other.Kind is ArchElementKind.Person or ArchElementKind.SoftwareSystem) members.Add(other.Id);
                else if (SystemOf(other, scope) is { } otherSystem) members.Add(otherSystem.Id);
            }
        }
        return members;
    }

    /// <summary>The software system a container belongs to, when it is one in the model.</summary>
    private static ArchElement? SystemOf(ArchElement element, SelectorScope scope) =>
        element.Kind == ArchElementKind.Container
        && element.Attributes.GetValueOrDefault("systemId") is { Length: > 0 } id
        && scope.Element(id) is { Kind: ArchElementKind.SoftwareSystem } system
            ? system
            : null;

    /// <summary>
    /// The links drawn, the implied links, and the links left out. Lifting is for the C4 lenses: an
    /// end that is not in the view but whose system is stands for its system. A link lifted onto a
    /// pair a real link already joins in that direction is said by the real one; a link both of
    /// whose ends lift to one element is inside it. Neither is left out. A link lifted onto a container
    /// and its own system — to a container excluded from the view — draws nothing: an arrow from a
    /// card to the boundary around it says nothing about either.
    /// </summary>
    private static (IReadOnlyList<string> Drawn, IReadOnlyList<ImpliedLink> Implied, IReadOnlyList<string> LeftOut) Links(
        HashSet<string> members, SelectorScope scope, bool lifting)
    {
        var links = scope.Model.Links;
        var drawn = links.Where(l => members.Contains(l.FromId) && members.Contains(l.ToId)).ToList();
        var joined = drawn.Select(l => (l.FromId, l.ToId)).ToHashSet();
        var implied = new Dictionary<(string From, string To), List<string>>();
        var order = new List<(string From, string To)>();
        var accounted = new HashSet<string>(StringComparer.Ordinal);

        string? Lift(string id) =>
            members.Contains(id) ? id
            : lifting && scope.Element(id) is { } e && SystemOf(e, scope) is { } system && members.Contains(system.Id) ? system.Id
            : null;
        bool IsSystemOf(string system, string container) =>
            scope.Element(container) is { } e && SystemOf(e, scope)?.Id == system;

        if (lifting)
        {
            foreach (var link in links)
            {
                if (members.Contains(link.FromId) && members.Contains(link.ToId)) continue;
                if (Lift(link.FromId) is not { } from || Lift(link.ToId) is not { } to) continue;
                if (from != to && (IsSystemOf(from, to) || IsSystemOf(to, from))) continue;
                accounted.Add(link.Id);
                if (from == to || joined.Contains((from, to))) continue;
                if (!implied.TryGetValue((from, to), out var standsFor))
                {
                    implied[(from, to)] = standsFor = [];
                    order.Add((from, to));
                }
                standsFor.Add(link.Id);
            }
        }

        var leftOut = links
            .Where(l => members.Contains(l.FromId) ^ members.Contains(l.ToId) && !accounted.Contains(l.Id))
            .Select(l => l.Id)
            .ToList();
        return (drawn.Select(l => l.Id).ToList(),
            order.Select(p => new ImpliedLink($"__implied__{p.From}__{p.To}", p.From, p.To, implied[p])).ToList(),
            leftOut);
    }
}
