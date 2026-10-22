namespace Stemma.Model;

/// <summary>What sort of claim an <see cref="ArchitectureRule"/> makes (ADR-0028).</summary>
public enum ArchitectureRuleKind { Forbid, Only, Layers, Require, Use }

/// <summary>
/// One thing the architecture must satisfy, as <see cref="Rule"/> writes it.
///
/// Stemma reads rules off the syntax tree of the files in a <c>Rules/</c> folder and never runs them
/// (ADR-0028): what a rule says is its literal arguments. This record exists so that a workspace with
/// a project compiles, and so an engineer can test what a rule set holds.
/// </summary>
/// <param name="Id">The rule's id, as <c>stemma validate</c> reports it (<c>rule/&lt;id&gt;</c>); for <c>Use</c>, the pack's name.</param>
/// <param name="From">For <c>Forbid</c> and <c>Only</c>: a selector for where relationships start.</param>
/// <param name="To">For <c>Forbid</c> and <c>Only</c>: a selector for where they end.</param>
/// <param name="Layers">For <c>Layers</c>: one selector per layer, the top first.</param>
/// <param name="Of">For <c>Require</c>: a selector for what must have <paramref name="Has"/>; <c>link:dataFlow</c> selects links.</param>
/// <param name="Has">For <c>Require</c>: the attribute that must not be empty.</param>
/// <param name="Because">Why the rule holds, shown with every violation of it.</param>
/// <param name="Via">The relationships considered: <c>dataFlow</c>, <c>dependency</c>, or null for both.</param>
/// <param name="Severity"><c>error</c>, <c>warning</c> or <c>info</c>.</param>
public sealed record ArchitectureRule(
    ArchitectureRuleKind Kind,
    string Id,
    string? From = null,
    string? To = null,
    IReadOnlyList<string>? Layers = null,
    string? Of = null,
    string? Has = null,
    string? Because = null,
    string? Via = null,
    string Severity = "error");

/// <summary>
/// The architecture rules a workspace declares, beside the model they constrain (ADR-0028, F-024).
///
/// Selectors are the language views are written in (ADR-0026) without the neighbourhood forms:
/// <c>cnt_api</c>, <c>sys_shop.*</c>, <c>*</c>, <c>kind:container</c>, and any of those with filters such as
/// <c>[kind=spa|mobile]</c> or <c>[status!=deprecated]</c>. A relationship is a <see cref="DataFlow"/> or a
/// <see cref="Dependency"/>, as declared, from its <c>FromId</c> to its <c>ToId</c>; a <see cref="Relation"/>
/// claims nothing and is never checked. Ids are strings, so removing an element never breaks the build —
/// <c>stemma validate</c> reports a rule that names an id the model no longer has.
///
/// <code>
/// public static class ShopRules
/// {
///     public static RuleSet Define() => RuleSet.Of(
///         Rule.Use("c4"),
///         Rule.Only("rule_payments", from: "cnt_api", to: "sys_stripe",
///             because: "Card data stays inside one service"),
///         Rule.Require("rule_owned", of: "kind:container", has: "squad", severity: "warning"));
/// }
/// </code>
/// </summary>
public static class Rule
{
    /// <summary>No relationship from anything <paramref name="from"/> selects to anything <paramref name="to"/> selects.</summary>
    /// <param name="id">The rule's id, unique in the workspace.</param>
    /// <param name="from">A selector for where a forbidden relationship starts.</param>
    /// <param name="to">A selector for where it ends.</param>
    /// <param name="because">Why, shown with every violation.</param>
    /// <param name="via"><c>dataFlow</c>, <c>dependency</c>, or null for both.</param>
    /// <param name="severity"><c>error</c>, <c>warning</c> or <c>info</c>.</param>
    public static ArchitectureRule Forbid(string id, string from, string to, string? because = null, string? via = null, string severity = "error") =>
        new(ArchitectureRuleKind.Forbid, id, From: from, To: to, Because: because, Via: via, Severity: severity);

    /// <summary>Only what <paramref name="from"/> selects may have a relationship to what <paramref name="to"/> selects.</summary>
    /// <param name="id">The rule's id, unique in the workspace.</param>
    /// <param name="from">A selector for everything allowed to relate to <paramref name="to"/>.</param>
    /// <param name="to">A selector for what is guarded.</param>
    /// <param name="because">Why, shown with every violation.</param>
    /// <param name="via"><c>dataFlow</c>, <c>dependency</c>, or null for both.</param>
    /// <param name="severity"><c>error</c>, <c>warning</c> or <c>info</c>.</param>
    public static ArchitectureRule Only(string id, string from, string to, string? because = null, string? via = null, string severity = "error") =>
        new(ArchitectureRuleKind.Only, id, From: from, To: to, Because: because, Via: via, Severity: severity);

    /// <summary>
    /// Each element belongs to the first of <paramref name="layers"/> that selects it, and a relationship
    /// from a lower layer to a higher one is a violation; down or sideways is fine. An element no layer
    /// selects is not checked.
    /// </summary>
    /// <param name="id">The rule's id, unique in the workspace.</param>
    /// <param name="layers">One selector per layer, the top first.</param>
    /// <param name="because">Why, shown with every violation.</param>
    /// <param name="via"><c>dataFlow</c>, <c>dependency</c>, or null for both.</param>
    /// <param name="severity"><c>error</c>, <c>warning</c> or <c>info</c>.</param>
    public static ArchitectureRule Layers(string id, string[] layers, string? because = null, string? via = null, string severity = "error") =>
        new(ArchitectureRuleKind.Layers, id, Layers: layers, Because: because, Via: via, Severity: severity);

    /// <summary>
    /// Everything <paramref name="of"/> selects has a non-empty <paramref name="has"/>: an argument
    /// (<c>technology</c>, <c>description</c>, <c>kind</c>, …), <c>status</c> or <c>phase</c> from its
    /// lifecycle, <c>squad</c> or <c>domain</c> from its ownership. <c>link:dataFlow</c> or
    /// <c>link:dependency</c>, filtered or not, selects links instead (<c>payload</c>, <c>technology</c>, …).
    /// </summary>
    /// <param name="id">The rule's id, unique in the workspace.</param>
    /// <param name="of">A selector for what must have <paramref name="has"/>.</param>
    /// <param name="has">The attribute that must not be empty.</param>
    /// <param name="because">Why, shown with every violation.</param>
    /// <param name="severity"><c>error</c>, <c>warning</c> or <c>info</c>.</param>
    public static ArchitectureRule Require(string id, string of, string has, string? because = null, string severity = "warning") =>
        new(ArchitectureRuleKind.Require, id, Of: of, Has: has, Because: because, Severity: severity);

    /// <summary>
    /// Turns on a built-in pack of rules. <c>"c4"</c> is the C4 checklist: containers have a technology,
    /// people, systems and containers a description, data flows a payload and a technology.
    /// </summary>
    /// <param name="pack">The pack's name.</param>
    public static ArchitectureRule Use(string pack) => new(ArchitectureRuleKind.Use, pack);
}

/// <summary>Where the implementation lives, relative to the workspace (ADR-0029).</summary>
public sealed record CodeRoot(string Path);

/// <summary>The project, or the folder of projects, that implements an element, relative to <see cref="CodeRoot"/>.</summary>
public sealed record CodeMap(string ElementId, string Path);

/// <summary>
/// The map from the model to the code that implements it (ADR-0029, F-025), written in the same
/// <c>RuleSet.Of(...)</c> as the rules. Stemma compares the project references of what is mapped with
/// the data flows and dependencies the model declares, and reports where the two disagree.
///
/// <code>
/// Code.At("../src"),                                  // where the code is, relative to the workspace
/// Code.Map("cnt_api", "Shop.Api/Shop.Api.csproj"),    // a project file
/// Code.Map("cnt_worker", "Shop.Worker"),              // or a folder: every project in it
/// </code>
/// </summary>
public static class Code
{
    /// <summary>Where the implementation lives, relative to the workspace. Without it, the workspace itself.</summary>
    /// <param name="path">A folder, relative to the workspace.</param>
    public static CodeRoot At(string path) => new(path);

    /// <summary>The element <paramref name="id"/> is implemented by the project at <paramref name="path"/>, or by every project in that folder.</summary>
    /// <param name="id">A container or a module.</param>
    /// <param name="path">A <c>.csproj</c> or a folder, relative to <see cref="At"/>.</param>
    public static CodeMap Map(string id, string path) => new(id, path);
}

/// <summary>What a <c>Rules/*.cs</c> file's <c>Define()</c> returns: its rules and its code map.</summary>
public sealed class RuleSet
{
    public IReadOnlyList<ArchitectureRule> Rules { get; init; } = [];
    public IReadOnlyList<CodeRoot> CodeRoots { get; init; } = [];
    public IReadOnlyList<CodeMap> CodeMaps { get; init; } = [];

    /// <summary>Collect rules (<c>Rule.…</c>) and the code map (<c>Code.…</c>) into a set.</summary>
    /// <exception cref="ArgumentException">An item that is neither.</exception>
    public static RuleSet Of(params object[] items)
    {
        var rules = new List<ArchitectureRule>();
        var roots = new List<CodeRoot>();
        var maps = new List<CodeMap>();
        foreach (var item in items)
        {
            switch (item)
            {
                case ArchitectureRule r: rules.Add(r); break;
                case CodeRoot c: roots.Add(c); break;
                case CodeMap m: maps.Add(m); break;
                default:
                    throw new ArgumentException($"RuleSet.Of takes rules (Rule.…) and the code map (Code.…), not {item?.GetType().Name ?? "null"}", nameof(items));
            }
        }
        return new RuleSet { Rules = rules, CodeRoots = roots, CodeMaps = maps };
    }
}
