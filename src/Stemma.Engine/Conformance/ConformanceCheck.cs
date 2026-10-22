using Stemma.Engine.ArchModel;
using Stemma.Engine.Validation;

namespace Stemma.Engine.Conformance;

/// <summary>
/// Where the model and the code disagree (ADR-0029, F-025 AC2). The rules files map elements to the
/// projects that implement them — <c>Code.At</c> names where the code is, relative to the workspace,
/// and <c>Code.Map(id, path)</c> a <c>.csproj</c>, or a folder whose projects are all the element's,
/// relative to that. A <c>ProjectReference</c> from a project of A to a project of B, A and B mapped and
/// different, is a relationship in the code. Then:
///
/// <list type="bullet">
/// <item><c>conformance/undeclared-dependency</c> (warning) — the code has A → B, and the model has no data
/// flow or dependency from A to B. A data flow counts as declaring it: a caller usually references
/// its callee's client library, and a model written in flows should not drown in findings.</item>
/// <item><c>conformance/unrealised-dependency</c> (info) — the model has a <c>Dependency</c> A → B, and no
/// project of A references a project of B. A data flow is not expected to be one: a call over HTTP is
/// not a project reference.</item>
/// <item><c>conformance/missing-code</c> (error) — <c>Code.At</c> or a mapped path does not exist, holds no
/// project, or holds one that cannot be read.</item>
/// <item><c>conformance/ambiguous-map</c> (warning) — one project mapped to two elements; its references
/// are compared for neither.</item>
/// <item><c>conformance/unmapped-project</c> (info) — the projects under <c>Code.At</c> nothing maps, at most
/// ten named and then a count. Not listed while a map points at nothing: the projects under it are then
/// not the ones the map describes — a copy of the workspace taken away from its code — and the walk
/// would be of whatever happens to be there.</item>
/// </list>
///
/// Results are violations, recomputed on every ask and never kept (ADR-0029 decision 3); project files
/// are parsed again only when they change (<see cref="ProjectGraph"/>).
/// </summary>
public static class ConformanceCheck
{
    public const string UndeclaredDependency = "conformance/undeclared-dependency";
    public const string UnrealisedDependency = "conformance/unrealised-dependency";
    public const string MissingCode = "conformance/missing-code";
    public const string AmbiguousMap = "conformance/ambiguous-map";
    public const string UnmappedProject = "conformance/unmapped-project";

    public static readonly IReadOnlyList<string> Ids = [UndeclaredDependency, UnrealisedDependency, MissingCode, AmbiguousMap, UnmappedProject];

    /// <summary>How many unmapped projects are named before the rest are counted.</summary>
    public const int UnmappedNamed = 10;

    public static IReadOnlyList<Violation> Run(ArchModel.ArchModel model, string workspaceRoot, DeclaredRules declared)
    {
        var violations = new List<Violation>();
        var workspace = Path.GetFullPath(workspaceRoot);
        var at = declared.CodeRoots.FirstOrDefault();
        var root = Path.GetFullPath(at?.Path ?? ".", workspace);
        string Shown(string path) => Path.GetRelativePath(root, path).Replace('\\', '/');
        var where = at is null ? "the workspace" : $"Code.At(\"{at.Path}\")";
        if (!Directory.Exists(root))
        {
            violations.Add(new(MissingCode, Severity.Error,
                $"{(at is null ? "" : $"{at.File}:{at.Line}: ")}{where} is {root}, which does not exist, so no code is compared with the model", [], []));
            return violations;
        }

        var elements = model.Elements.Select(e => e.Id).ToHashSet(StringComparer.Ordinal);
        var owners = new Dictionary<string, List<string>>(ProjectGraph.PathComparer);
        var projectsOf = new Dictionary<string, List<string>>(StringComparer.Ordinal);
        var mapsMissing = false;
        foreach (var map in declared.CodeMaps.Where(m => elements.Contains(m.ElementId)))
        {
            var full = Path.GetFullPath(map.Path, root);
            IReadOnlyList<string> found = File.Exists(full) ? [full] : ProjectGraph.ProjectFilesUnder(full);
            var problem = File.Exists(full)
                ? full.EndsWith(".csproj", StringComparison.OrdinalIgnoreCase) ? null : "which is a file but not a project file"
                : Directory.Exists(full)
                    ? found.Count > 0 ? null : "which holds no project"
                    : "which does not exist";
            if (problem is not null)
            {
                mapsMissing = true;
                violations.Add(new(MissingCode, Severity.Error,
                    $"{map.File}:{map.Line}: Code.Map(\"{map.ElementId}\", \"{map.Path}\") points at {Shown(full)}, {problem}, so {map.ElementId} is compared with no code",
                    [map.ElementId], []));
                continue;
            }
            foreach (var project in found)
            {
                var owner = owners.TryGetValue(project, out var list) ? list : owners[project] = [];
                if (!owner.Contains(map.ElementId)) owner.Add(map.ElementId);
                var mine = projectsOf.TryGetValue(map.ElementId, out var p) ? p : projectsOf[map.ElementId] = [];
                if (!mine.Contains(project, ProjectGraph.PathComparer)) mine.Add(project);
            }
        }

        var projects = owners.Keys.Order(ProjectGraph.PathComparer).ToDictionary(path => path, ProjectGraph.ReadProject, ProjectGraph.PathComparer);
        foreach (var (path, info) in projects.Where(p => p.Value.Problem is not null))
            violations.Add(new(MissingCode, Severity.Error,
                $"{Shown(path)}, mapped to {string.Join(" and ", owners[path])}, could not be read ({info.Problem}), so its references are not compared",
                owners[path], []));
        foreach (var (path, owner) in owners.Where(o => o.Value.Count > 1).OrderBy(o => o.Key, ProjectGraph.PathComparer))
            violations.Add(new(AmbiguousMap, Severity.Warning,
                $"{Shown(path)} is mapped to {string.Join(" and ", owner)}, so its references are compared for neither; map it to one", owner, []));

        // The code's relationships: each reference from a project of one element to a project of another.
        var single = owners.Where(o => o.Value.Count == 1).ToDictionary(o => o.Key, o => o.Value[0], ProjectGraph.PathComparer);
        var inCode = new Dictionary<(string From, string To), List<(ProjectInfo From, ProjectInfo To)>>();
        foreach (var (path, from) in single.OrderBy(s => s.Key, ProjectGraph.PathComparer))
        {
            foreach (var reference in projects[path].References)
            {
                if (!single.TryGetValue(reference.Path, out var to) || to == from) continue;
                var evidence = inCode.TryGetValue((from, to), out var e) ? e : inCode[(from, to)] = [];
                evidence.Add((projects[path], projects[reference.Path]));
            }
        }

        var relationships = model.Links.Where(l => l.Kind is ArchLinkKind.DataFlow or ArchLinkKind.Dependency).ToList();
        var declaredPairs = relationships.Select(l => (l.FromId, l.ToId)).ToHashSet();
        foreach (var ((from, to), evidence) in inCode.Where(c => !declaredPairs.Contains(c.Key)))
        {
            var (p, q) = evidence[0];
            var more = evidence.Count > 1 ? $" (and {evidence.Count - 1} more reference(s) between their projects)" : "";
            violations.Add(new(UndeclaredDependency, Severity.Warning,
                $"{p.Name} references {q.Name} ({Shown(p.Path)} → {Shown(q.Path)}){more}, so {from} depends on {to} in the code, " +
                $"and the model has no data flow or dependency from {from} to {to}",
                [from, to], []));
        }

        foreach (var dependency in relationships.Where(l => l.Kind == ArchLinkKind.Dependency && l.FromId != l.ToId).DistinctBy(l => l.Id))
        {
            if (!projectsOf.TryGetValue(dependency.FromId, out var mine) || !projectsOf.TryGetValue(dependency.ToId, out var theirs)) continue;
            var targets = theirs.ToHashSet(ProjectGraph.PathComparer);
            if (mine.Any(path => projects[path].References.Any(r => targets.Contains(r.Path)))) continue;
            violations.Add(new(UnrealisedDependency, Severity.Info,
                $"dependency {dependency.Id} says {dependency.FromId} depends on {dependency.ToId}, and no project of {dependency.FromId} " +
                $"({string.Join(", ", mine.Select(m => projects[m].Name))}) references a project of {dependency.ToId} " +
                $"({string.Join(", ", theirs.Select(t => projects[t].Name))})",
                [dependency.FromId, dependency.ToId], [dependency.Id]));
        }

        if (!mapsMissing)
        {
            var unmapped = ProjectGraph.ProjectFilesUnder(root).Where(p => !owners.ContainsKey(p)).Select(Shown).ToList();
            if (unmapped.Count > 0)
            {
                var named = string.Join(", ", unmapped.Take(UnmappedNamed));
                var rest = unmapped.Count > UnmappedNamed ? $", and {unmapped.Count - UnmappedNamed} more" : "";
                violations.Add(new(UnmappedProject, Severity.Info,
                    $"{unmapped.Count} project(s) under {where} {(unmapped.Count == 1 ? "is" : "are")} mapped to no element: {named}{rest}", [], []));
            }
        }
        return violations;
    }

    /// <summary>One rule per finding, so <c>stemma.rules.json</c> can quieten each; the comparison is made once per model.</summary>
    internal static IReadOnlyList<IRule> Rules(string workspaceRoot, DeclaredRules declared)
    {
        var shared = new PerModel<IReadOnlyList<Violation>>(model => Run(model, workspaceRoot, declared));
        return
        [
            new Finding(UndeclaredDependency, Severity.Warning, "A project reference between two elements is declared by a data flow or a dependency.", shared),
            new Finding(UnrealisedDependency, Severity.Info, "A dependency between two mapped elements is realised by a project reference.", shared),
            new Finding(MissingCode, Severity.Error, "Every mapped path holds a project.", shared),
            new Finding(AmbiguousMap, Severity.Warning, "A project is mapped to one element.", shared),
            new Finding(UnmappedProject, Severity.Info, "Every project under Code.At is mapped to an element.", shared),
        ];
    }

    private sealed class Finding(string id, Severity severity, string description, PerModel<IReadOnlyList<Violation>> shared) : IRule
    {
        public string Id => id;
        public Severity DefaultSeverity => severity;
        public string Description => description;
        public IEnumerable<Violation> Check(ArchModel.ArchModel model) => shared.For(model).Where(v => v.RuleId == id);
    }
}
