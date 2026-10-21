using System.Collections.Immutable;
using System.Reflection;
using System.Text;
using Microsoft.Build.Locator;
using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.CSharp;
using Microsoft.CodeAnalysis.Text;
using Stemma.Engine.Models;

namespace Stemma.Engine.Workspace;

/// <summary>
/// Loads a <em>model-only</em> workspace — one whose C# is just the model and its views, referencing
/// nothing but <c>Stemma.Model</c> — without MSBuild and therefore without an installed .NET SDK.
/// See ADR-0016. Repository workspaces keep going through <see cref="WorkspaceLoader"/>.
/// </summary>
public static class ModelWorkspaceLoader
{
    public const string ArchitectureDir = "Architecture";
    private const string ModelAssemblyName = "Stemma.Model";

    /// <summary>Directories whose contents are never part of the model.</summary>
    private static readonly string[] ExcludedDirs = ["obj", "bin", ".git", "node_modules"];

    /// <summary>
    /// Decides how a workspace should be opened. A solution always means a real repository; a project
    /// file means one too, but only if there is an SDK to evaluate it with. Everything else that
    /// carries an Architecture/ directory is a model we can read on our own.
    /// </summary>
    public static WorkspaceKind DetectKind(string rootPath)
    {
        if (Directory.EnumerateFiles(rootPath, "*.sln", SearchOption.TopDirectoryOnly).Any())
            return WorkspaceKind.MsBuild;

        var hasProject = EnumerateFiles(rootPath, "*.csproj").Any();
        if (hasProject && IsSdkAvailable())
            return WorkspaceKind.MsBuild;

        return HasModelSources(rootPath) ? WorkspaceKind.ModelOnly : WorkspaceKind.None;
    }

    public static bool HasModelSources(string rootPath)
    {
        var archDir = Path.Combine(rootPath, ArchitectureDir);
        return Directory.Exists(archDir)
               && Directory.EnumerateFiles(archDir, "*.cs", SearchOption.AllDirectories).Any();
    }

    private static bool _sdkProbed;
    private static bool _sdkAvailable;

    /// <summary>True when MSBuild can actually be located — i.e. a .NET SDK is installed.</summary>
    public static bool IsSdkAvailable()
    {
        if (_sdkProbed) return _sdkAvailable;
        try
        {
            _sdkAvailable = MSBuildLocator.IsRegistered || MSBuildLocator.QueryVisualStudioInstances().Any();
        }
        catch (Exception)
        {
            // Locator throws rather than returning empty on some layouts; absence is the answer either way.
            _sdkAvailable = false;
        }
        _sdkProbed = true;
        return _sdkAvailable;
    }

    public static (Microsoft.CodeAnalysis.Workspace Workspace, WorkspaceModel Model) Load(string rootPath)
    {
        var sources = EnumerateFiles(rootPath, "*.cs")
            .OrderBy(p => p, StringComparer.Ordinal)
            .ToList();

        if (sources.Count == 0)
            throw new InvalidOperationException($"No model sources found under {rootPath}");

        var workspace = new FileBackedWorkspace();
        var projectName = new DirectoryInfo(rootPath).Name;
        var projectId = ProjectId.CreateNewId(projectName);

        var documents = sources.Select(path =>
        {
            // Read through SourceText so the encoding and BOM travel with the document; the writer
            // hands them straight back on save, which is what keeps the diff clean. The default is
            // what a file *without* a BOM is taken to be, so it must not emit one: Encoding.UTF8
            // does, and gave every BOM-less file a BOM on its first edit (B-006).
            using var stream = File.OpenRead(path);
            var text = SourceText.From(stream, new UTF8Encoding(encoderShouldEmitUTF8Identifier: false), canBeEmbedded: true);
            return DocumentInfo.Create(
                DocumentId.CreateNewId(projectId, path),
                Path.GetFileName(path),
                loader: TextLoader.From(TextAndVersion.Create(text, VersionStamp.Create(), path)),
                filePath: path);
        }).ToImmutableArray();

        var projectInfo = ProjectInfo.Create(
            projectId,
            VersionStamp.Create(),
            name: projectName,
            assemblyName: projectName,
            language: LanguageNames.CSharp,
            filePath: null,
            compilationOptions: new CSharpCompilationOptions(OutputKind.DynamicallyLinkedLibrary,
                                                             nullableContextOptions: NullableContextOptions.Enable),
            parseOptions: new CSharpParseOptions(LanguageVersion.Latest),
            documents: documents,
            metadataReferences: RuntimeReferences());

        var solution = workspace.AddSolution(SolutionInfo.Create(
            SolutionId.CreateNewId(), VersionStamp.Create(), projects: [projectInfo]));

        var model = WorkspaceLoader.BuildModelAsync(rootPath, solution).GetAwaiter().GetResult();
        return (workspace, model);
    }

    /// <summary>
    /// The C# sources a model-only workspace at <paramref name="rootPath"/> holds, read off the disk:
    /// for a reader with no workspace open, as `stemma validate` has none. Folders the workspace leaves
    /// out are not entered at all.
    /// </summary>
    public static IEnumerable<string> SourcesIn(string rootPath) =>
        Directory.Exists(rootPath) ? EnumerateFiles(Path.GetFullPath(rootPath), "*.cs") : [];

    internal static bool IsExcluded(string rootPath, string filePath)
    {
        var relative = Path.GetRelativePath(rootPath, filePath);
        var segments = relative.Split(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar);
        return segments.Any(s => IsExcludedDirectory(s) && !s.EndsWith(".cs", StringComparison.OrdinalIgnoreCase));
    }

    private static bool IsExcludedDirectory(string name) =>
        ExcludedDirs.Contains(name, StringComparer.OrdinalIgnoreCase) || (name.StartsWith('.') && name.Length > 1);

    private static readonly EnumerationOptions OneFolder = new() { AttributesToSkip = 0, IgnoreInaccessible = true };

    /// <summary>
    /// The files matching <paramref name="pattern"/> under <paramref name="rootPath"/> that are not in a
    /// folder <see cref="IsExcluded"/> leaves out — without going into those folders at all. Walked
    /// into and filtered afterwards, node_modules alone was most of the cost of every save and every
    /// poll, and a folder in it that could not be read stopped the workspace from opening.
    /// </summary>
    internal static IEnumerable<string> EnumerateFiles(string rootPath, string pattern)
    {
        var pending = new Stack<string>();
        pending.Push(rootPath);
        while (pending.Count > 0)
        {
            var dir = pending.Pop();
            string[] files, dirs;
            try
            {
                files = Directory.GetFiles(dir, pattern, OneFolder);
                dirs = Directory.GetDirectories(dir, "*", OneFolder);
            }
            catch (Exception e) when (e is IOException or UnauthorizedAccessException)
            {
                // A folder removed or locked while it was being walked has nothing in it to read.
                continue;
            }
            foreach (var file in files) yield return file;
            for (var i = dirs.Length - 1; i >= 0; i--)
                if (!IsExcludedDirectory(Path.GetFileName(dirs[i]))) pending.Push(dirs[i]);
        }
    }

    private static ImmutableArray<MetadataReference> _cachedReferences;

    /// <summary>
    /// References for the compilation that <c>Renamer</c> needs. They come from the assemblies this
    /// process is already running on plus Stemma.Model, so nothing has to be installed or restored.
    /// </summary>
    private static ImmutableArray<MetadataReference> RuntimeReferences()
    {
        if (!_cachedReferences.IsDefault) return _cachedReferences;

        var builder = ImmutableArray.CreateBuilder<MetadataReference>();
        var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

        if (AppContext.GetData("TRUSTED_PLATFORM_ASSEMBLIES") is string tpa)
        {
            foreach (var path in tpa.Split(Path.PathSeparator))
            {
                if (path.Length == 0 || !File.Exists(path)) continue;
                if (!seen.Add(Path.GetFileNameWithoutExtension(path))) continue;
                try { builder.Add(MetadataReference.CreateFromFile(path)); }
                catch (Exception) { /* native or unreadable image — skip it */ }
            }
        }

        // Stemma.Model is what the model source actually references. The engine deliberately does not
        // depend on it (engine purity), so find it by name among the loaded assemblies, falling back
        // to the host's own directory.
        var modelPath = AppDomain.CurrentDomain.GetAssemblies()
            .FirstOrDefault(a => string.Equals(a.GetName().Name, ModelAssemblyName, StringComparison.OrdinalIgnoreCase))
            ?.Location;
        if (string.IsNullOrEmpty(modelPath))
            modelPath = Path.Combine(AppContext.BaseDirectory, ModelAssemblyName + ".dll");

        if (File.Exists(modelPath) && seen.Add(ModelAssemblyName))
            builder.Add(MetadataReference.CreateFromFile(modelPath));

        _cachedReferences = builder.ToImmutable();
        return _cachedReferences;
    }
}

public enum WorkspaceKind
{
    None,
    MsBuild,
    ModelOnly,
}

/// <summary>
/// An in-memory workspace that persists applied changes. Roslyn's own <c>AdhocWorkspace</c> is sealed
/// and keeps everything in memory; Stemma's whole contract is that an edit lands in the file, so text
/// changes, additions and removals are written through — preserving the original encoding and BOM
/// (ADR-0016).
/// </summary>
public sealed class FileBackedWorkspace()
    : Microsoft.CodeAnalysis.Workspace(Microsoft.CodeAnalysis.Host.Mef.MefHostServices.DefaultHost, "Stemma")
{
    public Solution AddSolution(SolutionInfo info)
    {
        OnSolutionAdded(info);
        return CurrentSolution;
    }

    public override bool CanApplyChange(ApplyChangesKind feature) => feature
        is ApplyChangesKind.ChangeDocument
        or ApplyChangesKind.AddDocument
        or ApplyChangesKind.RemoveDocument;

    /// <summary>
    /// Take in text that is already on disk — an outside edit — without writing it back.
    /// <c>TryApplyChanges</c> would persist it, and persisting a file someone else has just saved is
    /// how their next save gets overwritten (B-008).
    /// </summary>
    public void TakeIn(DocumentId id, SourceText text) => OnDocumentTextChanged(id, text, PreservationMode.PreserveValue);

    /// <summary>Take in a file a pull or an IDE has just added, without writing it.</summary>
    public void TakeIn(DocumentInfo document) => OnDocumentAdded(document);

    /// <summary>Let go of a file that is no longer on disk, without trying to delete it.</summary>
    public void TakeOut(DocumentId id) => OnDocumentRemoved(id);

    protected override void ApplyDocumentTextChanged(DocumentId id, SourceText text)
    {
        var path = CurrentSolution.GetDocument(id)?.FilePath;
        if (!string.IsNullOrEmpty(path)) Write(path, text);
        base.ApplyDocumentTextChanged(id, text);
    }

    protected override void ApplyDocumentAdded(DocumentInfo info, SourceText text)
    {
        if (!string.IsNullOrEmpty(info.FilePath))
        {
            var dir = Path.GetDirectoryName(info.FilePath);
            if (!string.IsNullOrEmpty(dir)) Directory.CreateDirectory(dir);
            Write(info.FilePath, text);
        }
        base.ApplyDocumentAdded(info, text);
    }

    protected override void ApplyDocumentRemoved(DocumentId id)
    {
        var path = CurrentSolution.GetDocument(id)?.FilePath;
        if (!string.IsNullOrEmpty(path) && File.Exists(path)) File.Delete(path);
        base.ApplyDocumentRemoved(id);
    }

    private static void Write(string path, SourceText text)
    {
        // SourceText.Write emits the text's own encoding and preamble; falling back to UTF-8 without a
        // BOM matches what the C# tooling produces for new files.
        using var writer = new StreamWriter(path, append: false, text.Encoding ?? new UTF8Encoding(false));
        text.Write(writer);
    }
}
