using Verso.Engine.Models;

namespace Verso.Engine.Discovery;

/// <summary>
/// Pure function over (DiscoveredModel, WorkspaceModel) → metric snapshot.
/// Implements Ca / Ce / I / A / D and Relational Cohesion at module / namespace / project level.
/// </summary>
public sealed class MetricsCalculator
{
    public WorkspaceMetrics Compute(WorkspaceModel workspace, DiscoveredModel discovered)
    {
        var typeToModule = new Dictionary<string, DiscoveredModule>();
        foreach (var m in discovered.Modules)
        {
            foreach (var t in m.TypeIds) typeToModule[t] = m;
        }
        var typeIndex = workspace.AllTypes.ToDictionary(t => t.Id);

        var moduleMetrics = discovered.Modules.Select(module =>
            ComputeModule(module, discovered.Edges, typeToModule, typeIndex)).ToList();

        var nsMetrics = discovered.Namespaces.Select(ns =>
            ComputeNamespace(ns, discovered.Edges, typeIndex, workspace)).ToList();

        var projectMetrics = discovered.Projects.Select(proj =>
            ComputeProject(proj, discovered.Edges, typeIndex, discovered.Projects)).ToList();

        var avgD = moduleMetrics.Count == 0 ? 0.0
            : moduleMetrics.Average(m => m.DistanceFromMainSequence);

        return new WorkspaceMetrics(
            workspace.RootPath,
            DateTime.UtcNow,
            moduleMetrics,
            nsMetrics,
            projectMetrics,
            Math.Round(avgD, 3));
    }

    private static ModuleMetric ComputeModule(
        DiscoveredModule module,
        IReadOnlyList<DependencyEdge> edges,
        IReadOnlyDictionary<string, DiscoveredModule> typeToModule,
        IReadOnlyDictionary<string, TypeModel> typeIndex)
    {
        var typeSet = module.TypeIds.ToHashSet();

        var efferent = new HashSet<string>();
        var afferent = new HashSet<string>();
        var internalEdges = 0;
        var externalEdges = 0;
        var histogram = new Dictionary<EdgeKind, int>();

        foreach (var e in edges)
        {
            histogram.TryGetValue(e.Kind, out var c); // count later only the relevant ones
            var fromIn = typeSet.Contains(e.FromTypeId);
            var toIn = typeSet.Contains(e.ToTypeId);
            if (fromIn && toIn)
            {
                internalEdges++;
                histogram[e.Kind] = c + 1;
            }
            else if (fromIn)
            {
                externalEdges++;
                histogram[e.Kind] = c + 1;
                if (typeToModule.TryGetValue(e.ToTypeId, out var otherModule) && otherModule.Id != module.Id)
                {
                    efferent.Add(otherModule.Id);
                }
                else if (e.External)
                {
                    efferent.Add(e.ToTypeId);
                }
            }
            else if (toIn)
            {
                externalEdges++;
                if (typeToModule.TryGetValue(e.FromTypeId, out var otherModule) && otherModule.Id != module.Id)
                {
                    afferent.Add(otherModule.Id);
                }
            }
        }

        var ce = efferent.Count;
        var ca = afferent.Count;
        var i = (ce + ca) == 0 ? 0.0 : (double)ce / (ce + ca);

        var totalTypes = module.TypeIds.Count;
        var abstractTypes = module.TypeIds
            .Where(typeIndex.ContainsKey)
            .Count(id => typeIndex[id].Kind is TypeKind.Interface ||
                         (typeIndex[id].Kind is TypeKind.Class &&
                          IsAbstract(typeIndex[id])));
        var a = totalTypes == 0 ? 0.0 : (double)abstractTypes / totalTypes;
        var d = Math.Abs(a + i - 1);

        var rc = totalTypes == 0 ? 0.0 : (double)(internalEdges + 1) / totalTypes;

        var histReadable = histogram.ToDictionary(
            kv => ToCamel(kv.Key.ToString()),
            kv => kv.Value);

        return new ModuleMetric(
            module.Id, module.Name, totalTypes,
            Ca: ca, Ce: ce,
            Instability: Math.Round(i, 3),
            Abstractness: Math.Round(a, 3),
            DistanceFromMainSequence: Math.Round(d, 3),
            RelationalCohesion: Math.Round(rc, 3),
            InternalEdges: internalEdges,
            ExternalEdges: externalEdges,
            EdgeKindHistogram: histReadable);
    }

    private static NamespaceMetric ComputeNamespace(
        DiscoveredNamespace ns,
        IReadOnlyList<DependencyEdge> edges,
        IReadOnlyDictionary<string, TypeModel> typeIndex,
        WorkspaceModel workspace)
    {
        var typeSet = ns.TypeIds.ToHashSet();
        var efferent = new HashSet<string>();
        var afferent = new HashSet<string>();
        foreach (var e in edges)
        {
            var fromIn = typeSet.Contains(e.FromTypeId);
            var toIn = typeSet.Contains(e.ToTypeId);
            if (fromIn && !toIn)
            {
                if (typeIndex.TryGetValue(e.ToTypeId, out var t)) efferent.Add(t.Namespace);
                else efferent.Add(e.ToTypeId);
            }
            else if (toIn && !fromIn)
            {
                if (typeIndex.TryGetValue(e.FromTypeId, out var t)) afferent.Add(t.Namespace);
            }
        }
        var ce = efferent.Count; var ca = afferent.Count;
        var i = (ce + ca) == 0 ? 0.0 : (double)ce / (ce + ca);
        var abstractTypes = ns.TypeIds.Where(typeIndex.ContainsKey).Count(id =>
            typeIndex[id].Kind is TypeKind.Interface ||
            (typeIndex[id].Kind is TypeKind.Class && IsAbstract(typeIndex[id])));
        var a = ns.TypeIds.Count == 0 ? 0.0 : (double)abstractTypes / ns.TypeIds.Count;
        var d = Math.Abs(a + i - 1);
        return new NamespaceMetric(ns.Fqn, ns.TypeIds.Count, ca, ce,
            Math.Round(i, 3), Math.Round(a, 3), Math.Round(d, 3));
    }

    private static ProjectMetric ComputeProject(
        DiscoveredProject proj,
        IReadOnlyList<DependencyEdge> edges,
        IReadOnlyDictionary<string, TypeModel> typeIndex,
        IReadOnlyList<DiscoveredProject> allProjects)
    {
        var typeSet = proj.TypeIds.ToHashSet();
        // Map each type to its project for O(1) lookup
        var typeToProj = new Dictionary<string, string>();
        foreach (var p in allProjects)
            foreach (var id in p.TypeIds) typeToProj[id] = p.Id;

        var efferent = new HashSet<string>();
        var afferent = new HashSet<string>();
        foreach (var e in edges)
        {
            var fromIn = typeSet.Contains(e.FromTypeId);
            var toIn = typeSet.Contains(e.ToTypeId);
            if (fromIn && !toIn)
            {
                if (typeToProj.TryGetValue(e.ToTypeId, out var pid) && pid != proj.Id) efferent.Add(pid);
                else if (e.External) efferent.Add(e.ToTypeId);
            }
            else if (toIn && !fromIn)
            {
                if (typeToProj.TryGetValue(e.FromTypeId, out var pid) && pid != proj.Id) afferent.Add(pid);
            }
        }
        var ce = efferent.Count; var ca = afferent.Count;
        var i = (ce + ca) == 0 ? 0.0 : (double)ce / (ce + ca);
        var abstractTypes = proj.TypeIds.Where(typeIndex.ContainsKey).Count(id =>
            typeIndex[id].Kind is TypeKind.Interface ||
            (typeIndex[id].Kind is TypeKind.Class && IsAbstract(typeIndex[id])));
        var a = proj.TypeIds.Count == 0 ? 0.0 : (double)abstractTypes / proj.TypeIds.Count;
        var d = Math.Abs(a + i - 1);
        return new ProjectMetric(proj.Id, proj.Name, proj.TypeIds.Count, ca, ce,
            Math.Round(i, 3), Math.Round(a, 3), Math.Round(d, 3));
    }

    private static bool IsAbstract(TypeModel t)
    {
        // We do not track the abstract modifier on TypeModel; approximate by checking that the
        // type's name starts with a capital and has no setters, which is a poor signal. Treat
        // pure interfaces as the only certain "abstract" contributor for v1.
        return false;
    }

    private static string ToCamel(string s) =>
        char.ToLowerInvariant(s[0]) + s[1..];
}
