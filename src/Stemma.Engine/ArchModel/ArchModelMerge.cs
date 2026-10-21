namespace Stemma.Engine.ArchModel;

/// <summary>
/// Several model files read as one model: every element, link and tag of each, first file first, an id
/// already seen not taken twice. The live read and the read of a past revision (ADR-0024) both go
/// through here, so a model compared with itself at another time is assembled by the same rule.
/// </summary>
public static class ArchModelMerge
{
    /// <param name="primaryPath">The file the merged model is said to come from: the primary one.</param>
    /// <param name="partials">Each file's model, in the order the files are read; nulls are skipped.</param>
    public static ArchModel Merge(string primaryPath, IEnumerable<ArchModel?> partials)
    {
        var elements = new List<ArchElement>();
        var links = new List<ArchLink>();
        var tags = new List<ArchTag>();
        var unreadable = new List<ArchReadProblem>();
        var seen = new HashSet<string>();
        foreach (var partial in partials)
        {
            if (partial is null) continue;
            foreach (var e in partial.Elements) if (seen.Add($"e:{e.Id}")) elements.Add(e);
            foreach (var l in partial.Links) if (seen.Add($"l:{l.Id}")) links.Add(l);
            tags.AddRange(partial.Tags);
            unreadable.AddRange(partial.Unreadable);
        }
        return new ArchModel(primaryPath, elements, links, tags) { Unreadable = unreadable };
    }

    /// <summary>
    /// The order files are read in: the one declaring the <c>Architecture</c> class's model first, by its
    /// name, then the rest by path — the order the live workspace has always used.
    /// </summary>
    public static IEnumerable<string> ReadingOrder(IEnumerable<string> paths) => paths
        .OrderBy(p => p.EndsWith("Architecture.cs", StringComparison.OrdinalIgnoreCase) ? 0 : 1)
        .ThenBy(p => p, StringComparer.OrdinalIgnoreCase);

    /// <summary>
    /// Whether a path relative to the workspace is a model file: a C# file inside a folder named
    /// <c>Architecture</c>, not generated. The rule the live workspace, a past revision and the CLI
    /// all read by.
    /// </summary>
    public static bool IsModelFile(string relativePath)
    {
        var p = "/" + relativePath.Replace('\\', '/');
        return p.Contains($"/{Workspace.ModelWorkspaceLoader.ArchitectureDir}/", StringComparison.OrdinalIgnoreCase)
            && p.EndsWith(".cs", StringComparison.OrdinalIgnoreCase)
            && !p.EndsWith(".g.cs", StringComparison.OrdinalIgnoreCase);
    }

    /// <summary>
    /// The model files of the workspace at <paramref name="workspaceRoot"/> as they are on disk, in
    /// reading order — for a reader that has no workspace open, as `stemma validate` has not. Folders
    /// the workspace leaves out (build output, <c>.git</c>, <c>node_modules</c>) are not entered.
    /// </summary>
    public static IReadOnlyList<string> FilesIn(string workspaceRoot)
    {
        if (!Directory.Exists(workspaceRoot)) return [];
        var root = Path.GetFullPath(workspaceRoot);
        return ReadingOrder(Workspace.ModelWorkspaceLoader.SourcesIn(root)
                .Where(path => IsModelFile(Path.GetRelativePath(root, path))))
            .ToList();
    }

    /// <param name="Files">Every model file, in reading order.</param>
    /// <param name="Partials">The model each file declares, for the files that declare one.</param>
    /// <param name="Model">All of them as one model; null when no file declares one.</param>
    public sealed record OnDisk(IReadOnlyList<string> Files, IReadOnlyList<ArchModel> Partials, ArchModel? Model);

    /// <summary>The model of the workspace at <paramref name="workspaceRoot"/>, read from disk and merged as the engine merges it.</summary>
    public static OnDisk ReadFrom(string workspaceRoot)
    {
        var files = FilesIn(workspaceRoot);
        var partials = files
            .Select(f => DslReader.TryRead(f, Microsoft.CodeAnalysis.CSharp.CSharpSyntaxTree.ParseText(File.ReadAllText(f), path: f).GetRoot()))
            .OfType<ArchModel>()
            .ToList();
        return new OnDisk(files, partials, partials.Count == 0 ? null : Merge(partials[0].FilePath, partials));
    }
}
