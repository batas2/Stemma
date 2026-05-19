namespace Verso.Engine.Discovery;

/// <summary>
/// Produces ranked <see cref="RecommendedView"/> candidates from a discovered model + metrics.
/// Seven deterministic recommenders ship in v1; ClaudeProposed is queued.
/// </summary>
public sealed class ViewRecommender
{
    public IReadOnlyList<RecommendedView> Recommend(DiscoveredModel discovered, WorkspaceMetrics metrics)
    {
        var candidates = new List<RecommendedView>();
        candidates.AddRange(NamespaceTree(discovered));
        candidates.AddRange(ProjectGraph(discovered));
        candidates.AddRange(LayeredArchitecture(discovered, metrics));
        candidates.AddRange(InstabilityHotspots(discovered, metrics));
        candidates.AddRange(CircularClusters(discovered));
        candidates.AddRange(DeprecationCandidates(discovered, metrics));
        candidates.AddRange(AsyncFlowMap(discovered));
        return candidates
            .OrderByDescending(c => c.ValueScore)
            .Take(8)
            .ToList();
    }

    private static IEnumerable<RecommendedView> NamespaceTree(DiscoveredModel d)
    {
        if (d.Namespaces.Count == 0) yield break;
        yield return new RecommendedView(
            Id: "rec-namespace-tree",
            Name: "Namespace Tree",
            Source: "namespace-tree",
            Audience: "engineer",
            Intent: "Walk every namespace as a hierarchy. Useful when onboarding to a new codebase.",
            ModuleIds: d.Modules.Select(m => m.Id).ToList(),
            EdgeKinds: new[] { EdgeKind.ReferencesType },
            Layout: "hierarchy",
            ValueScore: 0.55,
            Rationale: $"{d.Namespaces.Count} namespaces detected; structural overview is always informative.");
    }

    private static IEnumerable<RecommendedView> ProjectGraph(DiscoveredModel d)
    {
        if (d.Projects.Count <= 1) yield break;
        yield return new RecommendedView(
            Id: "rec-project-graph",
            Name: "Project Graph",
            Source: "project-graph",
            Audience: "architect",
            Intent: "Project references between every csproj. Shows the deployment-unit topology.",
            ModuleIds: d.Modules.Select(m => m.Id).ToList(),
            EdgeKinds: Array.Empty<EdgeKind>(),
            Layout: "dependencyGraph",
            ValueScore: 0.7,
            Rationale: $"{d.Projects.Count} projects; project-reference DAG is directly actionable.");
    }

    private static IEnumerable<RecommendedView> LayeredArchitecture(DiscoveredModel d, WorkspaceMetrics m)
    {
        var layers = new[] { "Domain", "Application", "Infrastructure", "Api", "Web" };
        var hits = layers.Where(layer =>
            d.Modules.Any(mod => mod.Name.EndsWith(layer, StringComparison.OrdinalIgnoreCase)
                              || (mod.NamespacePrefix?.EndsWith(layer, StringComparison.OrdinalIgnoreCase) ?? false))).ToList();
        if (hits.Count < 3) yield break;
        yield return new RecommendedView(
            Id: "rec-layered",
            Name: "Layered Architecture",
            Source: "layered-architecture",
            Audience: "architect",
            Intent: "Layered (Domain / Application / Infrastructure) view; surfaces upward dependency leaks.",
            ModuleIds: d.Modules.Select(mod => mod.Id).ToList(),
            EdgeKinds: new[] { EdgeKind.ReferencesType, EdgeKind.Calls, EdgeKind.Implements },
            Layout: "hierarchy",
            ValueScore: 0.85,
            Rationale: $"Detected layers: {string.Join(", ", hits)}.");
    }

    private static IEnumerable<RecommendedView> InstabilityHotspots(DiscoveredModel d, WorkspaceMetrics m)
    {
        var hot = m.Modules.Where(mm => mm.DistanceFromMainSequence > 0.6).ToList();
        if (hot.Count == 0) yield break;
        yield return new RecommendedView(
            Id: "rec-hotspots",
            Name: "Instability Hotspots",
            Source: "instability-hotspots",
            Audience: "architect",
            Intent: "Modules far from the main sequence (D > 0.6). These are the most fragile.",
            ModuleIds: hot.Select(h => h.ModuleId).ToList(),
            EdgeKinds: new[] { EdgeKind.Calls, EdgeKind.ReferencesType, EdgeKind.Implements, EdgeKind.Inherits },
            Layout: "forceDirected",
            ValueScore: 0.9,
            Rationale: $"{hot.Count} modules above the D > 0.6 threshold.");
    }

    private static IEnumerable<RecommendedView> CircularClusters(DiscoveredModel d)
    {
        // Simple cycle detection at the module level over the dependency graph.
        var moduleEdges = ModuleEdges(d);
        var cycles = FindCycles(moduleEdges).ToList();
        var index = 0;
        foreach (var cycle in cycles.Take(3))
        {
            index++;
            yield return new RecommendedView(
                Id: $"rec-cycle-{index}",
                Name: $"Circular Cluster #{index}",
                Source: "circular-clusters",
                Audience: "architect",
                Intent: $"A cycle of {cycle.Count} modules. Cycles signal a missing seam.",
                ModuleIds: cycle.ToList(),
                EdgeKinds: new[] { EdgeKind.Calls, EdgeKind.ReferencesType, EdgeKind.Implements },
                Layout: "forceDirected",
                ValueScore: 0.95,
                Rationale: "Modules form a directed cycle; refactor to a layered seam.");
        }
    }

    private static IEnumerable<RecommendedView> DeprecationCandidates(DiscoveredModel d, WorkspaceMetrics m)
    {
        var orphan = m.Modules.Where(mm => mm.Ca == 0 && mm.TypeCount > 1).ToList();
        if (orphan.Count == 0) yield break;
        yield return new RecommendedView(
            Id: "rec-deprecations",
            Name: "Possibly Unused Modules",
            Source: "deprecation-candidates",
            Audience: "architect",
            Intent: "Modules nothing else depends on. Candidates for removal or hidden bootstrappers.",
            ModuleIds: orphan.Select(o => o.ModuleId).ToList(),
            EdgeKinds: new[] { EdgeKind.Calls, EdgeKind.ReferencesType },
            Layout: "moduleMap",
            ValueScore: 0.65,
            Rationale: $"{orphan.Count} modules have Ca = 0; verify they are entry points or remove.");
    }

    private static IEnumerable<RecommendedView> AsyncFlowMap(DiscoveredModel d)
    {
        var asyncEdges = d.Edges.Where(e => e.Kind is
            EdgeKind.EmitsEventAsync or EdgeKind.ConsumesEventAsync
            or EdgeKind.SendsCommandAsync or EdgeKind.HandlesCommandAsync).ToList();
        if (asyncEdges.Count == 0) yield break;
        var moduleIds = d.Modules
            .Where(m => m.TypeIds.Any(id =>
                asyncEdges.Any(e => e.FromTypeId == id || e.ToTypeId == id)))
            .Select(m => m.Id).ToList();
        if (moduleIds.Count == 0) yield break;
        yield return new RecommendedView(
            Id: "rec-async-flow",
            Name: "Async Flow Map",
            Source: "async-flow-map",
            Audience: "architect",
            Intent: "Every module that emits or consumes a broker message. Surfaces cross-process choreography.",
            ModuleIds: moduleIds,
            EdgeKinds: new[]
            {
                EdgeKind.EmitsEventAsync, EdgeKind.ConsumesEventAsync,
                EdgeKind.SendsCommandAsync, EdgeKind.HandlesCommandAsync,
            },
            Layout: "swimlane",
            ValueScore: 0.92,
            Rationale: $"{asyncEdges.Count} async edges detected across {moduleIds.Count} modules.");
    }

    private static Dictionary<string, HashSet<string>> ModuleEdges(DiscoveredModel d)
    {
        var typeToModule = new Dictionary<string, string>();
        foreach (var m in d.Modules)
            foreach (var t in m.TypeIds) typeToModule[t] = m.Id;
        var graph = new Dictionary<string, HashSet<string>>();
        foreach (var e in d.Edges)
        {
            if (!typeToModule.TryGetValue(e.FromTypeId, out var from)) continue;
            if (!typeToModule.TryGetValue(e.ToTypeId, out var to)) continue;
            if (from == to) continue;
            if (!graph.TryGetValue(from, out var set)) graph[from] = set = new();
            set.Add(to);
        }
        return graph;
    }

    private static IEnumerable<List<string>> FindCycles(Dictionary<string, HashSet<string>> graph)
    {
        var stack = new Stack<string>();
        var inStack = new HashSet<string>();
        var visited = new HashSet<string>();
        var cycles = new List<List<string>>();

        void Dfs(string node)
        {
            if (inStack.Contains(node))
            {
                var cycle = new List<string>();
                foreach (var n in stack)
                {
                    cycle.Add(n);
                    if (n == node) break;
                }
                cycles.Add(cycle);
                return;
            }
            if (visited.Contains(node)) return;
            visited.Add(node);
            inStack.Add(node);
            stack.Push(node);
            if (graph.TryGetValue(node, out var children))
            {
                foreach (var c in children) Dfs(c);
            }
            stack.Pop();
            inStack.Remove(node);
        }

        foreach (var n in graph.Keys) Dfs(n);
        // De-duplicate cycles by their normalised member set
        return cycles
            .Select(c => c.OrderBy(s => s).ToList())
            .DistinctBy(c => string.Join(',', c));
    }
}
