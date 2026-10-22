using System.Collections.Concurrent;
using System.Xml;
using System.Xml.Linq;
using Stemma.Engine.Workspace;

namespace Stemma.Engine.Conformance;

/// <summary>A <c>ProjectReference</c> as a project file writes it, and where it points.</summary>
/// <param name="Include">As written.</param>
/// <param name="Path">Resolved against the referencing project's folder.</param>
/// <param name="External">Whether it points at something that is not a project under the root read — outside the tree, or not there at all.</param>
public sealed record ProjectReferenceInfo(string Include, string Path, bool External);

/// <summary>One .NET project, as its project file says.</summary>
/// <param name="Name">The file's name without <c>.csproj</c>.</param>
/// <param name="Path">The full path of the project file.</param>
/// <param name="Sdk">The project's SDK (<c>Microsoft.NET.Sdk.Web</c>), when it names one.</param>
/// <param name="OutputType">As written, or what the SDK makes it without one: <c>Exe</c> for a web or worker SDK, otherwise <c>Library</c>.</param>
/// <param name="TargetFrameworks">As written, or as the nearest <c>Directory.Build.props</c> writes them; empty when neither does.</param>
/// <param name="Problem">Why the file could not be read; null when it was.</param>
public sealed record ProjectInfo(
    string Name,
    string Path,
    string? Sdk,
    string OutputType,
    IReadOnlyList<string> TargetFrameworks,
    IReadOnlyList<ProjectReferenceInfo> References,
    string? Problem = null);

/// <summary>
/// The .NET projects under a folder and what each references (ADR-0029): the coarsest, most reliable
/// statement of what depends on what in a .NET system, since a <c>ProjectReference</c> is a compile-time
/// dependency that cannot be faked.
///
/// Project files are read as XML and nothing more — no MSBuild evaluation, no SDK: conditions are not
/// followed (a conditional reference counts), imports are not read, a property in a path is left as
/// written. The one thing taken from outside the project file is its target framework from the nearest
/// <c>Directory.Build.props</c>, when the project names none, since that is where most repositories put it.
/// The walk never enters <c>bin</c>, <c>obj</c>, <c>node_modules</c> or a dot-folder.
///
/// A project file is parsed again only when its time or length changes: the canvas asks for the
/// violations every second and a half, and the solution must not be parsed every time (F-025 AC5).
/// </summary>
public sealed class ProjectGraph
{
    private ProjectGraph(string root, IReadOnlyList<ProjectInfo> projects)
    {
        Root = root;
        Projects = projects;
    }

    /// <summary>The folder read, as a full path.</summary>
    public string Root { get; }

    /// <summary>Every project under <see cref="Root"/>, in path order.</summary>
    public IReadOnlyList<ProjectInfo> Projects { get; }

    /// <summary>How paths compare on this machine: by case where the file system is case-sensitive.</summary>
    public static StringComparer PathComparer { get; } =
        OperatingSystem.IsWindows() || OperatingSystem.IsMacOS() ? StringComparer.OrdinalIgnoreCase : StringComparer.Ordinal;

    /// <summary>The projects under <paramref name="root"/>, each reference marked external when it leads out of them.</summary>
    public static ProjectGraph Read(string root)
    {
        var full = Path.GetFullPath(root);
        var files = ProjectFilesUnder(full);
        var inTree = files.ToHashSet(PathComparer);
        var projects = files.Select(ReadProject)
            .Select(p => p with { References = p.References.Select(r => r with { External = !inTree.Contains(r.Path) }).ToList() })
            .ToList();
        return new ProjectGraph(full, projects);
    }

    /// <summary>The project files under <paramref name="folder"/>, in path order, never from build output or a dot-folder.</summary>
    public static IReadOnlyList<string> ProjectFilesUnder(string folder)
    {
        if (!Directory.Exists(folder)) return [];
        var full = Path.GetFullPath(folder);
        // The canvas's violations poll asks every second and a half; walking a large repository that often is
        // constant disk work for an answer that changes when someone adds a project. A few seconds is fresh enough.
        if (Walks.TryGetValue(full, out var known) && DateTime.UtcNow - known.At < WalkFreshFor) return known.Files;
        var files = ModelWorkspaceLoader.EnumerateFiles(full, "*.csproj").Order(PathComparer).ToList();
        Walks[full] = (DateTime.UtcNow, files);
        return files;
    }

    /// <summary>How long a walk of a folder's project files is trusted before it is walked again.</summary>
    internal static readonly TimeSpan WalkFreshFor = TimeSpan.FromSeconds(5);

    private static readonly ConcurrentDictionary<string, (DateTime At, IReadOnlyList<string> Files)> Walks = new(PathComparer);

    private sealed record Parsed(string? Sdk, string? OutputType, IReadOnlyList<string> TargetFrameworks, IReadOnlyList<(string Include, string Path)> References, string? Problem);

    private static readonly ConcurrentDictionary<string, (DateTime Written, long Length, Parsed Parsed)> Cache = new(PathComparer);

    /// <summary>
    /// One project file. A reference is external here when nothing is at its path; <see cref="Read"/>
    /// marks it external when it leads out of the tree read.
    /// </summary>
    public static ProjectInfo ReadProject(string path)
    {
        var full = Path.GetFullPath(path);
        var parsed = ParseCached(full, ParseProject);
        var frameworks = parsed.TargetFrameworks.Count > 0 ? parsed.TargetFrameworks : FrameworksFromBuildProps(Path.GetDirectoryName(full)!);
        var outputType = parsed.OutputType
            ?? (parsed.Sdk is { } sdk && (sdk.EndsWith(".Web", StringComparison.OrdinalIgnoreCase) || sdk.EndsWith(".Worker", StringComparison.OrdinalIgnoreCase)) ? "Exe" : "Library");
        return new ProjectInfo(Path.GetFileNameWithoutExtension(full), full, parsed.Sdk, outputType, frameworks,
            parsed.References.Select(r => new ProjectReferenceInfo(r.Include, r.Path, !File.Exists(r.Path))).ToList(), parsed.Problem);
    }

    private static Parsed ParseCached(string path, Func<string, Parsed> parse)
    {
        DateTime written;
        long length;
        try
        {
            var info = new FileInfo(path);
            if (!info.Exists) return new Parsed(null, null, [], [], "the file does not exist");
            (written, length) = (info.LastWriteTimeUtc, info.Length);
        }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException)
        {
            return new Parsed(null, null, [], [], e.Message);
        }
        if (Cache.TryGetValue(path, out var known) && known.Written == written && known.Length == length) return known.Parsed;
        var parsed = parse(path);
        Cache[path] = (written, length, parsed);
        return parsed;
    }

    private static Parsed ParseProject(string path)
    {
        XElement root;
        try { root = XDocument.Load(path).Root ?? throw new XmlException("the file has no root element"); }
        catch (Exception e) when (e is XmlException or IOException or UnauthorizedAccessException)
        {
            return new Parsed(null, null, [], [], $"not readable as a project file: {e.Message}");
        }

        // An old-style project carries the MSBuild namespace and a new one none, so names are compared without it.
        IEnumerable<XElement> All(string name) => root.Descendants().Where(e => e.Name.LocalName == name);
        string? First(string name) => All(name).Select(e => e.Value.Trim()).FirstOrDefault(v => v.Length > 0);

        var sdk = root.Attribute("Sdk")?.Value
            ?? All("Sdk").Select(e => e.Attribute("Name")?.Value).FirstOrDefault(v => v is not null)
            ?? All("Import").Select(e => e.Attribute("Sdk")?.Value).FirstOrDefault(v => v is not null);
        var dir = Path.GetDirectoryName(path)!;
        var references = All("ProjectReference")
            .SelectMany(e => (e.Attribute("Include")?.Value ?? "").Split(';', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries))
            .Select(include => (include, Path.GetFullPath(Path.Combine(dir, include.Replace('\\', Path.DirectorySeparatorChar).Replace('/', Path.DirectorySeparatorChar)))))
            .ToList();
        return new Parsed(sdk, First("OutputType"), Frameworks(root), references, null);
    }

    /// <summary><c>TargetFrameworks</c> split, or <c>TargetFramework</c>, as written.</summary>
    private static IReadOnlyList<string> Frameworks(XElement root)
    {
        var many = root.Descendants().Where(e => e.Name.LocalName == "TargetFrameworks").Select(e => e.Value.Trim()).FirstOrDefault(v => v.Length > 0);
        if (many is not null) return many.Split(';', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
        var one = root.Descendants().Where(e => e.Name.LocalName == "TargetFramework").Select(e => e.Value.Trim()).FirstOrDefault(v => v.Length > 0);
        return one is null ? [] : [one];
    }

    /// <summary>
    /// The target frameworks of the <c>Directory.Build.props</c> nearest to <paramref name="dir"/>, looking
    /// up as MSBuild does and stopping at the first one, as MSBuild does.
    /// </summary>
    private static IReadOnlyList<string> FrameworksFromBuildProps(string dir)
    {
        for (var at = dir; at is not null; at = Path.GetDirectoryName(at))
        {
            var props = Path.Combine(at, "Directory.Build.props");
            if (File.Exists(props)) return ParseCached(props, ParseBuildProps).TargetFrameworks;
        }
        return [];
    }

    private static Parsed ParseBuildProps(string path)
    {
        try
        {
            return XDocument.Load(path).Root is { } root ? new Parsed(null, null, Frameworks(root), [], null) : new Parsed(null, null, [], [], null);
        }
        catch (Exception e) when (e is XmlException or IOException or UnauthorizedAccessException)
        {
            // A props file that cannot be read gives the projects under it no framework; the projects themselves are still read.
            return new Parsed(null, null, [], [], e.Message);
        }
    }
}
