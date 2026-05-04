using Verso.Engine.ArchModel;

namespace Verso.Engine.Validation;

[VersoRule("link-endpoints-exist", Severity.Error, "Every link must reference existing elements.")]
public sealed class LinkEndpointsExist : IRule
{
    public string Id => "link-endpoints-exist";
    public Severity DefaultSeverity => Severity.Error;
    public string Description => "Every link must reference existing elements.";

    public IEnumerable<Violation> Check(ArchModel.ArchModel model)
    {
        var ids = model.Elements.Select(e => e.Id).ToHashSet();
        foreach (var l in model.Links)
        {
            if (!ids.Contains(l.FromId) || !ids.Contains(l.ToId))
            {
                yield return new Violation(Id, DefaultSeverity,
                    $"Link {l.Id} references missing element ({l.FromId} → {l.ToId})",
                    [], [l.Id]);
            }
        }
    }
}

[VersoRule("module-has-at-most-one-context", Severity.Warning, "A module's contextId should reference exactly one Bounded Context.")]
public sealed class ModuleHasAtMostOneContext : IRule
{
    public string Id => "module-has-at-most-one-context";
    public Severity DefaultSeverity => Severity.Warning;
    public string Description => "A module's contextId should reference exactly one Bounded Context.";

    public IEnumerable<Violation> Check(ArchModel.ArchModel model)
    {
        var contextIds = model.Elements.Where(e => e.Kind == ArchElementKind.BoundedContext).Select(e => e.Id).ToHashSet();
        foreach (var m in model.Elements.Where(e => e.Kind == ArchElementKind.Module))
        {
            if (m.Attributes.TryGetValue("contextId", out var ctxId) && ctxId is not null && !contextIds.Contains(ctxId))
            {
                yield return new Violation(Id, DefaultSeverity,
                    $"Module '{m.Name}' references unknown Bounded Context '{ctxId}'",
                    [m.Id], []);
            }
        }
    }
}

[VersoRule("no-orphan-modules", Severity.Info, "Modules should belong to a Bounded Context.")]
public sealed class NoOrphanModules : IRule
{
    public string Id => "no-orphan-modules";
    public Severity DefaultSeverity => Severity.Info;
    public string Description => "Modules should belong to a Bounded Context.";

    public IEnumerable<Violation> Check(ArchModel.ArchModel model)
    {
        foreach (var m in model.Elements.Where(e => e.Kind == ArchElementKind.Module))
        {
            if (!m.Attributes.TryGetValue("contextId", out var ctxId) || ctxId is null)
            {
                yield return new Violation(Id, DefaultSeverity,
                    $"Module '{m.Name}' has no Bounded Context",
                    [m.Id], []);
            }
        }
    }
}

[VersoRule("no-circular-dataflows", Severity.Warning, "DataFlow links should not form cycles.")]
public sealed class NoCircularDataFlows : IRule
{
    public string Id => "no-circular-dataflows";
    public Severity DefaultSeverity => Severity.Warning;
    public string Description => "DataFlow links should not form cycles.";

    public IEnumerable<Violation> Check(ArchModel.ArchModel model)
    {
        var adj = new Dictionary<string, List<(string To, string LinkId)>>();
        foreach (var l in model.Links.Where(x => x.Kind == ArchLinkKind.DataFlow))
        {
            // Allow opt-out via attribute `cyclic: ok`.
            if (l.Attributes.TryGetValue("cyclic", out var c) && c == "ok") continue;
            if (!adj.TryGetValue(l.FromId, out var list)) adj[l.FromId] = list = [];
            list.Add((l.ToId, l.Id));
        }
        var visiting = new HashSet<string>();
        var visited = new HashSet<string>();
        var pathLinks = new Stack<string>();
        var reported = new HashSet<string>();

        bool Dfs(string node)
        {
            if (visiting.Contains(node)) return true;
            if (visited.Contains(node)) return false;
            visiting.Add(node);
            if (adj.TryGetValue(node, out var neighbours))
            {
                foreach (var (to, linkId) in neighbours)
                {
                    pathLinks.Push(linkId);
                    if (Dfs(to))
                    {
                        foreach (var lid in pathLinks) reported.Add(lid);
                    }
                    pathLinks.Pop();
                }
            }
            visiting.Remove(node);
            visited.Add(node);
            return false;
        }
        foreach (var n in adj.Keys) Dfs(n);

        if (reported.Count > 0)
        {
            yield return new Violation(Id, DefaultSeverity,
                $"DataFlow cycle detected involving {reported.Count} link(s)",
                [], reported.ToList());
        }
    }
}

[VersoRule("bounded-context-has-name", Severity.Warning, "Bounded Contexts must have a non-empty name.")]
public sealed class BoundedContextHasName : IRule
{
    public string Id => "bounded-context-has-name";
    public Severity DefaultSeverity => Severity.Warning;
    public string Description => "Bounded Contexts must have a non-empty name.";

    public IEnumerable<Violation> Check(ArchModel.ArchModel model)
    {
        foreach (var c in model.Elements.Where(e => e.Kind == ArchElementKind.BoundedContext))
        {
            if (string.IsNullOrWhiteSpace(c.Name))
            {
                yield return new Violation(Id, DefaultSeverity,
                    $"Bounded Context {c.Id} has no name",
                    [c.Id], []);
            }
        }
    }
}

[VersoRule("deprecated-element-no-incoming-flows", Severity.Warning, "Deprecated elements should not have incoming DataFlows.")]
public sealed class DeprecatedElementNoIncomingFlows : IRule
{
    public string Id => "deprecated-element-no-incoming-flows";
    public Severity DefaultSeverity => Severity.Warning;
    public string Description => "Deprecated elements should not have incoming DataFlows.";

    public IEnumerable<Violation> Check(ArchModel.ArchModel model)
    {
        var deprecated = model.Tags.Where(t => t.Lifecycle?.Status == "deprecated").Select(t => t.TargetId).ToHashSet();
        foreach (var l in model.Links.Where(x => x.Kind == ArchLinkKind.DataFlow))
        {
            if (deprecated.Contains(l.ToId))
            {
                yield return new Violation(Id, DefaultSeverity,
                    $"DataFlow {l.Id} targets deprecated element {l.ToId}",
                    [l.ToId], [l.Id]);
            }
        }
    }
}
