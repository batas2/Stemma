using System.Diagnostics;
using System.Text;
using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.CSharp;
using Microsoft.CodeAnalysis.CSharp.Syntax;
using Microsoft.CodeAnalysis.MSBuild;
using Microsoft.CodeAnalysis.Rename;
using Microsoft.CodeAnalysis.Text;
using Stemma.Engine.ArchModel;
using Stemma.Engine.Models;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Logging.Abstractions;
using Stemma.Engine.Diagnostics;
using Stemma.Engine.Operations;
using Stemma.Engine.Validation;
using TypeKind = Stemma.Engine.Models.TypeKind;

namespace Stemma.Engine.Workspace;

public sealed class StemmaEngine : IAsyncDisposable
{
    private readonly Microsoft.CodeAnalysis.Workspace _workspace;
    private WorkspaceModel _model;
    private readonly SemaphoreSlim _gate = new(1, 1);
    private readonly UndoStack _undo = new();
    private ExternalWatcher? _watcher;
    private ArchModel.ArchModel? _archBeforeOp;
    private string? _removedFromBeforeOp;
    private IReadOnlyList<DocumentWrite> _lastWrites = [];

    public WorkspaceModel Model => _model;
    public string RootPath => _model.RootPath;
    public UndoStack Undo => _undo;
    public Microsoft.CodeAnalysis.Solution Solution => _workspace.CurrentSolution;
    public event Action<string>? ExternalChange;

    /// <summary>Raised when stemma.layout.json changes on disk by any hand but this engine's (ADR-0021).</summary>
    public event Action? SidecarChanged;

    /// <summary>Raised when comments.stemma.json changes on disk by any hand but this engine's (B-018).</summary>
    public event Action? CommentsChanged;

    private readonly SidecarFile _layout;
    private readonly SidecarFile _comments;

    /// <summary>
    /// Diagnostics only. Defaults to <see cref="NullLogger{T}.Instance"/> so the engine stays
    /// constructible, testable and embeddable with no logging stack present at all (ADR-0020).
    /// </summary>
    private readonly ILogger<StemmaEngine> _log;
    private string _currentOpType = "(none)";

    private StemmaEngine(Microsoft.CodeAnalysis.Workspace workspace, WorkspaceModel model, ILogger<StemmaEngine>? log = null)
    {
        _workspace = workspace;
        _model = model;
        _log = log ?? NullLogger<StemmaEngine>.Instance;
        _layout = new SidecarFile(LayoutSidecar.PathFor(model.RootPath), NewSidecar);
        _comments = new SidecarFile(CommentsSidecar.PathFor(model.RootPath), CommentsSidecar.Empty);
    }

    public void StartWatching()
    {
        _layout.Remember();
        _comments.Remember();
        _watcher?.DisposeAsync().AsTask().GetAwaiter().GetResult();
        _watcher = new ExternalWatcher(_model.RootPath, ShouldWatch, _log);
        _watcher.Changed += OnExternalChange;
    }

    private bool ShouldWatch(string path)
    {
        if (_layout.Is(path) || _comments.Is(path)) return true;
        // Watch Architecture/, every file the workspace holds, and every file it would hold if it
        // were opened now — which is what a file added by a pull is.
        if (IsModelFile(path)) return true;
        return HeldPaths().Contains(path) || ProjectFor(path) is not null;
    }

    private sealed record Held(Solution Solution, HashSet<string> Paths);
    private Held? _held;

    /// <summary>
    /// The paths of the documents the workspace holds, kept for as long as the solution is the same.
    /// The poller asks about every file every second; finding each in the documents one by one was
    /// files × documents comparisons a second — nine million at 3,000 files.
    /// </summary>
    private HashSet<string> HeldPaths()
    {
        var solution = _workspace.CurrentSolution;
        if (Volatile.Read(ref _held) is { } held && ReferenceEquals(held.Solution, solution)) return held.Paths;
        var paths = solution.Projects.SelectMany(p => p.Documents).Select(d => d.FilePath).OfType<string>()
            .ToHashSet(StringComparer.OrdinalIgnoreCase);
        Volatile.Write(ref _held, new Held(solution, paths));
        return paths;
    }

    /// <summary>
    /// The project a source file at <paramref name="path"/> would belong to if the workspace were
    /// opened now: the one project of a model-only workspace, or the project whose directory holds
    /// it, the deepest if they nest. None for what the loader skips — bin, obj, generated files.
    /// </summary>
    private Project? ProjectFor(string path)
    {
        if (!path.EndsWith(".cs", StringComparison.OrdinalIgnoreCase) || path.EndsWith(".g.cs", StringComparison.OrdinalIgnoreCase)) return null;
        if (!IsUnder(_model.RootPath, path) || ModelWorkspaceLoader.IsExcluded(_model.RootPath, path)) return null;
        var projects = _workspace.CurrentSolution.Projects;
        if (_workspace is FileBackedWorkspace) return projects.FirstOrDefault();
        return projects
            .Where(p => p.FilePath is { Length: > 0 } file && IsUnder(Path.GetDirectoryName(file)!, path))
            .OrderByDescending(p => p.FilePath!.Length)
            .FirstOrDefault();
    }

    /// <summary>
    /// The project that compiles <paramref name="path"/>, a file the workspace does not hold yet (a pull
    /// just added it), or null. A model-only workspace compiles every source it would load. A project
    /// compiles what its evaluation says — not every .cs file in its folder: one kept out of the build
    /// with <c>&lt;Compile Remove&gt;</c> (a fixture, a sample) was taken in, and the model it declares
    /// joined the live one. Evaluating takes most of a second, so each project's answer is kept until
    /// its project file changes.
    /// </summary>
    private async Task<Project?> CompilingProjectAsync(string path, CancellationToken ct)
    {
        if (ProjectFor(path) is not { } project) return null;
        if (_workspace is FileBackedWorkspace || project.FilePath is not { Length: > 0 } projectFile) return project;

        var written = File.GetLastWriteTimeUtc(projectFile);
        if (!_compileItems.TryGetValue(projectFile, out var known) || known.ProjectWritten != written)
            _compileItems[projectFile] = known = (written, null, new HashSet<string>(StringComparer.OrdinalIgnoreCase));
        if (known.Compiled?.Contains(path) == true) return project;
        if (known.NotCompiled.Contains(path)) return null;

        // A file neither answer covers is newer than the last evaluation: evaluate again, which also
        // answers for every other file added since.
        HashSet<string> compiled;
        try { compiled = await WorkspaceLoader.CompileItemsAsync(_workspace, projectFile, ct); }
        catch (Exception e) when (e is not OperationCanceledException)
        {
            // The project cannot be evaluated now (a broken project file mid-edit): the folder is the
            // best answer there is, as it always was.
            EngineLog.ProjectEvaluationFailed(_log, projectFile, e);
            return project;
        }
        _compileItems[projectFile] = known = (written, compiled, known.NotCompiled);
        if (compiled.Contains(path)) return project;
        known.NotCompiled.Add(path);
        return null;
    }

    /// <summary>Per project file: when it was written, what its last evaluation compiled, and files found not to be compiled.</summary>
    private readonly Dictionary<string, (DateTime ProjectWritten, HashSet<string>? Compiled, HashSet<string> NotCompiled)> _compileItems =
        new(StringComparer.OrdinalIgnoreCase);

    /// <summary>
    /// The refusal for an operation whose own values are unacceptable, or null. Checked before anything
    /// else, because these values are pasted into source text or used as a path: a name that is not an
    /// identifier would be code, and a path outside the workspace would be a write anywhere on disk.
    /// </summary>
    private OperationFailed? Refuse(OperationBase op)
    {
        static bool Identifier(string? s) => !string.IsNullOrEmpty(s) && SyntaxFacts.IsValidIdentifier(s);
        static bool DottedName(string? s) => !string.IsNullOrEmpty(s) && s.Split('.').All(Identifier);
        switch (op)
        {
            case AddTypeOp x:
                string full;
                try { full = Path.GetFullPath(x.FilePath, _model.RootPath); }
                catch (Exception) { return new(x.OpId, "OutsideWorkspace", $"'{x.FilePath}' is not a path"); }
                if (!IsUnder(_model.RootPath, full) || !full.EndsWith(".cs", StringComparison.OrdinalIgnoreCase))
                    return new(x.OpId, "OutsideWorkspace", $"A type can only be added to a .cs file inside the workspace, not '{x.FilePath}'");
                if (full.EndsWith(".g.cs", StringComparison.OrdinalIgnoreCase))
                    return new(x.OpId, "GeneratedFile", "Generated files are never edited");
                // Build output, or a file that exists but is not one the workspace holds: writing a new
                // document there would replace whatever is in it.
                if (ModelWorkspaceLoader.IsExcluded(_model.RootPath, full))
                    return new(x.OpId, "OutsideWorkspace", $"'{x.FilePath}' is in a folder the workspace leaves out");
                if (File.Exists(full) && FindDocument(full) is null)
                    return new(x.OpId, "OutsideWorkspace", $"'{x.FilePath}' exists but is not part of the workspace; it is not overwritten");
                if (!Identifier(x.Name)) return new(x.OpId, "InvalidName", $"'{x.Name}' is not a C# type name");
                if (!DottedName(x.Namespace)) return new(x.OpId, "InvalidName", $"'{x.Namespace}' is not a C# namespace");
                return null;
            case RenameTypeOp x when !Identifier(x.NewName):
                return new(x.OpId, "InvalidName", $"'{x.NewName}' is not a C# type name");
            case AddPropertyOp x when !Identifier(x.Name):
                return new(x.OpId, "InvalidName", $"'{x.Name}' is not a C# property name");
            case AddPropertyOp x when SyntaxFactory.ParseTypeName(x.TypeName ?? "") is var t && (t.ContainsDiagnostics || t.ToString() != (x.TypeName ?? "").Trim()):
                return new(x.OpId, "InvalidName", $"'{x.TypeName}' is not a C# type");
            case RenamePropertyOp x when !Identifier(x.NewName):
                return new(x.OpId, "InvalidName", $"'{x.NewName}' is not a C# property name");
            default:
                return null;
        }
    }

    /// <summary>
    /// Whether <paramref name="path"/> is in a folder called <paramref name="folder"/> inside the
    /// workspace, at any depth — counted from the workspace root, never from the top of the disk.
    /// Looked for in the absolute path, a workspace kept in ~/Architecture/shop took every file in it
    /// for a model file.
    /// </summary>
    private bool InFolder(string path, string folder)
    {
        if (!IsUnder(_model.RootPath, path)) return false;
        var segments = Path.GetRelativePath(_model.RootPath, path).Split(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar);
        return segments.SkipLast(1).Contains(folder, StringComparer.OrdinalIgnoreCase);
    }

    /// <summary>A model file by the rule every reader uses (<see cref="ArchModelMerge.IsModelFile"/>), counted from the workspace root.</summary>
    private bool IsModelFile(string path) =>
        IsUnder(_model.RootPath, path) && ArchModelMerge.IsModelFile(Path.GetRelativePath(_model.RootPath, path));

    private static bool IsUnder(string directory, string path)
    {
        var relative = Path.GetRelativePath(directory, path);
        return !relative.StartsWith("..", StringComparison.Ordinal) && !Path.IsPathRooted(relative);
    }

    private async void OnExternalChange(string path)
    {
        if (_layout.Is(path))
        {
            await TakeInAsync(_layout, () => SidecarChanged?.Invoke());
            return;
        }
        if (_comments.Is(path))
        {
            await TakeInAsync(_comments, () => CommentsChanged?.Invoke());
            return;
        }
        await _gate.WaitAsync();
        try
        {
            if (_disposed) return;
            // The echo of Stemma's own write is told apart by content, not by time: the file says
            // exactly what the workspace holds, so there is nothing to take in. A window of "writes
            // within 1.5 s are ours" also swallowed a real save made inside it, and the engine then
            // never saw that save at all.
            if (!await TakeInFromDiskAsync(path, CancellationToken.None)) return;
            await ReloadAsync();
            _undo.OnExternalChange();
            ExternalChange?.Invoke(path);
        }
        catch (Exception e)
        {
            // async void: an exception here would take the process down. The canvas is stale until
            // the next change, which is the failure the record names.
            EngineLog.ExternalChangeFailed(_log, e);
        }
        finally { _gate.Release(); }
    }

    /// <summary>
    /// Bring the workspace's copy of <paramref name="path"/> into line with the disk, and say whether
    /// it differed. Read through <see cref="SourceText"/> so the encoding and BOM are detected rather
    /// than assumed, which is what makes a later edit write them back unchanged.
    /// </summary>
    private async Task<bool> TakeInFromDiskAsync(string path, CancellationToken ct)
    {
        var doc = _workspace.CurrentSolution.Projects
            .SelectMany(p => p.Documents)
            .FirstOrDefault(d => string.Equals(d.FilePath, path, StringComparison.OrdinalIgnoreCase));
        if (doc is null)
        {
            // A file the workspace does not hold: one a pull or an IDE has just added, if it is a
            // source the workspace would have loaded, and otherwise nothing to do with the model.
            // Not taken in, a view that arrived this way was saved into a second file with its id.
            if (!File.Exists(path) || await CompilingProjectAsync(path, ct) is not { } project) return false;
            await TakeInAddedAsync(project, path, ReadFromDisk(path), ct);
            return true;
        }
        if (!File.Exists(path))
        {
            // Deleted outside: it leaves the workspace. Kept, it went on being compiled and read
            // into the model, and when it came back with the same text that was taken for an echo.
            await TakeOutAsync(doc, ct);
            return true;
        }

        var disk = ReadFromDisk(path);
        var current = await doc.GetTextAsync(ct);
        if (current.ContentEquals(disk) && SamePreamble(current.Encoding, disk.Encoding)) return false;

        if (_workspace is FileBackedWorkspace fileBacked)
        {
            fileBacked.TakeIn(doc.Id, disk);
        }
        else
        {
            // MSBuildWorkspace has no way to update a document without persisting it, so this writes
            // the bytes it just read straight back — identical, encoding included — and its echo
            // finds nothing to take in. Identical only for UTF-8: anything else was read with its other
            // bytes replaced by U+FFFD, and writing that back damaged a file nobody had asked Stemma to
            // touch. Such a file is left as it is on disk, and any edit to it is refused (CommitAsync).
            if (!IsUtf8(await File.ReadAllBytesAsync(path, ct))) return false;
            _workspace.TryApplyChanges(doc.WithText(disk).Project.Solution);
        }
        return true;
    }

    private async Task TakeInAddedAsync(Project project, string path, SourceText text, CancellationToken ct)
    {
        if (_workspace is FileBackedWorkspace fileBacked)
        {
            fileBacked.TakeIn(DocumentInfo.Create(
                DocumentId.CreateNewId(project.Id, path),
                Path.GetFileName(path),
                loader: TextLoader.From(TextAndVersion.Create(text, VersionStamp.Create(), path)),
                filePath: path));
            return;
        }
        // MSBuildWorkspace writes what it adds, the same bytes it was just given, and lists the file
        // in the project, which globs its sources and needs no such item; that is put back.
        var projectDir = Path.GetDirectoryName(project.FilePath)!;
        var folders = Path.GetRelativePath(projectDir, Path.GetDirectoryName(path)!)
            .Split(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar)
            .Where(s => s is not ("." or ""))
            .ToArray();
        var projectFiles = await SnapshotProjectFilesAsync(_workspace.CurrentSolution, ct);
        _workspace.TryApplyChanges(project.AddDocument(Path.GetFileName(path), text, folders, path).Project.Solution);
        await RestoreProjectFilesAsync(projectFiles, ct);
    }

    private async Task TakeOutAsync(Document doc, CancellationToken ct)
    {
        if (_workspace is FileBackedWorkspace fileBacked)
        {
            fileBacked.TakeOut(doc.Id);
            return;
        }
        var projectFiles = await SnapshotProjectFilesAsync(_workspace.CurrentSolution, ct);
        _workspace.TryApplyChanges(_workspace.CurrentSolution.RemoveDocument(doc.Id));
        await RestoreProjectFilesAsync(projectFiles, ct);
    }

    /// <summary>What a sidecar Stemma creates starts as: the schema it is written against, and a version.</summary>
    private static readonly string NewSidecar = $"{{\n  \"$schema\": \"{LayoutSidecar.SchemaUrl}\",\n  \"version\": 1\n}}\n";

    private async Task TakeInAsync(SidecarFile file, Action announce)
    {
        try
        {
            if (await file.TakeInAsync()) announce();
        }
        catch (Exception e)
        {
            // async void upstream: an exception here would take the process down.
            EngineLog.ExternalChangeFailed(_log, e);
        }
    }

    /// <summary>
    /// Apply <paramref name="changes"/> to stemma.layout.json as it is on disk now, through
    /// <see cref="SidecarPatch"/>: only the values that changed are written, and every other byte —
    /// including what someone else changed since the canvas read the file — stays (ADR-0021, B-014).
    /// A file that does not parse is refused, never replaced.
    /// </summary>
    public Task<OperationResult> PatchSidecarAsync(string opId, IReadOnlyList<SidecarChange> changes, CancellationToken ct = default) =>
        LoggedAsync("PatchSidecar", () => _layout.PatchAsync(opId, text => SidecarPatch.Apply(text, changes), ct));

    /// <summary>
    /// Apply <paramref name="changes"/> to comments.stemma.json as it is on disk now, through
    /// <see cref="CommentsPatch"/>: a comment added, answered, resolved or removed is that one change,
    /// and a comment someone else wrote since the panel read the file stays (B-018). A file that does
    /// not parse is refused, never replaced.
    /// </summary>
    public Task<OperationResult> PatchCommentsAsync(string opId, IReadOnlyList<CommentChange> changes, CancellationToken ct = default) =>
        LoggedAsync("PatchComments", () => _comments.PatchAsync(opId, text => CommentsPatch.Apply(text, changes), ct));

    private static SourceText ReadFromDisk(string path)
    {
        using var stream = File.OpenRead(path);
        return SourceText.From(stream, new System.Text.UTF8Encoding(encoderShouldEmitUTF8Identifier: false));
    }

    /// <summary>Bytes already read, decoded as <see cref="ReadFromDisk"/> decodes a file.</summary>
    private static SourceText Decode(byte[] bytes)
    {
        using var stream = new MemoryStream(bytes, writable: false);
        return SourceText.From(stream, new System.Text.UTF8Encoding(encoderShouldEmitUTF8Identifier: false));
    }

    private static bool SamePreamble(System.Text.Encoding? a, System.Text.Encoding? b) =>
        (a?.GetPreamble() ?? []).AsSpan().SequenceEqual(b?.GetPreamble() ?? []);

    public static async Task<StemmaEngine> OpenAsync(string rootPath, CancellationToken ct = default, ILogger<StemmaEngine>? log = null)
    {
        var logger = log ?? NullLogger<StemmaEngine>.Instance;
        var started = Stopwatch.GetTimestamp();

        // A repository is loaded through MSBuild; a model that is only model needs no project system
        // and no installed SDK to read (ADR-0016).
        try
        {
            return await OpenCoreAsync(rootPath, ct, log, logger, started);
        }
        catch (Exception e)
        {
            // Opening is where a user most often meets a failure, and it is exactly the moment the
            // desktop shell has no console to print to. Rethrown: the caller still decides.
            EngineLog.WorkspaceOpenFailed(logger, e);
            throw;
        }
    }

    private static async Task<StemmaEngine> OpenCoreAsync(
        string rootPath, CancellationToken ct, ILogger<StemmaEngine>? log, ILogger<StemmaEngine> logger, long started)
    {
        var kind = ModelWorkspaceLoader.DetectKind(rootPath);
        EngineLog.LoaderSelected(logger, kind.ToString());
        switch (kind)
        {
            case WorkspaceKind.MsBuild:
            {
                var (ws, model) = await new WorkspaceLoader(logger).LoadAsync(rootPath, ct);
                var engine = new StemmaEngine(ws, model, log);
                engine.LogOpened(started);
                return engine;
            }
            case WorkspaceKind.ModelOnly:
            {
                var (ws, model) = ModelWorkspaceLoader.Load(rootPath);
                var engine = new StemmaEngine(ws, model, log);
                engine.LogOpened(started);
                return engine;
            }
            default:
                throw new InvalidOperationException(
                    $"Nothing to open in {rootPath}: expected a .sln, a .csproj, " +
                    $"or an {ModelWorkspaceLoader.ArchitectureDir}/ directory containing C# model files.");
        }
    }

    public async Task<OperationResult> ApplyAsync(OperationBase op, CancellationToken ct = default)
    {
        await _gate.WaitAsync(ct);
        try
        {
            if (_disposed) return Closed(op.OpId);
            return await ApplyInternalAsync(op, recordUndo: true, ct);
        }
        finally
        {
            _gate.Release();
        }
    }

    private async Task<OperationResult> ApplyInternalAsync(OperationBase op, bool recordUndo, CancellationToken ct)
    {
        var startedAt = Stopwatch.GetTimestamp();
        // Named on the write records below. Safe as a field because `_gate` serialises operations.
        _currentOpType = op.GetType().Name;
        // Filled by CommitAsync; cleared first so an op that commits nothing cannot inherit the
        // previous op's writes as its undo.
        _lastWrites = [];
        // Capture the arch model state BEFORE the op so we can build inverse ops.
        if (recordUndo)
        {
            try
            {
                _archBeforeOp = await ReadArchModelAsync(ct);
                _removedFromBeforeOp = op switch
                {
                    RemoveElementOp r => FindDocumentForId(r.ElementId)?.FilePath,
                    RemoveLinkOp r => FindDocumentForId(r.LinkId)?.FilePath,
                    _ => null,
                };
            }
            catch (Exception e)
            {
                // Undo for this operation is now impossible. Continuing is right — the edit itself is
                // still valid — but it must not be silent: "undo stopped working" was unanswerable
                // while this was a bare `catch { }`.
                _archBeforeOp = null;
                _removedFromBeforeOp = null;
                EngineLog.UndoSnapshotUnavailable(_log, op.GetType().Name, e);
            }
        }

        // Names and paths an operation carries become C# text and file locations. Anything that is not a
        // C# name, or a file outside this workspace (or a generated one), is refused before it is used.
        if (Refuse(op) is { } refused)
        {
            EngineLog.OperationFailed(_log, op.GetType().Name, 0, $"{refused.Reason}: {refused.Message}", null);
            return refused;
        }

        var result = op switch
        {
            AddTypeOp x => await AddTypeAsync(x, ct),
            RenameTypeOp x => await RenameTypeAsync(x, ct),
            RemoveTypeOp x => await RemoveTypeAsync(x, ct),
            AddPropertyOp x => await AddPropertyAsync(x, ct),
            RenamePropertyOp x => await RenamePropertyAsync(x, ct),
            RemovePropertyOp x => await RemovePropertyAsync(x, ct),
            AddInheritanceOp x => await AddInheritanceAsync(x, ct),
            RemoveInheritanceOp x => await RemoveInheritanceAsync(x, ct),
            AddImplementationOp x => await AddImplementationAsync(x, ct),
            RemoveImplementationOp x => await RemoveImplementationAsync(x, ct),
            AddElementOp x => await AddArchElementAsync(x, ct),
            RenameElementOp x => await RenameArchElementAsync(x, ct),
            RemoveElementOp x => await RemoveArchElementAsync(x, ct),
            AddLinkOp x => await AddArchLinkAsync(x, ct),
            RemoveLinkOp x => await RemoveArchLinkAsync(x, ct),
            SetLinkAttributeOp x => await SetLinkAttributeAsync(x, ct),
            SetLifecycleOp x => await SetLifecycleAsync(x, ct),
            SetOwnershipOp x => await SetOwnershipAsync(x, ct),
            RestoreElementOp x => await RestoreArchElementAsync(x, ct),
            RestoreLinkOp x => await RestoreArchLinkAsync(x, ct),
            RestoreDocumentsOp x => await RestoreDocumentsAsync(x, ct),
            SetElementContextOp x => await SetElementContextAsync(x, ct),
            SetElementAttributeOp x => await SetElementAttributeAsync(x, ct),
            _ => new OperationFailed(op.OpId, "UnknownOp", $"Unknown op {op.GetType().Name}")
        };

        if (recordUndo && result is OperationApplied done)
        {
            // What the edit wrote is the undo; the inverse operation is only the fallback for when
            // the file has changed since (see RestoreDocumentsOp).
            var writes = _lastWrites;
            var fallback = UndoStack.BuildInverse(op, _archBeforeOp, _removedFromBeforeOp) ?? InverseOfAdd(done);
            if (writes.Count > 0 || fallback is not null)
                _undo.Push(RedoOf(op, done), new RestoreDocumentsOp($"undo_{Guid.NewGuid():N}", writes, fallback), DescribeOp(op));
        }
        // AC1 — exactly one record per operation, whatever happened. The elapsed time is here rather
        // than on each branch so no path can complete without one.
        var elapsedMs = (long)Stopwatch.GetElapsedTime(startedAt).TotalMilliseconds;
        if (result is OperationApplied applied)
            EngineLog.OperationApplied(_log, op.GetType().Name, elapsedMs, applied.Deltas.Count);
        else if (result is OperationFailed failed)
            EngineLog.OperationFailed(_log, op.GetType().Name, elapsedMs, $"{failed.Reason}: {failed.Message}", null);

        return result;
    }

    private void LogOpened(long startedAt)
    {
        var docs = _workspace.CurrentSolution.Projects.SelectMany(p => p.Documents).Count();
        var arch = ReadArchModelAsync(CancellationToken.None).GetAwaiter().GetResult();
        EngineLog.WorkspaceOpened(_log, arch?.Elements.Count ?? 0, arch?.Links.Count ?? 0, docs,
            (long)Stopwatch.GetElapsedTime(startedAt).TotalMilliseconds);
    }

    /// <summary>
    /// What a redo applies: the operation again — except an add, which is redone with the id it made.
    /// Generated afresh, the id would be a different one as soon as anything names the first (the new
    /// box was placed before it was undone, so the layout does), and the element would come back
    /// without its place.
    /// </summary>
    private static OperationBase RedoOf(OperationBase op, OperationApplied applied) => (op, applied.Deltas.FirstOrDefault()) switch
    {
        (AddElementOp a, ElementAdded e) => new RestoreElementOp(a.OpId, e.Id, a.Name, a.ElementKind, a.ContextId, a.SystemId, a.ContainerKind, a.Role),
        (AddLinkOp a, LinkAdded l) => new RestoreLinkOp(a.OpId, l.Id, a.FromId, a.ToId, a.LinkKind, a.Payload, a.Direction, a.DependencyKind),
        _ => op,
    };

    private static string DescribeOp(OperationBase op) => op switch
    {
        AddElementOp x => $"Add {x.ElementKind} \"{x.Name}\"",
        RenameElementOp x => $"Rename to \"{x.NewName}\"",
        RemoveElementOp x => "Remove element",
        AddLinkOp x => $"Add {x.LinkKind}",
        RemoveLinkOp _ => "Remove link",
        SetLinkAttributeOp x => $"Set {x.AttributeName}",
        SetLifecycleOp _ => "Set lifecycle",
        SetOwnershipOp _ => "Set ownership",
        SetElementContextOp _ => "Move to bounded context",
        SetElementAttributeOp _ => "Set attribute",
        _ => op.GetType().Name
    };

    public async Task ReloadAsync(CancellationToken ct = default)
    {
        _model = await WorkspaceLoader.BuildModelAsync(_model.RootPath, _workspace.CurrentSolution, ct);
    }

    /// <summary>
    /// Close the workspace: stop watching first, so nothing new starts; then wait for whatever holds
    /// the engine's lock — an edit, an undo, an outside change being taken in — to finish, so it is
    /// never cut off half-written; then let go. Disposed without the lock, a reload the watcher had
    /// started ran on into a workspace that was gone. Anything asked of the engine afterwards is
    /// refused as WorkspaceClosed.
    /// </summary>
    public async ValueTask DisposeAsync()
    {
        if (_watcher is not null) await _watcher.DisposeAsync();
        await _gate.WaitAsync();
        try
        {
            if (_disposed) return;
            _disposed = true;
            await _lifetime.CancelAsync();
            _workspace.Dispose();
            EngineLog.WorkspaceClosed(_log);
        }
        finally { _gate.Release(); }
    }

    private bool _disposed;

    private static OperationFailed Closed(string opId) => new(opId, "WorkspaceClosed", "The workspace has been closed.");

    public async Task<OperationResult> UndoAsync(string opId, CancellationToken ct = default)
    {
        await _gate.WaitAsync(ct);
        try
        {
            if (_disposed) return Closed(opId);
            var entry = _undo.PeekUndo();
            if (entry is null) return new OperationFailed(opId, "NothingToUndo", "Undo stack is empty");
            // Apply the inverse op without re-pushing onto the undo stack. The entry moves to the redo
            // branch only once it has been undone; refused, it is still the next undo.
            var inverse = entry.Inverse with { OpId = opId };
            var result = await ApplyInternalAsync(inverse, recordUndo: false, ct);
            if (result is OperationApplied) _undo.Undone(entry);
            return result;
        }
        finally { _gate.Release(); }
    }

    public async Task<OperationResult> RedoAsync(string opId, CancellationToken ct = default)
    {
        await _gate.WaitAsync(ct);
        try
        {
            if (_disposed) return Closed(opId);
            var entry = _undo.PeekRedo();
            if (entry is null) return new OperationFailed(opId, "NothingToRedo", "Redo stack is empty");
            var forward = entry.Forward with { OpId = opId };
            var result = await ApplyInternalAsync(forward, recordUndo: false, ct);
            if (result is OperationApplied) _undo.Redone(entry);
            else _undo.RedoFailed(entry);
            return result;
        }
        finally { _gate.Release(); }
    }

    private Document? FindDocument(string filePath) =>
        _workspace.CurrentSolution.Projects
            .SelectMany(p => p.Documents)
            .FirstOrDefault(d => string.Equals(d.FilePath, filePath, StringComparison.OrdinalIgnoreCase));

    private async Task<OperationResult> CommitAsync(
        string opId,
        Solution oldSolution,
        Solution newSolution,
        Func<OperationResult> buildSuccessResult,
        CancellationToken ct)
    {
        var changes = newSolution.GetChanges(oldSolution);
        // The files it changes or removes, as the edit saw them, and the files it creates.
        var edited = new List<(string Path, Document Before)>();
        var added = new List<string>();
        foreach (var projectChange in changes.GetProjectChanges())
        {
            foreach (var docId in projectChange.GetChangedDocuments().Concat(projectChange.GetRemovedDocuments()))
                if (oldSolution.GetDocument(docId) is { FilePath: { } path } before) edited.Add((path, before));
            foreach (var docId in projectChange.GetAddedDocuments())
                if (newSolution.GetDocument(docId)?.FilePath is { } path) added.Add(path);
        }

        // Capture the errors that already exist BEFORE the edit. The compile gate must only
        // reject errors the op itself INTRODUCES — a workspace can carry pre-existing or
        // environmental errors (e.g. an unresolved reference, or a framework that didn't load
        // in this host) and the user should still be able to edit it. Signatures drop source
        // locations so a pre-existing error that merely shifts down a line when the op inserts
        // a statement isn't mistaken for a new one.
        //
        // First, because it is the slow part: a whole compile. Between checking the files against
        // the disk and writing them there must be nothing that takes time, or a save made in it is
        // written over — which is what the check is there to prevent.
        var affected = AffectedProjects(changes, newSolution);
        var baselineErrors = await CollectErrorSignaturesAsync(oldSolution, affected, ct);
        var projectFiles = await SnapshotProjectFilesAsync(oldSolution, ct);

        // Now every file the edit touches, read once: the bytes are what a failure puts back — BOM,
        // line endings and all — and what the edit is checked against; the text is for the record of
        // what changed.
        var raw = new Dictionary<string, byte[]?>(StringComparer.OrdinalIgnoreCase);
        var backups = new Dictionary<string, string?>();
        foreach (var path in edited.Select(e => e.Path).Concat(added).Distinct(StringComparer.OrdinalIgnoreCase))
        {
            var bytes = File.Exists(path) ? await File.ReadAllBytesAsync(path, ct) : null;
            raw[path] = bytes;
            backups[path] = bytes is null ? null : Encoding.UTF8.GetString(bytes.AsSpan().StartsWith(Utf8Bom) ? bytes[Utf8Bom.Length..] : bytes);
        }

        // A file that is not UTF-8 is read with each byte that is not replaced by U+FFFD, so writing it
        // back would damage every such character in it, edited or not. It is not edited.
        foreach (var (path, _) in edited)
        {
            if (raw.GetValueOrDefault(path) is { } bytes && !IsUtf8(bytes))
                return new OperationFailed(opId, "NotUtf8",
                    $"{Path.GetFileName(path)} is not saved as UTF-8, so Stemma does not edit it: rewriting it would damage its other characters. Save it as UTF-8, then try again.");
        }

        // Never write over a version of a file this edit was not computed from. Between someone's
        // save and the watcher noticing it there is a window of a second or so, and an edit applied
        // in it would put the old text back with the new change on top (B-008). A file deleted in
        // that window has changed too: skipped, the write recreated it. And a file the edit creates
        // must not have appeared in the meantime.
        var outside = new List<(string Path, string What)>();
        foreach (var (path, before) in edited)
        {
            if (raw.GetValueOrDefault(path) is not { } bytes) outside.Add((path, "was deleted outside Stemma since it was last read"));
            else if (!(await before.GetTextAsync(ct)).ContentEquals(Decode(bytes))) outside.Add((path, "changed outside Stemma since it was last read"));
        }
        foreach (var path in added)
            if (raw.GetValueOrDefault(path) is not null) outside.Add((path, "was created outside Stemma since this edit was made"));
        if (outside.Count > 0)
        {
            // Every one of them taken in, so that trying again lands on top of all of them.
            foreach (var (path, _) in outside) await TakeInFromDiskAsync(path, ct);
            await ReloadAsync(ct);
            _undo.OnExternalChange();
            foreach (var (path, _) in outside) ExternalChange?.Invoke(path);
            var (first, what) = outside[0];
            return new OperationFailed(opId, "ChangedOnDisk", $"{Path.GetFileName(first)} {what}. The new version is loaded; try again.");
        }

        // From here on the files are being written, and an edit half-made is worse than one finished
        // or one undone: the caller's cancellation (a closed tab) no longer applies, and anything that
        // goes wrong puts every file back as it was.
        var settled = CancellationToken.None;
        try
        {
            if (!_workspace.TryApplyChanges(newSolution))
                return new OperationFailed(opId, "ApplyFailed", "TryApplyChanges returned false");
            await RestoreProjectFilesAsync(projectFiles, settled);

            var introduced = await CollectIntroducedErrorsAsync(baselineErrors, affected, settled);
            if (introduced.Count > 0)
            {
                await RollBackAsync(raw, projectFiles);
                return new OperationFailed(opId, "WouldBreakBuild", "This change introduced compile errors and was rolled back.", introduced);
            }
        }
        catch (Exception e) when (e is not OperationCanceledException)
        {
            // A file it could not write (read-only, locked) after others were written: all of them back.
            await RollBackAsync(raw, projectFiles);
            return new OperationFailed(opId, "WriteFailed", $"The change could not be written, and nothing was changed: {e.Message}");
        }

        await VerifyWritesAsync(newSolution, backups, settled);
        _lastWrites = await DescribeWritesAsync(changes, oldSolution, newSolution, settled);

        await ReloadAsync(settled);
        // An edit that wrote its files and then cannot say it did what was asked is put back: it either
        // happened, or nothing is left of it.
        var result = buildSuccessResult();
        if (result is OperationFailed)
        {
            _lastWrites = [];
            await RollBackAsync(raw, projectFiles);
        }
        return result;
    }

    private static readonly byte[] Utf8Bom = [0xEF, 0xBB, 0xBF];
    private static readonly UTF8Encoding StrictUtf8 = new(encoderShouldEmitUTF8Identifier: false, throwOnInvalidBytes: true);

    private static bool IsUtf8(byte[] bytes)
    {
        try { StrictUtf8.GetString(bytes.AsSpan().StartsWith(Utf8Bom) ? bytes[Utf8Bom.Length..] : bytes); return true; }
        catch (DecoderFallbackException) { return false; }
    }

    /// <summary>
    /// Put every file an edit touched back to the bytes it had — BOM included; restored as text it lost
    /// it — and the workspace's own copy of each with it. Rolling the workspace back to the solution the
    /// edit started from is refused once that solution is out of date, which left the refused edit in
    /// the model: the next operation then failed for a file "changed on disk", or an element "not found".
    /// Taking each file in from disk is the path an outside edit takes, and it holds whatever the files
    /// now say.
    /// </summary>
    private async Task RollBackAsync(IReadOnlyDictionary<string, byte[]?> raw, IReadOnlyList<(string Path, byte[] Bytes)> projectFiles)
    {
        foreach (var (path, original) in raw)
        {
            try
            {
                if (original is null) { if (File.Exists(path)) File.Delete(path); }
                else await SidecarFile.WriteAtomicallyAsync(path, original);
            }
            catch (Exception e) when (e is IOException or UnauthorizedAccessException)
            {
                EngineLog.ExternalChangeFailed(_log, e);
            }
        }
        await RestoreProjectFilesAsync(projectFiles, CancellationToken.None);
        foreach (var path in raw.Keys)
        {
            try { await TakeInFromDiskAsync(path, CancellationToken.None); }
            catch (Exception e) when (e is IOException or UnauthorizedAccessException) { EngineLog.ExternalChangeFailed(_log, e); }
        }
        await ReloadAsync(CancellationToken.None);
    }

    /// <summary>
    /// The project files as they are before an edit, so they can be put back after it. Adding a
    /// document through MSBuildWorkspace writes an explicit <c>&lt;Compile Include&gt;</c> into the
    /// project; in an SDK-style project that already compiles the file by glob, that item is a
    /// duplicate and the user's next build fails. Stemma edits the model, never the project — unless
    /// the project opts out of the glob, in which case the item is the only thing that compiles the
    /// file, and is kept.
    /// </summary>
    private static async Task<IReadOnlyList<(string Path, byte[] Bytes)>> SnapshotProjectFilesAsync(Solution solution, CancellationToken ct)
    {
        var snapshot = new List<(string, byte[])>();
        foreach (var path in solution.Projects.Select(p => p.FilePath).OfType<string>().Distinct(StringComparer.OrdinalIgnoreCase))
        {
            if (!File.Exists(path)) continue;
            var bytes = await File.ReadAllBytesAsync(path, ct);
            if (System.Text.Encoding.UTF8.GetString(bytes).Contains("<EnableDefaultCompileItems>false", StringComparison.OrdinalIgnoreCase)) continue;
            snapshot.Add((path, bytes));
        }
        return snapshot;
    }

    private static async Task RestoreProjectFilesAsync(IReadOnlyList<(string Path, byte[] Bytes)> snapshot, CancellationToken ct)
    {
        foreach (var (path, bytes) in snapshot)
        {
            if (File.Exists(path) && (await File.ReadAllBytesAsync(path, ct)).AsSpan().SequenceEqual(bytes)) continue;
            await File.WriteAllBytesAsync(path, bytes, ct);
        }
    }

    /// <summary>The tree each changed or added document had before this commit, and the text it has now.</summary>
    private static async Task<IReadOnlyList<DocumentWrite>> DescribeWritesAsync(
        SolutionChanges changes, Solution oldSolution, Solution newSolution, CancellationToken ct)
    {
        var writes = new List<DocumentWrite>();
        foreach (var projectChange in changes.GetProjectChanges())
        {
            foreach (var docId in projectChange.GetChangedDocuments().Concat(projectChange.GetAddedDocuments()))
            {
                var after = newSolution.GetDocument(docId);
                if (after?.FilePath is null) continue;
                var before = oldSolution.GetDocument(docId);
                var beforeRoot = before is null ? null : await before.GetSyntaxRootAsync(ct);
                writes.Add(new DocumentWrite(after.FilePath, beforeRoot, (await after.GetTextAsync(ct)).ToString()));
            }
        }
        return writes;
    }

    private async Task<OperationResult> RestoreDocumentsAsync(RestoreDocumentsOp op, CancellationToken ct)
    {
        var oldSolution = _workspace.CurrentSolution;
        var newSolution = oldSolution;
        foreach (var write in op.Writes)
        {
            var doc = newSolution.Projects.SelectMany(p => p.Documents)
                .FirstOrDefault(d => string.Equals(d.FilePath, write.FilePath, StringComparison.OrdinalIgnoreCase));
            var current = doc is null ? null : (await doc.GetTextAsync(ct)).ToString();
            if (doc is null || current != write.After)
            {
                // Someone else has written to this file since. Its old bytes would erase their change.
                if (op.Fallback is not null)
                    return await ApplyInternalAsync(op.Fallback with { OpId = op.OpId }, recordUndo: false, ct);
                return new OperationFailed(op.OpId, "UndoConflict",
                    $"{Path.GetFileName(write.FilePath)} has changed since this edit, so it cannot be undone exactly.");
            }
            newSolution = write.Before is null
                ? newSolution.RemoveDocument(doc.Id)
                : newSolution.WithDocumentSyntaxRoot(doc.Id, write.Before);
        }
        return await CommitAsync(op.OpId, oldSolution, newSolution, () => new OperationApplied(op.OpId, []), ct);
    }

    /// <summary>
    /// An add's fallback inverse: remove the id it generated, as its result says. Looked for in the
    /// model by kind and name, it was the highest such id — another element of the same name, when the
    /// new one sorted lower, and undo removed that one instead.
    /// </summary>
    private static OperationBase? InverseOfAdd(OperationApplied applied) => applied.Deltas.FirstOrDefault() switch
    {
        ElementAdded e => new RemoveElementOp($"undo_{Guid.NewGuid():N}", e.Id),
        LinkAdded l => new RemoveLinkOp($"undo_{Guid.NewGuid():N}", l.Id),
        _ => null,
    };

    /// <summary>
    /// Record what each write did, and check that what landed on disk is what was intended.
    ///
    /// This is what makes round-trip fidelity observable between test runs. At `Debug` a pair of
    /// content hashes proves after the fact which operation touched which file and whether it changed
    /// at all, for the cost of one hash. At `Trace` the same write emits a diff, which is the one
    /// place an `IsEnabled` guard earns its keep — it is the only genuinely expensive record here.
    ///
    /// A mismatch is `Critical` and is emitted *before* the result is handed back, because at that
    /// point the file on disk may be damaged and the user is about to keep editing it. Per the
    /// standing rule the fix for such a failure is in the implementation, never in the test; this
    /// record exists so the failure is noticed in the field, where there is no test.
    /// </summary>
    private async Task VerifyWritesAsync(Solution newSolution, IReadOnlyDictionary<string, string?> backups, CancellationToken ct)
    {
        if (backups.Count == 0) return;

        var byPath = newSolution.Projects
            .SelectMany(p => p.Documents)
            .Where(d => d.FilePath is not null)
            .GroupBy(d => d.FilePath!, StringComparer.OrdinalIgnoreCase)
            .ToDictionary(g => g.Key, g => g.First(), StringComparer.OrdinalIgnoreCase);

        foreach (var (path, before) in backups)
        {
            string? onDisk = null;
            try
            {
                onDisk = File.Exists(path) ? await File.ReadAllTextAsync(path, ct) : null;
            }
            catch (IOException e)
            {
                // Reading back is diagnostics, not the operation. Failing to read must not fail an
                // edit that has already succeeded, but it must not be silent either.
                EngineLog.ExternalChangeFailed(_log, e);
                continue;
            }

            var beforeHash = ContentHash.Of(before);
            var afterHash = ContentHash.Of(onDisk);

            if (beforeHash == afterHash)
            {
                EngineLog.DocumentUnchanged(_log, _currentOpType, path);
                continue;
            }

            EngineLog.DocumentRewritten(_log, path, beforeHash, afterHash, before?.Length ?? 0, onDisk?.Length ?? 0);

            if (_log.IsEnabled(LogLevel.Trace))
                EngineLog.RewriteDiff(_log, path, ContentHash.UnifiedDiff(before, onDisk));

            // What Roslyn intended to write, against what is actually there.
            if (byPath.TryGetValue(path, out var doc))
            {
                var intended = (await doc.GetTextAsync(ct)).ToString();
                var intendedHash = ContentHash.Of(intended);
                if (intendedHash != afterHash)
                    EngineLog.FidelityVerificationFailed(_log, path, _currentOpType, intendedHash, afterHash);
            }
        }
    }

    private async Task<OperationResult> AddTypeAsync(AddTypeOp op, CancellationToken ct)
    {
        // The path as Refuse checked it: relative to the workspace. Used as given, a relative path was
        // written beside the running process instead.
        var path = Path.GetFullPath(op.FilePath, _model.RootPath);
        var oldSolution = _workspace.CurrentSolution;
        var existingDoc = FindDocument(path);
        var visibilityKw = ToVisibilityKeyword(op.Visibility);
        var typeKindKw = op.TypeKind switch
        {
            TypeKind.Class => "class",
            TypeKind.Interface => "interface",
            TypeKind.Record => "record",
            TypeKind.Struct => "struct",
            TypeKind.Enum => "enum",
            _ => "class"
        };

        Solution newSolution;
        if (existingDoc is null)
        {
            // LF whatever the OS: with Environment.NewLine the same operation wrote a CRLF file on
            // Windows, so what a model gained depended on whose machine added the type.
            var content = $"namespace {op.Namespace};\n\n{visibilityKw} {typeKindKw} {op.Name}\n{{\n}}\n";
            // The project that would compile the file: the one whose folder holds it. Any other project
            // compiled it for this session only, and the type was gone the next time it was opened.
            if (ProjectFor(path) is not { } project)
                return new OperationFailed(op.OpId, "NoProject", $"{path} is in no project's folder, so no project would compile it.");
            var newDoc = project.AddDocument(Path.GetFileName(path), content, filePath: path);
            newSolution = newDoc.Project.Solution;
        }
        else
        {
            var root = await existingDoc.GetSyntaxRootAsync(ct);
            if (root is not CompilationUnitSyntax cu) return new OperationFailed(op.OpId, "ParseError", "Could not parse target file");
            // A file that does not declare the namespace would take the type into its own, and the type
            // asked for would not exist: refused before the file is touched.
            if (!cu.Members.OfType<BaseNamespaceDeclarationSyntax>().Any(n => n.Name.ToString() == op.Namespace))
                return new OperationFailed(op.OpId, "NamespaceNotInFile",
                    $"{Path.GetFileName(path)} declares no namespace {op.Namespace}, so a type in it cannot be added there.");
            var newRoot = TypeWriter.AddType(cu, op.Namespace, $"{visibilityKw} {typeKindKw} {op.Name}");
            newSolution = existingDoc.WithSyntaxRoot(newRoot).Project.Solution;
        }

        return await CommitAsync(op.OpId, oldSolution, newSolution, () =>
        {
            var added = _model.AllTypes.FirstOrDefault(t => t.Name == op.Name && t.Namespace == op.Namespace);
            return added is null
                ? new OperationFailed(op.OpId, "AddTypeFailed", "Type not found after add")
                : new OperationApplied(op.OpId, [new TypeAdded(added)]);
        }, ct);
    }

    private async Task<OperationResult> RenameTypeAsync(RenameTypeOp op, CancellationToken ct)
    {
        var (site, refused) = await FindTypeAsync(op.OpId, op.TypeId, ct);
        if (site is null) return refused!;
        var (typeModel, doc, _, _) = site;

        var compilation = await doc.Project.GetCompilationAsync(ct);
        var symbol = compilation?.GetTypeByMetadataName(op.TypeId);
        if (symbol is null) return new OperationFailed(op.OpId, "SymbolNotFound", op.TypeId);

        var oldSolution = _workspace.CurrentSolution;
        var renameOptions = new SymbolRenameOptions(RenameOverloads: false, RenameInStrings: false, RenameInComments: false, RenameFile: false);
        var newSolution = await Renamer.RenameSymbolAsync(oldSolution, symbol, renameOptions, op.NewName, ct);

        var oldId = op.TypeId;
        var newId = string.IsNullOrEmpty(typeModel.Namespace) ? op.NewName : $"{typeModel.Namespace}.{op.NewName}";
        return await CommitAsync(op.OpId, oldSolution, newSolution,
            () => new OperationApplied(op.OpId, [new TypeRenamed(oldId, newId, op.NewName)]), ct);
    }

    private async Task<OperationResult> RemoveTypeAsync(RemoveTypeOp op, CancellationToken ct)
    {
        var (site, refused) = await FindTypeAsync(op.OpId, op.TypeId, ct);
        if (site is null) return refused!;
        var (_, doc, root, typeNode) = site;

        var newRoot = TypeWriter.RemoveMember(root, typeNode);
        var oldSolution = _workspace.CurrentSolution;
        var newSolution = doc.WithSyntaxRoot(newRoot).Project.Solution;
        return await CommitAsync(op.OpId, oldSolution, newSolution,
            () => new OperationApplied(op.OpId, [new TypeRemoved(op.TypeId)]), ct);
    }

    private async Task<OperationResult> AddPropertyAsync(AddPropertyOp op, CancellationToken ct)
    {
        var (site, refused) = await FindTypeAsync(op.OpId, op.TypeId, ct);
        if (site is null) return refused!;
        var (_, doc, root, declaration) = site;
        if (declaration is not TypeDeclarationSyntax typeDecl) return new OperationFailed(op.OpId, "TypeNodeNotFound", op.TypeId);

        var accessors = "";
        if (op.HasGetter) accessors += " get;";
        if (op.HasInit) accessors += " init;";
        else if (op.HasSetter) accessors += " set;";
        var visibilityKw = ToVisibilityKeyword(op.Visibility);
        var prop = SyntaxFactory.ParseMemberDeclaration($"{visibilityKw} {op.TypeName} {op.Name} {{{accessors} }}");
        if (prop is null) return new OperationFailed(op.OpId, "ParseError", "Could not synthesize property");

        var newRoot = root.ReplaceNode(typeDecl, TypeWriter.AddMember(typeDecl, prop));
        var oldSolution = _workspace.CurrentSolution;
        var newSolution = doc.WithSyntaxRoot(newRoot).Project.Solution;

        return await CommitAsync(op.OpId, oldSolution, newSolution, () =>
        {
            var refreshed = _model.FindType(op.TypeId);
            return new OperationApplied(op.OpId, refreshed is null ? [] : [new TypeUpdated(refreshed)]);
        }, ct);
    }

    private async Task<OperationResult> RenamePropertyAsync(RenamePropertyOp op, CancellationToken ct)
    {
        var (site, refused) = await FindTypeAsync(op.OpId, op.TypeId, ct);
        if (site is null) return refused!;
        var doc = site.Document;
        var compilation = await doc.Project.GetCompilationAsync(ct);
        var typeSymbol = compilation?.GetTypeByMetadataName(op.TypeId);
        var propSymbol = typeSymbol?.GetMembers(op.PropertyName).OfType<ISymbol>().FirstOrDefault();
        if (propSymbol is null) return new OperationFailed(op.OpId, "SymbolNotFound", $"{op.TypeId}.{op.PropertyName}");

        var oldSolution = _workspace.CurrentSolution;
        var renameOptions = new SymbolRenameOptions(RenameOverloads: false, RenameInStrings: false, RenameInComments: false, RenameFile: false);
        var newSolution = await Renamer.RenameSymbolAsync(oldSolution, propSymbol, renameOptions, op.NewName, ct);

        return await CommitAsync(op.OpId, oldSolution, newSolution, () =>
        {
            var refreshed = _model.FindType(op.TypeId);
            return new OperationApplied(op.OpId, refreshed is null ? [] : [new TypeUpdated(refreshed)]);
        }, ct);
    }

    private async Task<OperationResult> RemovePropertyAsync(RemovePropertyOp op, CancellationToken ct)
    {
        var (site, refused) = await FindTypeAsync(op.OpId, op.TypeId, ct);
        if (site is null) return refused!;
        var (_, doc, root, declaration) = site;
        var typeDecl = declaration as TypeDeclarationSyntax;
        var prop = typeDecl?.Members.OfType<PropertyDeclarationSyntax>().FirstOrDefault(p => p.Identifier.Text == op.PropertyName);
        if (prop is null) return new OperationFailed(op.OpId, "PropertyNotFound", op.PropertyName);

        var newRoot = TypeWriter.RemoveMember(root, prop);
        var oldSolution = _workspace.CurrentSolution;
        var newSolution = doc.WithSyntaxRoot(newRoot).Project.Solution;

        return await CommitAsync(op.OpId, oldSolution, newSolution, () =>
        {
            var refreshed = _model.FindType(op.TypeId);
            return new OperationApplied(op.OpId, refreshed is null ? [] : [new TypeUpdated(refreshed)]);
        }, ct);
    }

    private Task<OperationResult> AddInheritanceAsync(AddInheritanceOp op, CancellationToken ct)
        => ModifyBaseListAsync(op.OpId, op.TypeId, op.BaseTypeId, addAtFront: true, ct);

    private Task<OperationResult> AddImplementationAsync(AddImplementationOp op, CancellationToken ct)
        => ModifyBaseListAsync(op.OpId, op.TypeId, op.InterfaceTypeId, addAtFront: false, ct);

    private async Task<OperationResult> RemoveInheritanceAsync(RemoveInheritanceOp op, CancellationToken ct)
    {
        var (site, refused) = await FindTypeAsync(op.OpId, op.TypeId, ct);
        if (site is null) return refused!;
        var (typeModel, doc, root, declaration) = site;
        var typeDecl = declaration as TypeDeclarationSyntax;
        if (typeDecl?.BaseList is null || typeDecl.BaseList.Types.Count == 0)
            return new OperationFailed(op.OpId, "NoBaseList", "Type has no base list");
        // A base class is always first in the list, but the first entry is not always a base class:
        // in `class Invoice : IPriced` it is an interface, and removing it by position would remove that.
        var symbol = (await doc.Project.GetCompilationAsync(ct))?.GetTypeByMetadataName(op.TypeId);
        if (symbol?.BaseType is null or { SpecialType: SpecialType.System_Object or SpecialType.System_ValueType })
            return new OperationFailed(op.OpId, "NoBaseClass", $"{typeModel.Name} implements interfaces but inherits from no class.");

        var newType = TypeWriter.RemoveBase(typeDecl, 0);
        var newRoot = root.ReplaceNode(typeDecl, newType);
        var oldSolution = _workspace.CurrentSolution;
        var newSolution = doc.WithSyntaxRoot(newRoot).Project.Solution;
        return await CommitAsync(op.OpId, oldSolution, newSolution, () =>
        {
            var refreshed = _model.FindType(op.TypeId);
            return new OperationApplied(op.OpId, refreshed is null ? [] : [new TypeUpdated(refreshed)]);
        }, ct);
    }

    private async Task<OperationResult> RemoveImplementationAsync(RemoveImplementationOp op, CancellationToken ct)
    {
        var (site, refused) = await FindTypeAsync(op.OpId, op.TypeId, ct);
        if (site is null) return refused!;
        var ifaceModel = _model.FindType(op.InterfaceTypeId);
        if (ifaceModel is null) return new OperationFailed(op.OpId, "InterfaceNotFound", op.InterfaceTypeId);
        var (_, doc, root, declaration) = site;
        var typeDecl = declaration as TypeDeclarationSyntax;
        if (typeDecl?.BaseList is null) return new OperationFailed(op.OpId, "NoBaseList", "Type has no base list");

        var match = typeDecl.BaseList.Types.FirstOrDefault(b => b.Type.ToString() == ifaceModel.Name || b.Type.ToString() == ifaceModel.Id);
        if (match is null) return new OperationFailed(op.OpId, "InterfaceNotImplemented", op.InterfaceTypeId);
        var idx = typeDecl.BaseList.Types.IndexOf(match);
        var newType = TypeWriter.RemoveBase(typeDecl, idx);
        var newRoot = root.ReplaceNode(typeDecl, newType);
        var oldSolution = _workspace.CurrentSolution;
        var newSolution = doc.WithSyntaxRoot(newRoot).Project.Solution;
        return await CommitAsync(op.OpId, oldSolution, newSolution, () =>
        {
            var refreshed = _model.FindType(op.TypeId);
            return new OperationApplied(op.OpId, refreshed is null ? [] : [new TypeUpdated(refreshed)]);
        }, ct);
    }

    private async Task<OperationResult> ModifyBaseListAsync(string opId, string typeId, string addedTypeId, bool addAtFront, CancellationToken ct)
    {
        var (site, refused) = await FindTypeAsync(opId, typeId, ct);
        if (site is null) return refused!;
        var addedModel = _model.FindType(addedTypeId);
        if (addedModel is null) return new OperationFailed(opId, "TargetNotFound", addedTypeId);
        var (_, doc, root, declaration) = site;
        if (declaration is not TypeDeclarationSyntax typeDecl) return new OperationFailed(opId, "TypeNodeNotFound", typeId);

        if (typeDecl.BaseList?.Types.Any(b => b.Type.ToString() == addedModel.Name) == true)
            return new OperationFailed(opId, "AlreadyPresent", addedTypeId);
        var baseTypeSyntax = SyntaxFactory.SimpleBaseType(SyntaxFactory.ParseTypeName(addedModel.Name));
        var newType = TypeWriter.AddBase(typeDecl, baseTypeSyntax, first: addAtFront);
        var newRoot = root.ReplaceNode(typeDecl, newType);
        var oldSolution = _workspace.CurrentSolution;
        var newSolution = doc.WithSyntaxRoot(newRoot).Project.Solution;
        return await CommitAsync(opId, oldSolution, newSolution, () =>
        {
            var refreshed = _model.FindType(typeId);
            return new OperationApplied(opId, refreshed is null ? [] : [new TypeUpdated(refreshed)]);
        }, ct);
    }

    private sealed record TypeSite(TypeModel Model, Document Document, SyntaxNode Root, BaseTypeDeclarationSyntax Declaration);

    /// <summary>
    /// The declaration of the type the model calls <paramref name="typeId"/>, matched by that full
    /// name in each file the model says declares it — never by the simple name, which took the first
    /// <c>Item</c> in a file that has one in two namespaces. Parts of one partial type are one type, and
    /// the first part stands for it; any other two declarations with the name (a nested type and a
    /// top-level one, which the model names alike) are refused, since which was meant cannot be told.
    /// </summary>
    private async Task<(TypeSite? Site, OperationFailed? Refusal)> FindTypeAsync(string opId, string typeId, CancellationToken ct)
    {
        var models = _model.AllTypes.Where(t => t.Id == typeId).ToList();
        if (models.Count == 0) return (null, new OperationFailed(opId, "TypeNotFound", typeId));
        var sites = new List<TypeSite>();
        foreach (var model in models.DistinctBy(m => m.FilePath, StringComparer.OrdinalIgnoreCase))
        {
            if (FindDocument(model.FilePath) is not { } doc || await doc.GetSyntaxRootAsync(ct) is not { } root) continue;
            sites.AddRange(root.DescendantNodes().OfType<BaseTypeDeclarationSyntax>()
                .Where(d => WorkspaceLoader.TypeIdOf(d) == typeId)
                .Select(d => new TypeSite(model, doc, root, d)));
        }
        if (sites.Count == 0) return (null, new OperationFailed(opId, "TypeNodeNotFound", typeId));
        if (sites.Count > 1 && !sites.All(s => s.Declaration.Modifiers.Any(SyntaxKind.PartialKeyword)))
            return (null, new OperationFailed(opId, "AmbiguousType",
                $"{sites.Count} declarations are named {typeId} (a nested type is named by its namespace and its own name), so which one is meant cannot be told."));
        return (sites[0], null);
    }

    private static async Task WriteFileAtomicAsync(string path, string contents, CancellationToken ct)
    {
        var dir = Path.GetDirectoryName(path);
        if (!string.IsNullOrEmpty(dir)) Directory.CreateDirectory(dir);
        var tmp = path + ".tmp";
        await File.WriteAllTextAsync(tmp, contents, ct);
        File.Move(tmp, path, overwrite: true);
    }

    /// <summary>
    /// The projects an edit can have broken: the ones it changed, and every project that depends on one
    /// of them. No other project's compilation can differ, so none other is checked.
    /// </summary>
    private static IReadOnlyList<ProjectId> AffectedProjects(SolutionChanges changes, Solution newSolution)
    {
        var graph = newSolution.GetProjectDependencyGraph();
        var affected = new HashSet<ProjectId>();
        foreach (var id in changes.GetProjectChanges().Select(c => c.ProjectId))
        {
            affected.Add(id);
            affected.UnionWith(graph.GetProjectsThatTransitivelyDependOnThisProject(id));
        }
        return [.. affected];
    }

    /// <summary>
    /// Location-independent signatures of the compile errors in <paramref name="projects"/>, used to tell
    /// errors the current op introduced apart from ones that were already present.
    /// </summary>
    private async Task<HashSet<string>> CollectErrorSignaturesAsync(Solution solution, IReadOnlyList<ProjectId> projects, CancellationToken ct)
    {
        var signatures = new HashSet<string>();
        foreach (var id in projects)
        {
            if (solution.GetProject(id) is not { } project) continue;
            foreach (var d in await ErrorsOfAsync(project, ct))
                signatures.Add($"{project.Name}|{d.Id}|{d.GetMessage()}");
        }
        return signatures;
    }

    /// <summary>
    /// Errors in <paramref name="projects"/> of the current workspace solution that are NOT in
    /// <paramref name="baseline"/> — the ones the just-applied op introduced. Returned with source
    /// locations for diagnostics.
    /// </summary>
    private async Task<IReadOnlyList<string>> CollectIntroducedErrorsAsync(HashSet<string> baseline, IReadOnlyList<ProjectId> projects, CancellationToken ct)
    {
        var introduced = new List<string>();
        var solution = _workspace.CurrentSolution;
        foreach (var id in projects)
        {
            if (solution.GetProject(id) is not { } project) continue;
            foreach (var d in await ErrorsOfAsync(project, ct))
            {
                if (baseline.Contains($"{project.Name}|{d.Id}|{d.GetMessage()}")) continue;
                introduced.Add($"{project.Name}: {d.Id} {d.GetMessage()} at {d.Location.GetLineSpan()}");
            }
        }
        return introduced;
    }

    /// <summary>
    /// Each project's compile errors, for the version of the project and everything it depends on that
    /// they were found in. The errors after one edit are the errors before the next, so a check that
    /// compiled the whole workspace twice per edit now compiles what the edit changed, once. Held as a
    /// task so that two callers — an edit, and the warm-up after opening — share one compile.
    /// </summary>
    private readonly System.Collections.Concurrent.ConcurrentDictionary<ProjectId, (VersionStamp Version, Lazy<Task<IReadOnlyList<Diagnostic>>> Errors)> _errors = new();

    /// <summary>Cancelled when the engine is disposed: a compile nobody will read stops.</summary>
    private readonly CancellationTokenSource _lifetime = new();

    private async Task<IReadOnlyList<Diagnostic>> ErrorsOfAsync(Project project, CancellationToken ct)
    {
        var version = await project.GetDependentVersionAsync(ct);
        var entry = _errors.AddOrUpdate(project.Id,
            _ => (version, new(() => CompileForErrorsAsync(project))),
            (_, known) => known.Version == version && !(known.Errors.IsValueCreated && known.Errors.Value is { IsFaulted: true } or { IsCanceled: true })
                ? known
                : (version, new(() => CompileForErrorsAsync(project))));
        return await entry.Errors.Value.WaitAsync(ct);
    }

    private async Task<IReadOnlyList<Diagnostic>> CompileForErrorsAsync(Project project)
    {
        // Not the caller's token: the result is shared, and one caller giving up must not fail it for
        // the others.
        await Task.Yield();
        var started = Stopwatch.GetTimestamp();
        var compilation = await project.GetCompilationAsync(_lifetime.Token);
        IReadOnlyList<Diagnostic> errors = compilation is null
            ? []
            : compilation.GetDiagnostics(_lifetime.Token).Where(d => d.Severity == DiagnosticSeverity.Error).ToList();
        EngineLog.CompileChecked(_log, project.Name, (long)Stopwatch.GetElapsedTime(started).TotalMilliseconds, errors.Count);
        return errors;
    }

    private static string ToVisibilityKeyword(Visibility v) => v switch
    {
        Visibility.Public => "public",
        Visibility.Internal => "internal",
        Visibility.Protected => "protected",
        Visibility.Private => "private",
        _ => "internal"
    };

    // ----- Architecture-model surface (Spike 02) -----

    /// <summary>
    /// Locate the primary document whose root contains a `static class Architecture { Build() {...} }`.
    /// Returns null if the workspace is not a model workspace.
    /// </summary>
    public Document? FindArchitectureDocument()
    {
        foreach (var project in _workspace.CurrentSolution.Projects)
        {
            foreach (var doc in project.Documents)
            {
                if (doc.FilePath is null) continue;
                if (!IsModelFile(doc.FilePath)) continue;
                var root = doc.GetSyntaxRootAsync().GetAwaiter().GetResult();
                if (root is null) continue;
                if (root.DescendantNodes().OfType<ClassDeclarationSyntax>()
                        .Any(c => c.Identifier.Text == "Architecture"
                                  && c.Members.OfType<MethodDeclarationSyntax>().Any(m => m.Identifier.Text == "Build")))
                    return doc;
            }
        }
        return null;
    }

    /// <summary>
    /// Returns every document under the workspace's `Architecture/` folder that contains a
    /// `static class XYZ { Build(...) }` method body. Order: primary `Architecture` class first,
    /// then alphabetical by file path.
    /// </summary>
    public IReadOnlyList<Document> FindArchitectureDocuments()
    {
        var matches = new List<Document>();
        foreach (var project in _workspace.CurrentSolution.Projects)
        {
            foreach (var doc in project.Documents)
            {
                if (doc.FilePath is null) continue;
                if (!IsModelFile(doc.FilePath)) continue;
                var root = doc.GetSyntaxRootAsync().GetAwaiter().GetResult();
                if (root is null) continue;
                var hasBuild = root.DescendantNodes().OfType<ClassDeclarationSyntax>()
                    .Any(c => c.Members.OfType<MethodDeclarationSyntax>().Any(m => m.Identifier.Text == "Build"));
                if (hasBuild) matches.Add(doc);
            }
        }
        return matches
            .OrderBy(d => d.FilePath!.EndsWith("Architecture.cs", StringComparison.OrdinalIgnoreCase) ? 0 : 1)
            .ThenBy(d => d.FilePath, StringComparer.OrdinalIgnoreCase)
            .ToList();
    }

    public async Task<ArchModel.ArchModel?> ReadArchModelAsync(CancellationToken ct = default)
    {
        var docs = FindArchitectureDocuments();
        if (docs.Count == 0) return null;
        // Through the merge even when there is one file: it is also where a second declaration of an
        // id is dropped, and the read of a past revision (GitHistory) always goes through it. Skipped
        // for one file, a model compared with itself showed a duplicate the history did not have.
        var partials = new List<ArchModel.ArchModel?>();
        foreach (var doc in docs)
        {
            var root = await doc.GetSyntaxRootAsync(ct);
            if (root is not null) partials.Add(DslReader.TryRead(doc.FilePath!, root));
        }
        // No file with a Build() body to read is no model, as it always was — not an empty one.
        if (partials.All(p => p is null)) return null;
        return ArchModelMerge.Merge(docs[0].FilePath ?? "Architecture.cs", partials);
    }

    /// <summary>
    /// The line of C# that declares this id, read back out of the file the engine just wrote.
    ///
    /// Deliberately a read of the source rather than a render of the model: showing an architect
    /// "here is what your click became" is only worth anything if it is the file's own text.
    /// </summary>
    public async Task<ArchModel.DslDeclaration?> ReadDeclarationAsync(string id, CancellationToken ct = default)
    {
        foreach (var doc in FindArchitectureDocuments())
        {
            var root = await doc.GetSyntaxRootAsync(ct);
            if (root is null) continue;
            var found = DslReader.FindDeclaration(doc.FilePath!, root, id);
            if (found is not null) return found;
        }
        return null;
    }

    /// <summary>
    /// Find the document that declares the given element/link id, falling back to the primary
    /// Architecture document if the id is not yet present (i.e. for AddElement / AddLink ops).
    /// </summary>
    public Document? FindDocumentForId(string id)
    {
        foreach (var doc in FindArchitectureDocuments())
        {
            var root = doc.GetSyntaxRootAsync().GetAwaiter().GetResult();
            if (root is not null && DslReader.FindDeclaration(doc.FilePath ?? "", root, id) is not null) return doc;
        }
        return null;
    }

    /// <summary>
    /// Snapshot every document's filepath + syntax root in the workspace. Used by the
    /// Views adapter, which scans files outside the Architecture/ folder.
    /// </summary>
    public async Task<IReadOnlyList<(string FilePath, SyntaxNode Root)>> CollectAllDocumentsAsync(CancellationToken ct = default)
    {
        var result = new List<(string, SyntaxNode)>();
        foreach (var project in _workspace.CurrentSolution.Projects)
        {
            foreach (var doc in project.Documents)
            {
                if (doc.FilePath is null) continue;
                var root = await doc.GetSyntaxRootAsync(ct);
                if (root is null) continue;
                result.Add((doc.FilePath, root));
            }
        }
        return result;
    }

    /// <summary>
    /// The namespace for a new file (a view): the primary Architecture file's, or else one made from
    /// the project's name. A model-only project is named after its folder, which need not be a C#
    /// name — a folder called my-arch wrote <c>namespace my-arch;</c> and the new view was refused as
    /// breaking the build — so the name is made into one the way MSBuild makes a root namespace.
    /// </summary>
    public string NamespaceForViews()
    {
        var root = FindArchitectureDocument()?.GetSyntaxRootAsync().GetAwaiter().GetResult();
        var declared = root?.DescendantNodes().OfType<BaseNamespaceDeclarationSyntax>().FirstOrDefault()?.Name.ToString();
        return declared ?? AsNamespace(_model.Projects.FirstOrDefault()?.Name);
    }

    /// <summary><paramref name="name"/> as a C# namespace: each character a name cannot hold becomes <c>_</c>.</summary>
    private static string AsNamespace(string? name)
    {
        var segments = new List<string>();
        foreach (var part in (name ?? "").Split('.'))
        {
            var segment = new string(part.Select(c => char.IsLetterOrDigit(c) || c == '_' ? c : '_').ToArray());
            if (segment.Length == 0) continue;
            if (char.IsDigit(segment[0]) || SyntaxFacts.GetKeywordKind(segment) != SyntaxKind.None) segment = "_" + segment;
            segments.Add(segment);
        }
        return segments.Count > 0 && segments.All(SyntaxFacts.IsValidIdentifier) ? string.Join('.', segments) : "Architecture";
    }

    /// <summary>
    /// Save a view to the file that declares it, editing its name, lens and members in place; or,
    /// when no file declares it, to a new <c>Views/&lt;Name&gt;.cs</c> that does not take an existing
    /// file's name. Through <see cref="CommitAsync"/> like any edit, so it is compile-gated, verified
    /// and never written over a version of the file Stemma has not seen.
    ///
    /// Not on the undo stack: the client keeps the views list itself, and an undo it did not hear
    /// about would leave the canvas and the file disagreeing.
    /// </summary>
    public async Task<OperationResult> SaveViewAsync(string opId, ArchView view, CancellationToken ct = default)
    {
        await _gate.WaitAsync(ct);
        try
        {
            if (_disposed) return Closed(opId);
            return await LoggedAsync("SaveView", async () =>
            {
                await CatchUpWithDiskAsync(ct);
                var oldSolution = _workspace.CurrentSolution;
                Solution newSolution;
                if (await FindViewDocumentAsync(view.Id, ct) is { } found)
                {
                    SyntaxNode newRoot;
                    try { newRoot = ViewsAdapter.Edit(found.Root, view); }
                    catch (DslEditRefusedException e) { return new OperationFailed(opId, e.Reason, e.Message); }
                    if (ReferenceEquals(newRoot, found.Root)) return new OperationApplied(opId, []);
                    newSolution = found.Document.WithSyntaxRoot(newRoot).Project.Solution;
                }
                else
                {
                    var project = FindArchitectureDocument()?.Project ?? oldSolution.Projects.FirstOrDefault();
                    if (project is null) return new OperationFailed(opId, "NoProject", "No project to hold the view");
                    var (className, path) = NewViewFile(oldSolution, project, view.Name);
                    var text = SourceText.From(ViewsAdapter.Render(NamespaceForViews(), className, view),
                        new System.Text.UTF8Encoding(encoderShouldEmitUTF8Identifier: false));
                    newSolution = project.AddDocument(Path.GetFileName(path), text, folders: ["Views"], filePath: path).Project.Solution;
                }
                return await CommitAsync(opId, oldSolution, newSolution, () => new OperationApplied(opId, []), ct);
            });
        }
        finally { _gate.Release(); }
    }

    /// <summary>Delete the file that declares <paramref name="viewId"/> — found by reading it, not by searching text.</summary>
    public async Task<OperationResult> RemoveViewAsync(string opId, string viewId, CancellationToken ct = default)
    {
        await _gate.WaitAsync(ct);
        try
        {
            if (_disposed) return Closed(opId);
            return await LoggedAsync("RemoveView", async () =>
            {
                await CatchUpWithDiskAsync(ct);
                if (await FindViewDocumentAsync(viewId, ct) is not { } found)
                    return new OperationFailed(opId, "ViewNotFound", viewId);
                var oldSolution = _workspace.CurrentSolution;
                return await CommitAsync(opId, oldSolution, oldSolution.RemoveDocument(found.Document.Id),
                    () => new OperationApplied(opId, []), ct);
            });
        }
        finally { _gate.Release(); }
    }

    private async Task<OperationResult> LoggedAsync(string operation, Func<Task<OperationResult>> run)
    {
        var startedAt = Stopwatch.GetTimestamp();
        _currentOpType = operation;
        var result = await run();
        var elapsedMs = (long)Stopwatch.GetElapsedTime(startedAt).TotalMilliseconds;
        if (result is OperationFailed failed)
            EngineLog.OperationFailed(_log, operation, elapsedMs, $"{failed.Reason}: {failed.Message}", null);
        else
            EngineLog.OperationApplied(_log, operation, elapsedMs, 0);
        return result;
    }

    /// <summary>
    /// Bring the workspace's set of files into line with the disk now, rather than when the watcher
    /// next polls. A view is found by the id its file declares, so one pulled in half a second ago is
    /// not found, and saving it wrote a second file declaring the same view (B-015).
    /// </summary>
    private async Task CatchUpWithDiskAsync(CancellationToken ct)
    {
        var held = _workspace.CurrentSolution.Projects.SelectMany(p => p.Documents)
            .Where(d => !string.IsNullOrEmpty(d.FilePath))
            .ToList();
        var heldPaths = new HashSet<string>(held.Select(d => d.FilePath!), StringComparer.OrdinalIgnoreCase);
        var changed = new List<string>();
        foreach (var doc in held.Where(d => !File.Exists(d.FilePath)))
        {
            await TakeOutAsync(doc, ct);
            changed.Add(doc.FilePath!);
        }
        foreach (var path in ModelWorkspaceLoader.SourcesIn(_model.RootPath))
        {
            if (heldPaths.Contains(path) || await CompilingProjectAsync(path, ct) is not { } project) continue;
            await TakeInAddedAsync(project, path, ReadFromDisk(path), ct);
            changed.Add(path);
        }
        if (changed.Count == 0) return;
        await ReloadAsync(ct);
        _undo.OnExternalChange();
        foreach (var path in changed) ExternalChange?.Invoke(path);
    }

    private async Task<(Document Document, SyntaxNode Root)?> FindViewDocumentAsync(string viewId, CancellationToken ct)
    {
        foreach (var doc in _workspace.CurrentSolution.Projects.SelectMany(p => p.Documents))
        {
            if (doc.FilePath is null || !InFolder(doc.FilePath, "Views")) continue;
            var root = await doc.GetSyntaxRootAsync(ct);
            if (root is not null && ViewsAdapter.TryReadOne(root)?.Id == viewId) return (doc, root);
        }
        return null;
    }

    /// <summary>
    /// A class and file name for a new view that no file and no class in the workspace already has —
    /// checked where the file will actually be written. A project workspace writes a new document into
    /// its project's folder, wherever the workspace root is; checking the root's Views/ instead let a
    /// new view replace an existing file of the same name in the project.
    /// </summary>
    private (string ClassName, string Path) NewViewFile(Solution solution, Project project, string viewName)
    {
        var taken = solution.Projects.SelectMany(p => p.Documents)
            .Select(d => d.GetSyntaxRootAsync().GetAwaiter().GetResult())
            .SelectMany(r => r?.DescendantNodes().OfType<ClassDeclarationSyntax>() ?? [])
            .Select(c => c.Identifier.Text)
            .ToHashSet(StringComparer.Ordinal);
        var stem = ViewsAdapter.ClassNameFromViewName(viewName);
        var dir = _workspace is not FileBackedWorkspace && project.FilePath is { Length: > 0 } projectFile
            ? Path.Combine(Path.GetDirectoryName(projectFile)!, "Views")
            : Path.Combine(_model.RootPath, "Views");
        for (var n = 1; ; n++)
        {
            var className = n == 1 ? stem : $"{stem}{n}";
            var path = Path.Combine(dir, className + ".cs");
            if (!taken.Contains(className) && !File.Exists(path)) return (className, path);
        }
    }

    public IEnumerable<Project> AllProjects() => _workspace.CurrentSolution.Projects;

    public async Task<IReadOnlyList<Violation>> RunValidationAsync(CancellationToken ct = default)
    {
        var arch = await ReadArchModelAsync(ct);
        if (arch is null) return [];
        var engine = RuleEngine.Default(_model.RootPath);
        return engine.Run(arch);
    }

    private async Task<OperationResult> AddArchElementAsync(AddElementOp op, CancellationToken ct)
    {
        var doc = FindArchitectureDocument();
        if (doc is null) return new OperationFailed(op.OpId, "NoArchitectureFile", "No Architecture/Architecture.cs found");
        var root = await doc.GetSyntaxRootAsync(ct);
        if (root is null) return new OperationFailed(op.OpId, "ParseError", "Could not parse Architecture file");

        // Read merged model so generated id avoids collisions across multi-file workspaces.
        var current = await ReadArchModelAsync(ct) ?? DslReader.TryRead(doc.FilePath!, root);
        if (current is null) return new OperationFailed(op.OpId, "InvalidArch", "Architecture.Build() body not found");

        var id = GenerateId(op.ElementKind, await TakenIdsAsync(current, ct));
        var attrs = new Dictionary<string, string?>();
        if (op.ContextId is not null) attrs["contextId"] = op.ContextId;
        if (op.SystemId is not null) attrs["systemId"] = op.SystemId;
        if (op.ContainerKind is not null) attrs["kind"] = op.ContainerKind;
        if (op.Role is not null) attrs["role"] = op.Role;

        var element = new ArchModel.ArchElement(id, op.Name, op.ElementKind, attrs);
        var newRoot = DslWriter.AddElement(root, element);
        var oldSolution = _workspace.CurrentSolution;
        var newSolution = doc.WithSyntaxRoot(newRoot).Project.Solution;
        return await CommitAsync(op.OpId, oldSolution, newSolution,
            () => new OperationApplied(op.OpId, [new ElementAdded(id)]), ct);
    }

    private async Task<OperationResult> RenameArchElementAsync(RenameElementOp op, CancellationToken ct)
    {
        var doc = FindDocumentForId(op.ElementId) ?? FindArchitectureDocument();
        if (doc is null) return new OperationFailed(op.OpId, "NoArchitectureFile", "No Architecture/Architecture.cs found");
        var root = await doc.GetSyntaxRootAsync(ct);
        if (root is null) return new OperationFailed(op.OpId, "ParseError", "Could not parse");

        SyntaxNode newRoot;
        try { newRoot = DslWriter.RenameElement(root, op.ElementId, op.NewName); }
        catch (DslEditRefusedException e) { return new OperationFailed(op.OpId, e.Reason, e.Message); }
        if (ReferenceEquals(newRoot, root))
            return new OperationFailed(op.OpId, "ElementNotFound", op.ElementId);
        var oldSolution = _workspace.CurrentSolution;
        var newSolution = doc.WithSyntaxRoot(newRoot).Project.Solution;
        return await CommitAsync(op.OpId, oldSolution, newSolution,
            () => new OperationApplied(op.OpId, []), ct);
    }

    private async Task<OperationResult> RemoveArchElementAsync(RemoveElementOp op, CancellationToken ct)
    {
        var doc = FindDocumentForId(op.ElementId) ?? FindArchitectureDocument();
        if (doc is null) return new OperationFailed(op.OpId, "NoArchitectureFile", "No Architecture file");
        var root = await doc.GetSyntaxRootAsync(ct);
        if (root is null) return new OperationFailed(op.OpId, "ParseError", "Could not parse");

        SyntaxNode newRoot;
        try { newRoot = DslWriter.RemoveDeclaration(root, op.ElementId); }
        catch (Exception e) { return new OperationFailed(op.OpId, "RemoveFailed", e.Message); }
        var oldSolution = _workspace.CurrentSolution;
        var newSolution = doc.WithSyntaxRoot(newRoot).Project.Solution;
        return await CommitAsync(op.OpId, oldSolution, newSolution,
            () => new OperationApplied(op.OpId, []), ct);
    }

    private async Task<OperationResult> SetElementContextAsync(SetElementContextOp op, CancellationToken ct)
    {
        var doc = FindDocumentForId(op.ElementId) ?? FindArchitectureDocument();
        if (doc is null) return new OperationFailed(op.OpId, "NoArchitectureFile", "No Architecture file");
        var root = await doc.GetSyntaxRootAsync(ct);
        if (root is null) return new OperationFailed(op.OpId, "ParseError", "Could not parse");
        var current = await ReadArchModelAsync(ct);
        var element = current?.Elements.FirstOrDefault(e => e.Id == op.ElementId);
        if (element is null) return new OperationFailed(op.OpId, "ElementNotFound", op.ElementId);
        if (element.Kind is not (ArchElementKind.Module or ArchElementKind.Capability))
            return new OperationFailed(op.OpId, "NotNestable", "Only modules and capabilities can belong to a Bounded Context");
        if (!string.IsNullOrEmpty(op.ContextId)
            && !current!.Elements.Any(e => e.Id == op.ContextId && e.Kind == ArchElementKind.BoundedContext))
            return new OperationFailed(op.OpId, "ContextNotFound", op.ContextId);

        SyntaxNode newRoot;
        try { newRoot = DslWriter.SetAttribute(root, op.ElementId, "contextId", string.IsNullOrEmpty(op.ContextId) ? null : op.ContextId); }
        catch (DslEditRefusedException e) { return new OperationFailed(op.OpId, e.Reason, e.Message); }
        if (ReferenceEquals(newRoot, root)) return new OperationFailed(op.OpId, "RewriteFailed", "No change");
        var oldSolution = _workspace.CurrentSolution;
        var newSolution = doc.WithSyntaxRoot(newRoot).Project.Solution;
        return await CommitAsync(op.OpId, oldSolution, newSolution,
            () => new OperationApplied(op.OpId, []), ct);
    }

    private async Task<OperationResult> SetElementAttributeAsync(SetElementAttributeOp op, CancellationToken ct)
    {
        var doc = FindDocumentForId(op.ElementId) ?? FindArchitectureDocument();
        if (doc is null) return new OperationFailed(op.OpId, "NoArchitectureFile", "No Architecture file");
        var root = await doc.GetSyntaxRootAsync(ct);
        if (root is null) return new OperationFailed(op.OpId, "ParseError", "Could not parse");
        var current = await ReadArchModelAsync(ct);
        var element = current?.Elements.FirstOrDefault(e => e.Id == op.ElementId);
        if (element is null) return new OperationFailed(op.OpId, "ElementNotFound", op.ElementId);

        SyntaxNode newRoot;
        try { newRoot = DslWriter.SetAttribute(root, op.ElementId, op.AttributeName, string.IsNullOrEmpty(op.Value) ? null : op.Value); }
        catch (DslEditRefusedException e) { return new OperationFailed(op.OpId, e.Reason, e.Message); }
        if (ReferenceEquals(newRoot, root)) return new OperationFailed(op.OpId, "RewriteFailed", "No change");
        var oldSolution = _workspace.CurrentSolution;
        var newSolution = doc.WithSyntaxRoot(newRoot).Project.Solution;
        return await CommitAsync(op.OpId, oldSolution, newSolution,
            () => new OperationApplied(op.OpId, []), ct);
    }

    private async Task<OperationResult> AddArchLinkAsync(AddLinkOp op, CancellationToken ct)
    {
        var doc = FindArchitectureDocument();
        if (doc is null) return new OperationFailed(op.OpId, "NoArchitectureFile", "No Architecture file");
        var root = await doc.GetSyntaxRootAsync(ct);
        if (root is null) return new OperationFailed(op.OpId, "ParseError", "Could not parse");
        // The whole model, as AddElement reads it: an end declared in another model file is an element
        // like any other, and an id another file declares is taken. Read from this file alone, a link
        // to Payments.cs was refused, and a new link took an id Payments.cs already had.
        var current = await ReadArchModelAsync(ct) ?? DslReader.TryRead(doc.FilePath!, root);
        if (current is null) return new OperationFailed(op.OpId, "InvalidArch", "Build() not found");

        if (!current.Elements.Any(e => e.Id == op.FromId))
            return new OperationFailed(op.OpId, "FromNotFound", op.FromId);
        if (!current.Elements.Any(e => e.Id == op.ToId))
            return new OperationFailed(op.OpId, "ToNotFound", op.ToId);

        var id = GenerateLinkId(op.LinkKind, await TakenIdsAsync(current, ct));
        var attrs = new Dictionary<string, string?>();
        if (op.Payload is not null) attrs["payload"] = op.Payload;
        if (op.Direction is not null) attrs["direction"] = op.Direction;
        if (op.DependencyKind is not null) attrs["kind"] = op.DependencyKind;

        var link = new ArchModel.ArchLink(id, op.FromId, op.ToId, op.LinkKind, attrs);
        var newRoot = DslWriter.AddLink(root, link);
        var oldSolution = _workspace.CurrentSolution;
        var newSolution = doc.WithSyntaxRoot(newRoot).Project.Solution;
        return await CommitAsync(op.OpId, oldSolution, newSolution,
            () => new OperationApplied(op.OpId, [new LinkAdded(id)]), ct);
    }

    private async Task<OperationResult> SetLinkAttributeAsync(SetLinkAttributeOp op, CancellationToken ct)
    {
        var doc = FindDocumentForId(op.LinkId) ?? FindArchitectureDocument();
        if (doc is null) return new OperationFailed(op.OpId, "NoArchitectureFile", "No Architecture file");
        var root = await doc.GetSyntaxRootAsync(ct);
        if (root is null) return new OperationFailed(op.OpId, "ParseError", "Could not parse");
        var current = await ReadArchModelAsync(ct);
        if (current is null) return new OperationFailed(op.OpId, "InvalidArch", "Build() not found");

        var link = current.Links.FirstOrDefault(l => l.Id == op.LinkId);
        if (link is null) return new OperationFailed(op.OpId, "LinkNotFound", op.LinkId);

        SyntaxNode newRoot;
        try { newRoot = DslWriter.SetAttribute(root, op.LinkId, op.AttributeName, op.Value); }
        catch (DslEditRefusedException e) { return new OperationFailed(op.OpId, e.Reason, e.Message); }
        if (ReferenceEquals(newRoot, root)) return new OperationFailed(op.OpId, "RewriteFailed", "No change");

        var oldSolution = _workspace.CurrentSolution;
        var newSolution = doc.WithSyntaxRoot(newRoot).Project.Solution;
        return await CommitAsync(op.OpId, oldSolution, newSolution,
            () => new OperationApplied(op.OpId, []), ct);
    }

    private async Task<OperationResult> RemoveArchLinkAsync(RemoveLinkOp op, CancellationToken ct)
    {
        var doc = FindDocumentForId(op.LinkId) ?? FindArchitectureDocument();
        if (doc is null) return new OperationFailed(op.OpId, "NoArchitectureFile", "No Architecture file");
        var root = await doc.GetSyntaxRootAsync(ct);
        if (root is null) return new OperationFailed(op.OpId, "ParseError", "Could not parse");

        SyntaxNode newRoot;
        try { newRoot = DslWriter.RemoveDeclaration(root, op.LinkId); }
        catch (Exception e) { return new OperationFailed(op.OpId, "RemoveFailed", e.Message); }
        var oldSolution = _workspace.CurrentSolution;
        var newSolution = doc.WithSyntaxRoot(newRoot).Project.Solution;
        return await CommitAsync(op.OpId, oldSolution, newSolution,
            () => new OperationApplied(op.OpId, []), ct);
    }

    /// <summary>
    /// The model file a restore writes into: the one it came from, if it is still a model file, and
    /// otherwise the primary one. Only a model file — the path comes with the operation.
    /// </summary>
    private Document? RestoreTarget(string? filePath) =>
        (filePath is null ? null : FindArchitectureDocuments().FirstOrDefault(d => string.Equals(d.FilePath, filePath, StringComparison.OrdinalIgnoreCase)))
        ?? FindArchitectureDocument();

    /// <summary>The tag that was removed with a declaration, written back after it.</summary>
    private static SyntaxNode RestoreTag(SyntaxNode root, string id, ArchLifecycle? lifecycle, ArchOwnership? ownership)
    {
        if (lifecycle is not null)
            root = DslWriter.SetTag(root, id, "lifecycle",
                [("status", lifecycle.Status), ("phase", lifecycle.Phase), ("validFrom", lifecycle.ValidFrom), ("validUntil", lifecycle.ValidUntil)]);
        if (ownership is not null)
            root = DslWriter.SetTag(root, id, "ownership", [("squad", ownership.Squad), ("domain", ownership.Domain)]);
        return root;
    }

    private async Task<OperationResult> RestoreArchElementAsync(RestoreElementOp op, CancellationToken ct)
    {
        var doc = RestoreTarget(op.FilePath);
        if (doc is null) return new OperationFailed(op.OpId, "NoArchitectureFile", "No Architecture file");
        var root = await doc.GetSyntaxRootAsync(ct);
        if (root is null) return new OperationFailed(op.OpId, "ParseError", "Could not parse");

        var attrs = new Dictionary<string, string?>();
        if (op.ContextId is not null) attrs["contextId"] = op.ContextId;
        if (op.SystemId is not null) attrs["systemId"] = op.SystemId;
        if (op.ContainerKind is not null) attrs["kind"] = op.ContainerKind;
        if (op.Role is not null) attrs["role"] = op.Role;
        if (op.AboutId is not null) attrs["aboutId"] = op.AboutId;
        var element = new ArchModel.ArchElement(op.ElementId, op.Name, op.ElementKind, attrs);
        var newRoot = RestoreTag(DslWriter.AddElement(root, element), op.ElementId, op.Lifecycle, op.Ownership);
        var oldSolution = _workspace.CurrentSolution;
        var newSolution = doc.WithSyntaxRoot(newRoot).Project.Solution;
        return await CommitAsync(op.OpId, oldSolution, newSolution,
            () => new OperationApplied(op.OpId, [new ElementAdded(op.ElementId)]), ct);
    }

    private async Task<OperationResult> RestoreArchLinkAsync(RestoreLinkOp op, CancellationToken ct)
    {
        var doc = RestoreTarget(op.FilePath);
        if (doc is null) return new OperationFailed(op.OpId, "NoArchitectureFile", "No Architecture file");
        var root = await doc.GetSyntaxRootAsync(ct);
        if (root is null) return new OperationFailed(op.OpId, "ParseError", "Could not parse");

        var attrs = new Dictionary<string, string?>();
        if (op.Payload is not null) attrs["payload"] = op.Payload;
        if (op.Direction is not null) attrs["direction"] = op.Direction;
        if (op.DependencyKind is not null) attrs["kind"] = op.DependencyKind;
        if (op.Label is not null) attrs["label"] = op.Label;
        var link = new ArchModel.ArchLink(op.LinkId, op.FromId, op.ToId, op.LinkKind, attrs);
        var newRoot = RestoreTag(DslWriter.AddLink(root, link), op.LinkId, op.Lifecycle, op.Ownership);
        var oldSolution = _workspace.CurrentSolution;
        var newSolution = doc.WithSyntaxRoot(newRoot).Project.Solution;
        return await CommitAsync(op.OpId, oldSolution, newSolution,
            () => new OperationApplied(op.OpId, [new LinkAdded(op.LinkId)]), ct);
    }

    private Task<OperationResult> SetLifecycleAsync(SetLifecycleOp op, CancellationToken ct) =>
        SetTagAsync(op.OpId, op.TargetId, "lifecycle",
            [("status", Blank(op.Status)), ("phase", Blank(op.Phase)), ("validFrom", Blank(op.ValidFrom)), ("validUntil", Blank(op.ValidUntil))], ct);

    /// <summary>Squad and domain only: the RAPID roles are not part of this operation, so it leaves them as written.</summary>
    private Task<OperationResult> SetOwnershipAsync(SetOwnershipOp op, CancellationToken ct) =>
        SetTagAsync(op.OpId, op.TargetId, "ownership", [("squad", Blank(op.Squad)), ("domain", Blank(op.Domain))], ct);

    private static string? Blank(string? value) => string.IsNullOrEmpty(value) ? null : value;

    private async Task<OperationResult> SetTagAsync(
        string opId, string targetId, string part, IReadOnlyList<(string Field, string? Value)> fields, CancellationToken ct)
    {
        var doc = FindDocumentForId(targetId) ?? FindArchitectureDocument();
        if (doc is null) return new OperationFailed(opId, "NoArchitectureFile", "No Architecture file");
        var root = await doc.GetSyntaxRootAsync(ct);
        if (root is null) return new OperationFailed(opId, "ParseError", "Could not parse");

        SyntaxNode newRoot;
        try { newRoot = DslWriter.SetTag(root, targetId, part, fields); }
        catch (DslEditRefusedException e) { return new OperationFailed(opId, e.Reason, e.Message); }
        catch (InvalidOperationException e) { return new OperationFailed(opId, "SetTagFailed", e.Message); }

        var oldSolution = _workspace.CurrentSolution;
        var newSolution = doc.WithSyntaxRoot(newRoot).Project.Solution;
        return await CommitAsync(opId, oldSolution, newSolution, () => new OperationApplied(opId, []), ct);
    }

    /// <summary>
    /// Every id something names, which a generated id must not be. Removing an element leaves its
    /// links, its layout, notes and styles, its comments and the views that list it, on purpose: they
    /// are references, shown detached. An id free in the declarations alone was given to the next new
    /// element, and every one of those attached to it — a link left pointing at nothing pointed at the
    /// new box.
    ///
    /// So: what the model declares and every value its declarations and tags hold (link ends, a
    /// context, a system, what a risk is about — every attribute, since one that is not an id cannot
    /// collide with one), every view's id and members, and every key and string in the layout sidecar
    /// and the comments file, where positions, styles, notes, book pages and comments are keyed by id.
    /// </summary>
    private async Task<HashSet<string>> TakenIdsAsync(ArchModel.ArchModel current, CancellationToken ct)
    {
        var taken = new HashSet<string>(StringComparer.Ordinal);
        foreach (var e in current.Elements)
        {
            taken.Add(e.Id);
            foreach (var value in e.Attributes.Values) if (value is not null) taken.Add(value);
        }
        foreach (var l in current.Links)
        {
            taken.Add(l.Id);
            taken.Add(l.FromId);
            taken.Add(l.ToId);
            foreach (var value in l.Attributes.Values) if (value is not null) taken.Add(value);
        }
        foreach (var t in current.Tags) taken.Add(t.TargetId);
        foreach (var doc in _workspace.CurrentSolution.Projects.SelectMany(p => p.Documents))
        {
            if (doc.FilePath is null || !InFolder(doc.FilePath, "Views")) continue;
            if (await doc.GetSyntaxRootAsync(ct) is not { } root || ViewsAdapter.TryReadOne(root) is not { } view) continue;
            taken.Add(view.Id);
            taken.UnionWith(view.ElementIds);
        }
        AddJsonStrings(LayoutSidecar.PathFor(_model.RootPath), taken);
        AddJsonStrings(CommentsSidecar.PathFor(_model.RootPath), taken);
        return taken;
    }

    /// <summary>Every property name and every string value in the JSON file at <paramref name="path"/>.</summary>
    private void AddJsonStrings(string path, HashSet<string> into)
    {
        if (!File.Exists(path)) return;
        try
        {
            using var json = System.Text.Json.JsonDocument.Parse(File.ReadAllBytes(path),
                new System.Text.Json.JsonDocumentOptions { AllowTrailingCommas = true, CommentHandling = System.Text.Json.JsonCommentHandling.Skip });
            Walk(json.RootElement);
        }
        catch (Exception e) when (e is System.Text.Json.JsonException or IOException or UnauthorizedAccessException)
        {
            // Silent on purpose: a file that cannot be read (a merge left its markers in) names nothing
            // that can be found, every write to it is refused and says so, and the id is generated from
            // what can be read.
        }

        void Walk(System.Text.Json.JsonElement element)
        {
            switch (element.ValueKind)
            {
                case System.Text.Json.JsonValueKind.Object:
                    foreach (var property in element.EnumerateObject())
                    {
                        into.Add(property.Name);
                        Walk(property.Value);
                    }
                    break;
                case System.Text.Json.JsonValueKind.Array:
                    foreach (var item in element.EnumerateArray()) Walk(item);
                    break;
                case System.Text.Json.JsonValueKind.String:
                    into.Add(element.GetString()!);
                    break;
            }
        }
    }

    private static string GenerateId(ArchElementKind kind, IReadOnlySet<string> taken)
    {
        var prefix = kind switch
        {
            ArchElementKind.Module => "mod",
            ArchElementKind.BoundedContext => "ctx",
            ArchElementKind.SoftwareSystem => "sys",
            ArchElementKind.Container => "cnt",
            ArchElementKind.Person => "per",
            ArchElementKind.UseCase => "uc",
            ArchElementKind.Capability => "cap",
            ArchElementKind.Question => "q",
            ArchElementKind.Assumption => "asm",
            ArchElementKind.Risk => "risk",
            ArchElementKind.Concept => "con",
            _ => "elem"
        };
        for (var n = 1; ; n++)
        {
            var candidate = $"{prefix}_{n:000}";
            if (!taken.Contains(candidate)) return candidate;
        }
    }

    private static string GenerateLinkId(ArchLinkKind kind, IReadOnlySet<string> taken)
    {
        var prefix = kind switch
        {
            ArchLinkKind.DataFlow => "flow",
            ArchLinkKind.Relation => "rel",
            _ => "dep",
        };
        for (var n = 1; ; n++)
        {
            var candidate = $"{prefix}_{n:000}";
            if (!taken.Contains(candidate)) return candidate;
        }
    }

}
