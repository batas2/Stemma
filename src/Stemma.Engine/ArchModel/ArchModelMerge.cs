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
        var seen = new HashSet<string>();
        foreach (var partial in partials)
        {
            if (partial is null) continue;
            foreach (var e in partial.Elements) if (seen.Add($"e:{e.Id}")) elements.Add(e);
            foreach (var l in partial.Links) if (seen.Add($"l:{l.Id}")) links.Add(l);
            tags.AddRange(partial.Tags);
        }
        return new ArchModel(primaryPath, elements, links, tags);
    }

    /// <summary>
    /// The order files are read in: the one declaring the <c>Architecture</c> class's model first, by its
    /// name, then the rest by path — the order the live workspace has always used.
    /// </summary>
    public static IEnumerable<string> ReadingOrder(IEnumerable<string> paths) => paths
        .OrderBy(p => p.EndsWith("Architecture.cs", StringComparison.OrdinalIgnoreCase) ? 0 : 1)
        .ThenBy(p => p, StringComparer.OrdinalIgnoreCase);
}
