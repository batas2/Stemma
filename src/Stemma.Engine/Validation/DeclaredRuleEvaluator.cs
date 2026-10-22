using Stemma.Engine.ArchModel;

namespace Stemma.Engine.Validation;

/// <summary>
/// What each declared rule says (F-024 AC2), as a pure function of the rule and the model.
///
/// A relationship is a data flow or a dependency between two elements of the model, as declared — from
/// its <c>FromId</c> to its <c>ToId</c>; a two-way flow is still one relationship, from where it is written
/// from. <c>via</c> narrows them to one of the two kinds. A <c>Relation</c> claims nothing and is never
/// one. Each violation names the elements and the link by id, so the canvas marks them, and ends with
/// the rule's <c>because</c>, so whoever reads it knows what is at stake.
/// </summary>
public static class DeclaredRuleEvaluator
{
    public static IReadOnlyList<Violation> Evaluate(DeclaredRule rule, ArchModel.ArchModel model) =>
        Evaluate(rule, new SelectorScope(model)).ToList();

    internal static IEnumerable<Violation> Evaluate(DeclaredRule rule, SelectorScope scope) => rule.Kind switch
    {
        DeclaredRuleKind.Forbid => Forbid(rule, scope),
        DeclaredRuleKind.Only => Only(rule, scope),
        DeclaredRuleKind.Layers => Layers(rule, scope),
        _ => Require(rule, scope),
    };

    /// <summary>No relationship from anything <c>from</c> selects to anything <c>to</c> selects.</summary>
    private static IEnumerable<Violation> Forbid(DeclaredRule rule, SelectorScope scope)
    {
        var from = Selected(rule.From!, scope);
        var to = Selected(rule.To!, scope);
        foreach (var link in Relationships(rule, scope).Where(l => from.Contains(l.FromId) && to.Contains(l.ToId)))
            yield return Broken(rule, link,
                $"{Describe(link)} is forbidden: nothing \"{rule.From}\" selects may relate to what \"{rule.To}\" selects");
    }

    /// <summary>Only what <c>from</c> selects may have a relationship to what <c>to</c> selects.</summary>
    private static IEnumerable<Violation> Only(DeclaredRule rule, SelectorScope scope)
    {
        var from = Selected(rule.From!, scope);
        var to = Selected(rule.To!, scope);
        foreach (var link in Relationships(rule, scope).Where(l => to.Contains(l.ToId) && !from.Contains(l.FromId)))
            yield return Broken(rule, link,
                $"{Describe(link)} is not allowed: only what \"{rule.From}\" selects may relate to what \"{rule.To}\" selects");
    }

    /// <summary>
    /// Each element is in the first layer that selects it, the top layer first; a relationship from a
    /// lower layer to a higher one is a violation. Down and sideways are fine, and an element no layer
    /// selects is not checked.
    /// </summary>
    private static IEnumerable<Violation> Layers(DeclaredRule rule, SelectorScope scope)
    {
        var layerOf = new Dictionary<string, int>(StringComparer.Ordinal);
        for (var i = 0; i < rule.Layers.Count; i++)
            foreach (var id in Selected(rule.Layers[i], scope))
                layerOf.TryAdd(id, i);
        foreach (var link in Relationships(rule, scope))
        {
            if (!layerOf.TryGetValue(link.FromId, out var from) || !layerOf.TryGetValue(link.ToId, out var to) || from <= to) continue;
            yield return Broken(rule, link,
                $"{Describe(link)} goes up the layers, from layer {from + 1} (\"{rule.Layers[from]}\") to layer {to + 1} (\"{rule.Layers[to]}\")");
        }
    }

    /// <summary>Everything <c>of</c> selects — elements, or links for <c>link:</c> — has a non-empty <c>has</c>.</summary>
    private static IEnumerable<Violation> Require(DeclaredRule rule, SelectorScope scope)
    {
        var of = Parse(rule.Of!, links: true);
        var has = rule.Has!;
        if (of.IsLinkSelector)
        {
            foreach (var link in of.SelectLinks(scope).Where(l => string.IsNullOrWhiteSpace(scope.LinkAttribute(l, has))))
                yield return new Violation(rule.Id, rule.Severity,
                    $"{Describe(link)} has no {has}, which every \"{rule.Of}\" must have{Because(rule)}",
                    [link.FromId, link.ToId], [link.Id]);
            yield break;
        }
        foreach (var id in of.Select(scope))
        {
            if (!string.IsNullOrWhiteSpace(scope.Attribute(scope.Element(id)!, has))) continue;
            yield return new Violation(rule.Id, rule.Severity,
                $"{id} has no {has}, which everything \"{rule.Of}\" selects must have{Because(rule)}", [id], []);
        }
    }

    /// <summary>
    /// The ids the rules and the code map name that are not elements (<c>rule/dangling-id</c>): a rule
    /// about an element that is not there checks nothing about it, which is never what it was written for.
    /// </summary>
    internal static IEnumerable<Violation> DanglingIds(DeclaredRules declared, SelectorScope scope)
    {
        foreach (var rule in declared.Rules)
        {
            var label = $"Rule.{rule.Kind}(\"{rule.Id}\")";
            var selectors = new List<(string Parameter, string Text)>();
            if (rule.From is { } from) selectors.Add(("from", from));
            if (rule.To is { } to) selectors.Add(("to", to));
            selectors.AddRange(rule.Layers.Select((layer, i) => ($"layer {i + 1}", layer)));
            if (rule.Of is { } of) selectors.Add(("of", of));
            foreach (var (parameter, text) in selectors)
            {
                if (Parse(text, links: parameter == "of").NamedId is not { } named || scope.Element(named) is not null) continue;
                yield return new Violation(DeclaredRules.DanglingId, Severity.Error,
                    $"{rule.File}:{rule.Line}: the {parameter} of {label} names '{named}', which is not an element, so the rule checks nothing there", [], []);
            }
        }
        foreach (var map in declared.CodeMaps.Where(m => scope.Element(m.ElementId) is null))
            yield return new Violation(DeclaredRules.DanglingId, Severity.Error,
                $"{map.File}:{map.Line}: Code.Map names '{map.ElementId}', which is not an element, so its code is compared with nothing", [], []);
    }

    /// <summary>The data flows and dependencies between elements of the model that the rule considers.</summary>
    private static IEnumerable<ArchLink> Relationships(DeclaredRule rule, SelectorScope scope) =>
        scope.Links.Where(l => l.Kind != ArchLinkKind.Relation && (rule.Via is null || l.Kind == rule.Via));

    private static HashSet<string> Selected(string text, SelectorScope scope) =>
        Parse(text, links: false).Select(scope).ToHashSet(StringComparer.Ordinal);

    /// <summary>A selector the reader has already read: one it could not is a problem, never a rule.</summary>
    private static Selector Parse(string text, bool links) =>
        Selector.TryParse(text, out var selector, out var error, allowNeighbours: false, allowLinks: links)
            ? selector
            : throw new InvalidOperationException($"\"{text}\" is not a selector: {error.Message}");

    private static Violation Broken(DeclaredRule rule, ArchLink link, string message) =>
        new(rule.Id, rule.Severity, message + Because(rule), [link.FromId, link.ToId], [link.Id]);

    private static string Describe(ArchLink link) =>
        $"{(link.Kind == ArchLinkKind.DataFlow ? "data flow" : "dependency")} {link.Id} from {link.FromId} to {link.ToId}";

    private static string Because(DeclaredRule rule) => rule.Because is { } because ? $" — {because}" : "";
}
