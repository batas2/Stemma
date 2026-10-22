using Stemma.Engine.ArchModel;

namespace Stemma.Engine.Validation;

/// <summary>
/// The C4 checklist, as rules a workspace turns on with <c>Rule.Use("c4")</c> (F-024 AC6). A workspace that
/// does not ask is not judged by them (ADR-0028 decision 5): a figure of Concepts has no containers to
/// describe. Each says what C4 asks of a diagram's boxes and lines, from its notation guide:
///
/// <list type="bullet">
/// <item><c>c4/container-technology</c> (warning) — a container says what it is built with.</item>
/// <item><c>c4/described</c> (info) — a person, a software system and a container say in a sentence what they are.</item>
/// <item><c>c4/flow-technology</c> (info) — a data flow between parts of systems says how it travels. A flow from or
/// to a person is not asked: someone using an app does so over no protocol, and C4's own examples leave it off.</item>
/// <item><c>c4/flow-labelled</c> (warning) — a data flow says what it carries.</item>
/// </list>
///
/// <c>view/mixed-levels</c>, a view drawing containers and modules together, is the pack's too; it is
/// about views, which only <c>stemma validate</c> resolves, so it is reported there.
/// </summary>
internal static class C4Pack
{
    public const string Name = "c4";
    public const string ContainerTechnology = "c4/container-technology";
    public const string Described = "c4/described";
    public const string FlowTechnology = "c4/flow-technology";
    public const string FlowLabelled = "c4/flow-labelled";

    public static readonly IReadOnlyList<string> Ids = [ContainerTechnology, Described, FlowTechnology, FlowLabelled];

    public static IReadOnlyList<IRule> Rules(PerModel<SelectorScope> scopes) =>
    [
        new PackRule(ContainerTechnology, Severity.Warning, "A container says what it is built with.", scopes, ContainerTechnologyCheck),
        new PackRule(Described, Severity.Info, "A person, a software system and a container say in a sentence what they are.", scopes, DescribedCheck),
        new PackRule(FlowTechnology, Severity.Info, "A data flow between parts of systems says how it travels.", scopes, FlowTechnologyCheck),
        new PackRule(FlowLabelled, Severity.Warning, "A data flow says what it carries.", scopes, FlowLabelledCheck),
    ];

    private static IEnumerable<Violation> ContainerTechnologyCheck(PackRule rule, SelectorScope scope) =>
        scope.Elements
            .Where(e => e.Kind == ArchElementKind.Container && Empty(scope.Attribute(e, "technology")))
            .Select(e => rule.Violation(
                $"container {e.Id} has no technology; a C4 container says what it is built with (Technology: \".NET 8\", \"PostgreSQL\")", [e.Id], []));

    private static IEnumerable<Violation> DescribedCheck(PackRule rule, SelectorScope scope) =>
        scope.Elements
            .Where(e => e.Kind is ArchElementKind.Person or ArchElementKind.SoftwareSystem or ArchElementKind.Container
                        && Empty(scope.Attribute(e, "description")))
            .Select(e => rule.Violation(
                $"{KindName(e.Kind)} {e.Id} has no description; a C4 {KindName(e.Kind)} says in a sentence what it is (Description: \"…\")", [e.Id], []));

    private static IEnumerable<Violation> FlowTechnologyCheck(PackRule rule, SelectorScope scope) =>
        scope.Links
            .Where(l => l.Kind == ArchLinkKind.DataFlow
                        && scope.Element(l.FromId)!.Kind != ArchElementKind.Person && scope.Element(l.ToId)!.Kind != ArchElementKind.Person
                        && Empty(scope.LinkAttribute(l, "technology")))
            .Select(l => rule.Violation(
                $"data flow {l.Id} from {l.FromId} to {l.ToId} has no technology; C4 labels a relationship between parts of systems with how it travels (Technology: \"HTTPS/JSON\")",
                [l.FromId, l.ToId], [l.Id]));

    private static IEnumerable<Violation> FlowLabelledCheck(PackRule rule, SelectorScope scope) =>
        scope.Links
            .Where(l => l.Kind == ArchLinkKind.DataFlow && Empty(scope.LinkAttribute(l, "payload")))
            .Select(l => rule.Violation(
                $"data flow {l.Id} from {l.FromId} to {l.ToId} has no payload; C4 labels every relationship with what it carries",
                [l.FromId, l.ToId], [l.Id]));

    private static bool Empty(string? value) => string.IsNullOrWhiteSpace(value);

    private static string KindName(ArchElementKind kind) => kind switch
    {
        ArchElementKind.SoftwareSystem => "software system",
        _ => kind.ToString().ToLowerInvariant(),
    };

    /// <summary>One of the pack's rules: an id, a severity, and a check over the model's selector scope.</summary>
    internal sealed class PackRule(
        string id, Severity severity, string description, PerModel<SelectorScope> scopes,
        Func<PackRule, SelectorScope, IEnumerable<Violation>> check) : IRule
    {
        public string Id => id;
        public Severity DefaultSeverity => severity;
        public string Description => description;
        public IEnumerable<Violation> Check(ArchModel.ArchModel model) => check(this, scopes.For(model));
        public Violation Violation(string message, IReadOnlyList<string> elementIds, IReadOnlyList<string> linkIds) =>
            new(id, severity, message, elementIds, linkIds);
    }
}
