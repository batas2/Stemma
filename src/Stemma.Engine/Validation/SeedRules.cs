using Stemma.Engine.ArchModel;

namespace Stemma.Engine.Validation;

[StemmaRule("link-endpoints-exist", Severity.Error, "Every link must reference existing elements.")]
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

[StemmaRule("module-has-at-most-one-context", Severity.Warning, "A module's contextId should reference exactly one Bounded Context.")]
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

[StemmaRule("no-orphan-modules", Severity.Info, "Modules should belong to a Bounded Context.")]
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

/// <summary>
/// Data that comes back to where it started. Each cycle is reported on its own, naming the flows on
/// it and nothing else: the search used to report every flow on the path that led to a cycle, so
/// a → b → c → b named the flow from a, which no one had to change.
///
/// A request and its reply are one <c>twoway</c> flow rather than two arrows, so a round trip is
/// not a cycle. A cycle that is meant can have the rule switched off, or made quieter, in
/// <c>stemma.rules.json</c>. A per-flow <c>cyclic: ok</c> was once read here, but no DataFlow can be
/// written with such an argument, so it never applied.
/// </summary>
[StemmaRule("no-circular-dataflows", Severity.Warning, "DataFlow links should not form cycles.")]
public sealed class NoCircularDataFlows : IRule
{
    public string Id => "no-circular-dataflows";
    public Severity DefaultSeverity => Severity.Warning;
    public string Description => "DataFlow links should not form cycles.";

    public IEnumerable<Violation> Check(ArchModel.ArchModel model)
    {
        var flows = model.Links.Where(x => x.Kind == ArchLinkKind.DataFlow).ToList();
        var component = StronglyConnected(flows);
        // A flow lies on a cycle exactly when both its ends are in the same strongly connected
        // component: that component has a way back from its end to its start.
        foreach (var cycle in flows
                     .Where(f => component[f.FromId] == component[f.ToId])
                     .GroupBy(f => component[f.FromId])
                     .Where(g => g.Count() > 1 || g.First().FromId == g.First().ToId))
        {
            var elements = cycle.SelectMany(f => new[] { f.FromId, f.ToId }).Distinct().ToList();
            yield return new Violation(Id, DefaultSeverity,
                $"DataFlows form a cycle through {string.Join(", ", elements)}",
                elements, cycle.Select(f => f.Id).ToList());
        }
    }

    /// <summary>Tarjan's algorithm, iteratively: each element mapped to its component's number.</summary>
    private static Dictionary<string, int> StronglyConnected(IReadOnlyList<ArchLink> flows)
    {
        var next = flows.GroupBy(f => f.FromId).ToDictionary(g => g.Key, g => g.Select(f => f.ToId).ToList());
        var nodes = flows.SelectMany(f => new[] { f.FromId, f.ToId }).Distinct().ToList();
        var index = new Dictionary<string, int>();
        var low = new Dictionary<string, int>();
        var component = new Dictionary<string, int>();
        var stack = new Stack<string>();
        var onStack = new HashSet<string>();
        var counter = 0;

        foreach (var start in nodes)
        {
            if (index.ContainsKey(start)) continue;
            var work = new Stack<(string Node, int Edge)>();
            work.Push((start, 0));
            index[start] = low[start] = counter++;
            stack.Push(start);
            onStack.Add(start);
            while (work.Count > 0)
            {
                var (node, edge) = work.Pop();
                var targets = next.GetValueOrDefault(node) ?? [];
                if (edge < targets.Count)
                {
                    work.Push((node, edge + 1));
                    var to = targets[edge];
                    if (!index.ContainsKey(to))
                    {
                        index[to] = low[to] = counter++;
                        stack.Push(to);
                        onStack.Add(to);
                        work.Push((to, 0));
                    }
                    else if (onStack.Contains(to)) low[node] = Math.Min(low[node], index[to]);
                    continue;
                }
                if (low[node] == index[node])
                {
                    string member;
                    do
                    {
                        member = stack.Pop();
                        onStack.Remove(member);
                        component[member] = index[node];
                    } while (member != node);
                }
                if (work.Count > 0) low[work.Peek().Node] = Math.Min(low[work.Peek().Node], low[node]);
            }
        }
        return component;
    }
}

[StemmaRule("bounded-context-has-name", Severity.Warning, "Bounded Contexts must have a non-empty name.")]
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

[StemmaRule("deprecated-element-no-incoming-flows", Severity.Warning, "Deprecated elements should not have incoming DataFlows.")]
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

/// <summary>
/// What the model files declare that the reader could not read (<see cref="ArchModel.ArchModel.Unreadable"/>).
/// A declaration whose id was written as a method call used to be missing from the canvas with
/// nothing anywhere to say so; this is where it is said. An error when a whole declaration is left
/// out, a warning when one of its arguments is read as empty.
/// </summary>
[StemmaRule("model/unreadable-declaration", Severity.Warning, "Every argument Stemma reads should be a string literal or a constant.")]
public sealed class UnreadableDeclaration : IRule
{
    public string Id => "model/unreadable-declaration";
    public Severity DefaultSeverity => Severity.Warning;
    public string Description => "Every argument Stemma reads should be a string literal or a constant.";

    public IEnumerable<Violation> Check(ArchModel.ArchModel model) =>
        model.Unreadable.Select(p => new Violation(Id, p.LeftOut ? Severity.Error : DefaultSeverity, p.Message,
            p.Id is null ? [] : [p.Id], []));
}
