using Microsoft.CodeAnalysis;
using Verso.Engine.Models;

namespace Verso.Engine.Discovery;

public sealed class DiscoveryRunner
{
    public async Task<DiscoveredModel> RunAsync(
        WorkspaceModel workspace,
        Solution? solution,
        DiscoveryConfig? config,
        CancellationToken ct = default)
    {
        var depth = config?.NamespaceDepth ?? 2;

        var projects = BuildProjects(workspace, solution);
        var namespaces = BuildNamespaces(workspace);
        var modules = BuildModules(workspace, projects, depth, config?.ModulePins);

        var dependencyExtractor = new DependencyExtractor();
        var edges = await dependencyExtractor.ExtractAsync(workspace, solution, modules, config, ct);

        return new DiscoveredModel(
            workspace.RootPath,
            DateTime.UtcNow,
            projects,
            namespaces,
            modules,
            edges);
    }

    private static List<DiscoveredProject> BuildProjects(WorkspaceModel workspace, Solution? solution)
    {
        var projects = new List<DiscoveredProject>();
        foreach (var p in workspace.Projects)
        {
            var typeIds = p.Types.Select(t => t.Id).ToList();
            var projRefs = new List<string>();
            var pkgRefs = new List<string>();
            if (solution is not null)
            {
                var match = solution.Projects.FirstOrDefault(sp => sp.Name == p.Name);
                if (match is not null)
                {
                    projRefs.AddRange(match.ProjectReferences.Select(r =>
                        solution.GetProject(r.ProjectId)?.Name ?? string.Empty)
                        .Where(s => !string.IsNullOrEmpty(s)));
                    pkgRefs.AddRange(match.MetadataReferences
                        .Select(r => Path.GetFileNameWithoutExtension(r.Display ?? string.Empty))
                        .Where(s => !string.IsNullOrEmpty(s) && !s!.StartsWith("System.") && !s.StartsWith("Microsoft.") && !s.StartsWith("netstandard"))
                        .Take(20)!);
                }
            }
            projects.Add(new DiscoveredProject(
                Id: $"proj_{Slug(p.Name)}",
                Name: p.Name,
                FilePath: p.FilePath,
                TargetFramework: p.TargetFramework,
                ProjectReferences: projRefs,
                PackageReferences: pkgRefs.Distinct().ToList(),
                TypeIds: typeIds));
        }
        return projects;
    }

    private static List<DiscoveredNamespace> BuildNamespaces(WorkspaceModel workspace)
    {
        return workspace.Projects.SelectMany(p =>
                p.Types.Where(t => !string.IsNullOrEmpty(t.Namespace))
                       .GroupBy(t => t.Namespace)
                       .Select(g => new DiscoveredNamespace(
                           Fqn: g.Key,
                           ProjectId: $"proj_{Slug(p.Name)}",
                           TypeIds: g.Select(t => t.Id).ToList())))
            .ToList();
    }

    private static List<DiscoveredModule> BuildModules(
        WorkspaceModel workspace,
        IReadOnlyList<DiscoveredProject> projects,
        int namespaceDepth,
        IReadOnlyList<DiscoveryConfigModulePin>? pins)
    {
        // Strategy: for each project, group its types by the first `namespaceDepth` namespace
        // segments below the project's root namespace. Collapse single-type buckets into the
        // project itself. Confidence: project=1.0; multi-type namespace bucket=0.8;
        // single-type fallback=0.4.
        var modules = new List<DiscoveredModule>();
        var nextId = 1;
        foreach (var p in workspace.Projects)
        {
            var projectId = $"proj_{Slug(p.Name)}";
            if (p.Types.Count == 0)
            {
                modules.Add(new DiscoveredModule(
                    Id: $"dmod_{nextId++:D3}",
                    Name: p.Name,
                    Source: DiscoveredModuleSource.Project,
                    ProjectId: projectId,
                    NamespacePrefix: null,
                    FolderPath: Path.GetDirectoryName(p.FilePath),
                    TypeIds: Array.Empty<string>(),
                    Confidence: 1.0,
                    Rationale: $"Project '{p.Name}' has no types; treated as an empty module."));
                continue;
            }

            var rootNs = LongestCommonNamespacePrefix(p.Types.Select(t => t.Namespace));
            var groups = p.Types
                .GroupBy(t => GroupingKey(t.Namespace, rootNs, namespaceDepth))
                .OrderBy(g => g.Key)
                .ToList();

            if (groups.Count == 1)
            {
                var only = groups[0];
                modules.Add(new DiscoveredModule(
                    Id: $"dmod_{nextId++:D3}",
                    Name: only.Key.Length == 0 ? p.Name : SegmentDisplayName(only.Key),
                    Source: DiscoveredModuleSource.Project,
                    ProjectId: projectId,
                    NamespacePrefix: only.Key.Length == 0 ? rootNs : only.Key,
                    FolderPath: Path.GetDirectoryName(p.FilePath),
                    TypeIds: only.Select(t => t.Id).ToList(),
                    Confidence: 1.0,
                    Rationale: $"Project '{p.Name}' is a single cohesive module."));
                continue;
            }

            foreach (var group in groups)
            {
                var typeIds = group.Select(t => t.Id).ToList();
                var nsPrefix = group.Key.Length == 0 ? rootNs : group.Key;
                var folderHint = InferFolder(group.Select(t => t.FilePath));
                var name = group.Key.Length == 0 ? p.Name : SegmentDisplayName(group.Key);
                var confidence = typeIds.Count switch
                {
                    >= 3 => 0.85,
                    2 => 0.7,
                    _ => 0.45,
                };
                modules.Add(new DiscoveredModule(
                    Id: $"dmod_{nextId++:D3}",
                    Name: name,
                    Source: DiscoveredModuleSource.Namespace,
                    ProjectId: projectId,
                    NamespacePrefix: nsPrefix,
                    FolderPath: folderHint,
                    TypeIds: typeIds,
                    Confidence: confidence,
                    Rationale: $"Namespace bucket '{nsPrefix}' under project '{p.Name}' (depth {namespaceDepth})."));
            }
        }

        if (pins is not null && pins.Count > 0)
        {
            modules = ApplyPins(modules, pins, workspace).ToList();
        }
        return modules;
    }

    private static IEnumerable<DiscoveredModule> ApplyPins(
        IReadOnlyList<DiscoveredModule> modules,
        IReadOnlyList<DiscoveryConfigModulePin> pins,
        WorkspaceModel workspace)
    {
        // Pins override the namespace heuristic: every type whose namespace begins with the pin's
        // string OR whose file path contains the pin's folder is moved into a single pinned module.
        var allTypes = workspace.AllTypes.ToDictionary(t => t.Id);
        var pinned = new HashSet<string>();
        var pinnedModules = new List<DiscoveredModule>();
        var pinIndex = 1;
        foreach (var pin in pins)
        {
            var typeIds = allTypes.Values
                .Where(t => t.Namespace.StartsWith(pin.FolderOrNamespace, StringComparison.OrdinalIgnoreCase)
                         || t.FilePath.Contains(pin.FolderOrNamespace, StringComparison.OrdinalIgnoreCase))
                .Select(t => t.Id).ToList();
            if (typeIds.Count == 0) continue;
            foreach (var id in typeIds) pinned.Add(id);
            pinnedModules.Add(new DiscoveredModule(
                Id: $"dmod_pin_{pinIndex++:D3}",
                Name: pin.ModuleName,
                Source: DiscoveredModuleSource.Folder,
                ProjectId: ModuleProjectFor(modules, typeIds[0]),
                NamespacePrefix: pin.FolderOrNamespace,
                FolderPath: pin.FolderOrNamespace,
                TypeIds: typeIds,
                Confidence: 1.0,
                Rationale: $"Architect-pinned module '{pin.ModuleName}' from `verso.discovery.json`."));
        }
        // Surviving non-pinned modules drop pinned types from their type lists.
        foreach (var m in modules)
        {
            var keptTypes = m.TypeIds.Where(id => !pinned.Contains(id)).ToList();
            if (keptTypes.Count == 0) continue;
            yield return m with { TypeIds = keptTypes };
        }
        foreach (var m in pinnedModules) yield return m;
    }

    private static string ModuleProjectFor(IReadOnlyList<DiscoveredModule> modules, string typeId) =>
        modules.FirstOrDefault(m => m.TypeIds.Contains(typeId))?.ProjectId ?? "proj_unknown";

    private static string GroupingKey(string ns, string root, int depth)
    {
        if (string.IsNullOrEmpty(ns)) return string.Empty;
        var trimmed = ns.StartsWith(root + ".", StringComparison.Ordinal) ? ns[(root.Length + 1)..]
                    : ns == root ? string.Empty
                    : ns;
        if (string.IsNullOrEmpty(trimmed)) return string.Empty;
        var parts = trimmed.Split('.', StringSplitOptions.RemoveEmptyEntries);
        return string.Join('.', parts.Take(depth));
    }

    private static string LongestCommonNamespacePrefix(IEnumerable<string> namespaces)
    {
        var list = namespaces.Where(s => !string.IsNullOrEmpty(s)).ToList();
        if (list.Count == 0) return string.Empty;
        var first = list[0].Split('.');
        var prefix = first.AsEnumerable();
        foreach (var ns in list.Skip(1))
        {
            var segs = ns.Split('.');
            prefix = prefix.Zip(segs, (a, b) => (a, b))
                           .TakeWhile(t => t.a == t.b).Select(t => t.a)
                           .ToList();
        }
        return string.Join('.', prefix);
    }

    private static string SegmentDisplayName(string segment)
    {
        var last = segment.Split('.').Last();
        return last;
    }

    private static string? InferFolder(IEnumerable<string> filePaths)
    {
        var dirs = filePaths.Select(Path.GetDirectoryName).Where(d => !string.IsNullOrEmpty(d)).ToList();
        if (dirs.Count == 0) return null;
        var common = dirs[0]!;
        foreach (var d in dirs.Skip(1))
        {
            common = CommonPathPrefix(common, d!);
        }
        return string.IsNullOrEmpty(common) ? null : common;
    }

    private static string CommonPathPrefix(string a, string b)
    {
        var aParts = a.Split(Path.DirectorySeparatorChar);
        var bParts = b.Split(Path.DirectorySeparatorChar);
        var prefix = aParts.Zip(bParts, (x, y) => (x, y))
                           .TakeWhile(t => string.Equals(t.x, t.y, StringComparison.OrdinalIgnoreCase))
                           .Select(t => t.x).ToArray();
        return string.Join(Path.DirectorySeparatorChar, prefix);
    }

    private static string Slug(string s) =>
        new string(s.Where(c => char.IsLetterOrDigit(c) || c == '_').ToArray()).ToLowerInvariant();
}
