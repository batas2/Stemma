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
        if (path.Replace('\\', '/').Contains("/Architecture/", StringComparison.OrdinalIgnoreCase)) return true;
        return _workspace.CurrentSolution.Projects
            .SelectMany(p => p.Documents)
            .Any(d => string.Equals(d.FilePath, path, StringComparison.OrdinalIgnoreCase))
            || ProjectFor(path) is not null;
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
            if (!File.Exists(path) || ProjectFor(path) is not { } project) return false;
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
            // finds nothing to take in.
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
            }
            catch (Exception e)
            {
                // Undo for this operation is now impossible. Continuing is right — the edit itself is
                // still valid — but it must not be silent: "undo stopped working" was unanswerable
                // while this was a bare `catch { }`.
                _archBeforeOp = null;
                EngineLog.UndoSnapshotUnavailable(_log, op.GetType().Name, e);
            }
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

        if (recordUndo && result is OperationApplied)
        {
            // What the edit wrote is the undo; the inverse operation is only the fallback for when
            // the file has changed since (see RestoreDocumentsOp).
            var writes = _lastWrites;
            var fallback = UndoStack.BuildInverse(op, _archBeforeOp) ?? await InverseOfAddAsync(op, ct);
            if (writes.Count > 0 || fallback is not null)
                _undo.Push(op, new RestoreDocumentsOp($"undo_{Guid.NewGuid():N}", writes, fallback), DescribeOp(op));
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

    public async ValueTask DisposeAsync()
    {
        if (_watcher is not null) await _watcher.DisposeAsync();
        _workspace.Dispose();
        EngineLog.WorkspaceClosed(_log);
        await Task.CompletedTask;
    }

    public async Task<OperationResult> UndoAsync(string opId, CancellationToken ct = default)
    {
        await _gate.WaitAsync(ct);
        try
        {
            var entry = _undo.PopUndo();
            if (entry is null) return new OperationFailed(opId, "NothingToUndo", "Undo stack is empty");
            // Apply the inverse op without re-pushing onto the undo stack.
            var inverse = entry.Inverse with { OpId = opId };
            return await ApplyInternalAsync(inverse, recordUndo: false, ct);
        }
        finally { _gate.Release(); }
    }

    public async Task<OperationResult> RedoAsync(string opId, CancellationToken ct = default)
    {
        await _gate.WaitAsync(ct);
        try
        {
            var entry = _undo.PopRedo();
            if (entry is null) return new OperationFailed(opId, "NothingToRedo", "Redo stack is empty");
            var forward = entry.Forward with { OpId = opId };
            return await ApplyInternalAsync(forward, recordUndo: false, ct);
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
        // MSBuildWorkspace persists changes to disk inside TryApplyChanges. Snapshot
        // every touched file's contents so we can restore them on a compile failure.
        var changes = newSolution.GetChanges(oldSolution);
        var touchedPaths = new List<string>();
        foreach (var projectChange in changes.GetProjectChanges())
        {
            foreach (var docId in projectChange.GetChangedDocuments()
                         .Concat(projectChange.GetAddedDocuments())
                         .Concat(projectChange.GetRemovedDocuments()))
            {
                var doc = oldSolution.GetDocument(docId) ?? newSolution.GetDocument(docId);
                if (doc?.FilePath is not null) touchedPaths.Add(doc.FilePath);
            }
        }
        var backups = new Dictionary<string, string?>();
        foreach (var path in touchedPaths.Distinct(StringComparer.OrdinalIgnoreCase))
        {
            backups[path] = File.Exists(path) ? await File.ReadAllTextAsync(path, ct) : null;
        }


        // Never write over a version of a file this edit was not computed from. Between someone's
        // save and the watcher noticing it there is a window of a second or so, and an edit applied
        // in it would put the old text back with the new change on top (B-008).
        foreach (var projectChange in changes.GetProjectChanges())
        {
            foreach (var docId in projectChange.GetChangedDocuments().Concat(projectChange.GetRemovedDocuments()))
            {
                var before = oldSolution.GetDocument(docId);
                if (before?.FilePath is not { } path || !File.Exists(path)) continue;
                var seen = await before.GetTextAsync(ct);
                if (seen.ContentEquals(ReadFromDisk(path))) continue;

                await TakeInFromDiskAsync(path, ct);
                await ReloadAsync(ct);
                _undo.OnExternalChange();
                ExternalChange?.Invoke(path);
                return new OperationFailed(opId, "ChangedOnDisk",
                    $"{Path.GetFileName(path)} changed outside Stemma since it was last read. The new version is loaded; try again.");
            }
        }

        // Capture the errors that already exist BEFORE the edit. The compile gate must only
        // reject errors the op itself INTRODUCES — a workspace can carry pre-existing or
        // environmental errors (e.g. an unresolved reference, or a framework that didn't load
        // in this host) and the user should still be able to edit it. Signatures drop source
        // locations so a pre-existing error that merely shifts down a line when the op inserts
        // a statement isn't mistaken for a new one.
        var baselineErrors = await CollectErrorSignaturesAsync(oldSolution, ct);

        var projectFiles = await SnapshotProjectFilesAsync(oldSolution, ct);
        if (!_workspace.TryApplyChanges(newSolution))
            return new OperationFailed(opId, "ApplyFailed", "TryApplyChanges returned false");
        await RestoreProjectFilesAsync(projectFiles, ct);

        var introduced = await CollectIntroducedErrorsAsync(baselineErrors, ct);
        if (introduced.Count > 0)
        {
            foreach (var (path, original) in backups)
            {
                if (original is null)
                {
                    if (File.Exists(path)) File.Delete(path);
                }
                else
                {
                    await WriteFileAtomicAsync(path, original, ct);
                }
            }
            _workspace.TryApplyChanges(oldSolution);
            await RestoreProjectFilesAsync(projectFiles, ct);
            return new OperationFailed(opId, "WouldBreakBuild", "This change introduced compile errors and was rolled back.", introduced);
        }

        await VerifyWritesAsync(newSolution, backups, ct);
        _lastWrites = await DescribeWritesAsync(changes, oldSolution, newSolution, ct);

        await ReloadAsync(ct);
        return buildSuccessResult();
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

    private async Task<OperationBase?> InverseOfAddAsync(OperationBase op, CancellationToken ct)
    {
        // An add's inverse needs the id the engine generated, which only the model after it knows.
        if (op is not (AddElementOp or AddLinkOp)) return null;
        var fresh = await ReadArchModelAsync(ct);
        return op switch
        {
            AddElementOp add => fresh?.Elements
                .Where(e => e.Kind == add.ElementKind && e.Name == add.Name)
                .OrderByDescending(e => e.Id)
                .Select(e => new RemoveElementOp($"undo_{Guid.NewGuid():N}", e.Id))
                .FirstOrDefault(),
            AddLinkOp add => fresh?.Links
                .Where(l => l.Kind == add.LinkKind && l.FromId == add.FromId && l.ToId == add.ToId)
                .OrderByDescending(l => l.Id)
                .Select(l => new RemoveLinkOp($"undo_{Guid.NewGuid():N}", l.Id))
                .FirstOrDefault(),
            _ => null,
        };
    }

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
        var oldSolution = _workspace.CurrentSolution;
        var existingDoc = FindDocument(op.FilePath);
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
            var project = oldSolution.Projects
                .OrderByDescending(p => op.FilePath.StartsWith(Path.GetDirectoryName(p.FilePath ?? "") ?? "", StringComparison.OrdinalIgnoreCase))
                .FirstOrDefault();
            if (project is null) return new OperationFailed(op.OpId, "NoProject", "No project to host file");
            var newDoc = project.AddDocument(Path.GetFileName(op.FilePath), content, filePath: op.FilePath);
            newSolution = newDoc.Project.Solution;
        }
        else
        {
            var root = await existingDoc.GetSyntaxRootAsync(ct);
            if (root is not CompilationUnitSyntax cu) return new OperationFailed(op.OpId, "ParseError", "Could not parse target file");
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
        var typeModel = _model.FindType(op.TypeId);
        if (typeModel is null) return new OperationFailed(op.OpId, "TypeNotFound", op.TypeId);
        var doc = FindDocument(typeModel.FilePath);
        if (doc is null) return new OperationFailed(op.OpId, "DocumentNotFound", typeModel.FilePath);

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
        var typeModel = _model.FindType(op.TypeId);
        if (typeModel is null) return new OperationFailed(op.OpId, "TypeNotFound", op.TypeId);
        var doc = FindDocument(typeModel.FilePath);
        if (doc is null) return new OperationFailed(op.OpId, "DocumentNotFound", typeModel.FilePath);
        var root = await doc.GetSyntaxRootAsync(ct);
        if (root is null) return new OperationFailed(op.OpId, "ParseError", "Could not parse");
        var typeNode = root.DescendantNodes().OfType<BaseTypeDeclarationSyntax>()
            .FirstOrDefault(t => t.Identifier.Text == typeModel.Name);
        if (typeNode is null) return new OperationFailed(op.OpId, "TypeNodeNotFound", op.TypeId);

        var newRoot = TypeWriter.RemoveMember(root, typeNode);
        var oldSolution = _workspace.CurrentSolution;
        var newSolution = doc.WithSyntaxRoot(newRoot).Project.Solution;
        return await CommitAsync(op.OpId, oldSolution, newSolution,
            () => new OperationApplied(op.OpId, [new TypeRemoved(op.TypeId)]), ct);
    }

    private async Task<OperationResult> AddPropertyAsync(AddPropertyOp op, CancellationToken ct)
    {
        var typeModel = _model.FindType(op.TypeId);
        if (typeModel is null) return new OperationFailed(op.OpId, "TypeNotFound", op.TypeId);
        var doc = FindDocument(typeModel.FilePath);
        if (doc is null) return new OperationFailed(op.OpId, "DocumentNotFound", typeModel.FilePath);
        var root = await doc.GetSyntaxRootAsync(ct);
        if (root is null) return new OperationFailed(op.OpId, "ParseError", "Could not parse");

        var typeDecl = root.DescendantNodes().OfType<TypeDeclarationSyntax>().FirstOrDefault(t => t.Identifier.Text == typeModel.Name);
        if (typeDecl is null) return new OperationFailed(op.OpId, "TypeNodeNotFound", op.TypeId);

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
        var typeModel = _model.FindType(op.TypeId);
        if (typeModel is null) return new OperationFailed(op.OpId, "TypeNotFound", op.TypeId);
        var doc = FindDocument(typeModel.FilePath);
        if (doc is null) return new OperationFailed(op.OpId, "DocumentNotFound", typeModel.FilePath);
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
        var typeModel = _model.FindType(op.TypeId);
        if (typeModel is null) return new OperationFailed(op.OpId, "TypeNotFound", op.TypeId);
        var doc = FindDocument(typeModel.FilePath);
        if (doc is null) return new OperationFailed(op.OpId, "DocumentNotFound", typeModel.FilePath);
        var root = await doc.GetSyntaxRootAsync(ct);
        if (root is null) return new OperationFailed(op.OpId, "ParseError", "Could not parse");
        var typeDecl = root.DescendantNodes().OfType<TypeDeclarationSyntax>().FirstOrDefault(t => t.Identifier.Text == typeModel.Name);
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
        var typeModel = _model.FindType(op.TypeId);
        if (typeModel is null) return new OperationFailed(op.OpId, "TypeNotFound", op.TypeId);
        var doc = FindDocument(typeModel.FilePath);
        if (doc is null) return new OperationFailed(op.OpId, "DocumentNotFound", typeModel.FilePath);
        var root = await doc.GetSyntaxRootAsync(ct);
        if (root is null) return new OperationFailed(op.OpId, "ParseError", "Could not parse");
        var typeDecl = root.DescendantNodes().OfType<TypeDeclarationSyntax>().FirstOrDefault(t => t.Identifier.Text == typeModel.Name);
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
        var typeModel = _model.FindType(op.TypeId);
        var ifaceModel = _model.FindType(op.InterfaceTypeId);
        if (typeModel is null) return new OperationFailed(op.OpId, "TypeNotFound", op.TypeId);
        if (ifaceModel is null) return new OperationFailed(op.OpId, "InterfaceNotFound", op.InterfaceTypeId);
        var doc = FindDocument(typeModel.FilePath);
        if (doc is null) return new OperationFailed(op.OpId, "DocumentNotFound", typeModel.FilePath);
        var root = await doc.GetSyntaxRootAsync(ct);
        if (root is null) return new OperationFailed(op.OpId, "ParseError", "Could not parse");
        var typeDecl = root.DescendantNodes().OfType<TypeDeclarationSyntax>().FirstOrDefault(t => t.Identifier.Text == typeModel.Name);
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
        var typeModel = _model.FindType(typeId);
        var addedModel = _model.FindType(addedTypeId);
        if (typeModel is null) return new OperationFailed(opId, "TypeNotFound", typeId);
        if (addedModel is null) return new OperationFailed(opId, "TargetNotFound", addedTypeId);
        var doc = FindDocument(typeModel.FilePath);
        if (doc is null) return new OperationFailed(opId, "DocumentNotFound", typeModel.FilePath);
        var root = await doc.GetSyntaxRootAsync(ct);
        if (root is null) return new OperationFailed(opId, "ParseError", "Could not parse");
        var typeDecl = root.DescendantNodes().OfType<TypeDeclarationSyntax>().FirstOrDefault(t => t.Identifier.Text == typeModel.Name);
        if (typeDecl is null) return new OperationFailed(opId, "TypeNodeNotFound", typeId);

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

    private static async Task WriteFileAtomicAsync(string path, string contents, CancellationToken ct)
    {
        var dir = Path.GetDirectoryName(path);
        if (!string.IsNullOrEmpty(dir)) Directory.CreateDirectory(dir);
        var tmp = path + ".tmp";
        await File.WriteAllTextAsync(tmp, contents, ct);
        File.Move(tmp, path, overwrite: true);
    }

    /// <summary>
    /// Location-independent signatures of every compile error in a solution, used to tell
    /// errors the current op introduced apart from ones that were already present.
    /// </summary>
    private static async Task<HashSet<string>> CollectErrorSignaturesAsync(Solution solution, CancellationToken ct)
    {
        var signatures = new HashSet<string>();
        foreach (var project in solution.Projects)
        {
            var compilation = await project.GetCompilationAsync(ct);
            if (compilation is null) continue;
            foreach (var d in compilation.GetDiagnostics(ct))
            {
                if (d.Severity == DiagnosticSeverity.Error)
                    signatures.Add($"{project.Name}|{d.Id}|{d.GetMessage()}");
            }
        }
        return signatures;
    }

    /// <summary>
    /// Errors in the current workspace solution that are NOT in <paramref name="baseline"/> —
    /// the ones the just-applied op introduced. Returned with source locations for diagnostics.
    /// </summary>
    private async Task<IReadOnlyList<string>> CollectIntroducedErrorsAsync(HashSet<string> baseline, CancellationToken ct)
    {
        var introduced = new List<string>();
        foreach (var project in _workspace.CurrentSolution.Projects)
        {
            var compilation = await project.GetCompilationAsync(ct);
            if (compilation is null) continue;
            foreach (var d in compilation.GetDiagnostics(ct))
            {
                if (d.Severity != DiagnosticSeverity.Error) continue;
                if (baseline.Contains($"{project.Name}|{d.Id}|{d.GetMessage()}")) continue;
                introduced.Add($"{project.Name}: {d.Id} {d.GetMessage()} at {d.Location.GetLineSpan()}");
            }
        }
        return introduced;
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
                if (!doc.FilePath.Replace('\\', '/').Contains("/Architecture/", StringComparison.OrdinalIgnoreCase)) continue;
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
                if (!doc.FilePath.Replace('\\', '/').Contains("/Architecture/", StringComparison.OrdinalIgnoreCase)) continue;
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
        if (docs.Count == 1)
        {
            var root = await docs[0].GetSyntaxRootAsync(ct);
            if (root is null) return null;
            return DslReader.TryRead(docs[0].FilePath!, root);
        }
        // Merge multi-file model: aggregate elements/links/tags from every file.
        var elements = new List<ArchModel.ArchElement>();
        var links = new List<ArchModel.ArchLink>();
        var tags = new List<ArchModel.ArchTag>();
        var seen = new HashSet<string>();
        var primaryPath = docs[0].FilePath ?? "Architecture.cs";
        foreach (var doc in docs)
        {
            var root = await doc.GetSyntaxRootAsync(ct);
            if (root is null) continue;
            var partial = DslReader.TryRead(doc.FilePath!, root);
            if (partial is null) continue;
            foreach (var e in partial.Elements) if (seen.Add($"e:{e.Id}")) elements.Add(e);
            foreach (var l in partial.Links) if (seen.Add($"l:{l.Id}")) links.Add(l);
            foreach (var t in partial.Tags) tags.Add(t);
        }
        return new ArchModel.ArchModel(primaryPath, elements, links, tags);
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
    /// Best-effort namespace name to use for new files (Views, etc.). Picks the namespace of
    /// the primary Architecture file; falls back to the project name; last resort "Architecture".
    /// </summary>
    public string NamespaceForViews()
    {
        var doc = FindArchitectureDocument();
        if (doc is null) return _model.Projects.FirstOrDefault()?.Name ?? "Architecture";
        var root = doc.GetSyntaxRootAsync().GetAwaiter().GetResult();
        if (root is null) return _model.Projects.FirstOrDefault()?.Name ?? "Architecture";
        var fsns = root.DescendantNodes().OfType<FileScopedNamespaceDeclarationSyntax>().FirstOrDefault();
        if (fsns is not null) return fsns.Name.ToString();
        var ns = root.DescendantNodes().OfType<NamespaceDeclarationSyntax>().FirstOrDefault();
        return ns?.Name.ToString() ?? _model.Projects.FirstOrDefault()?.Name ?? "Architecture";
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
                    var (className, path) = NewViewFile(oldSolution, view.Name);
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
        foreach (var path in Directory.EnumerateFiles(_model.RootPath, "*.cs", SearchOption.AllDirectories))
        {
            if (heldPaths.Contains(path) || ProjectFor(path) is not { } project) continue;
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
            if (doc.FilePath is null || !doc.FilePath.Replace('\\', '/').Contains("/Views/", StringComparison.OrdinalIgnoreCase)) continue;
            var root = await doc.GetSyntaxRootAsync(ct);
            if (root is not null && ViewsAdapter.TryReadOne(root)?.Id == viewId) return (doc, root);
        }
        return null;
    }

    /// <summary>A class and file name for a new view that no file and no class in the workspace already has.</summary>
    private (string ClassName, string Path) NewViewFile(Solution solution, string viewName)
    {
        var taken = solution.Projects.SelectMany(p => p.Documents)
            .Select(d => d.GetSyntaxRootAsync().GetAwaiter().GetResult())
            .SelectMany(r => r?.DescendantNodes().OfType<ClassDeclarationSyntax>() ?? [])
            .Select(c => c.Identifier.Text)
            .ToHashSet(StringComparer.Ordinal);
        var stem = ViewsAdapter.ClassNameFromViewName(viewName);
        var dir = Path.Combine(_model.RootPath, "Views");
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

        var id = GenerateId(op.ElementKind, current);
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

        var newRoot = DslWriter.RenameElement(root, op.ElementId, op.NewName);
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
        var current = DslReader.TryRead(doc.FilePath!, root);
        if (current is null) return new OperationFailed(op.OpId, "InvalidArch", "Build() not found");

        if (!current.Elements.Any(e => e.Id == op.FromId))
            return new OperationFailed(op.OpId, "FromNotFound", op.FromId);
        if (!current.Elements.Any(e => e.Id == op.ToId))
            return new OperationFailed(op.OpId, "ToNotFound", op.ToId);

        var id = GenerateLinkId(op.LinkKind, current);
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

    private async Task<OperationResult> RestoreArchElementAsync(RestoreElementOp op, CancellationToken ct)
    {
        var doc = FindArchitectureDocument();
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
        var newRoot = DslWriter.AddElement(root, element);
        var oldSolution = _workspace.CurrentSolution;
        var newSolution = doc.WithSyntaxRoot(newRoot).Project.Solution;
        return await CommitAsync(op.OpId, oldSolution, newSolution,
            () => new OperationApplied(op.OpId, []), ct);
    }

    private async Task<OperationResult> RestoreArchLinkAsync(RestoreLinkOp op, CancellationToken ct)
    {
        var doc = FindArchitectureDocument();
        if (doc is null) return new OperationFailed(op.OpId, "NoArchitectureFile", "No Architecture file");
        var root = await doc.GetSyntaxRootAsync(ct);
        if (root is null) return new OperationFailed(op.OpId, "ParseError", "Could not parse");

        var attrs = new Dictionary<string, string?>();
        if (op.Payload is not null) attrs["payload"] = op.Payload;
        if (op.Direction is not null) attrs["direction"] = op.Direction;
        if (op.DependencyKind is not null) attrs["kind"] = op.DependencyKind;
        if (op.Label is not null) attrs["label"] = op.Label;
        var link = new ArchModel.ArchLink(op.LinkId, op.FromId, op.ToId, op.LinkKind, attrs);
        var newRoot = DslWriter.AddLink(root, link);
        var oldSolution = _workspace.CurrentSolution;
        var newSolution = doc.WithSyntaxRoot(newRoot).Project.Solution;
        return await CommitAsync(op.OpId, oldSolution, newSolution,
            () => new OperationApplied(op.OpId, []), ct);
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

    private static string GenerateId(ArchElementKind kind, ArchModel.ArchModel current)
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
        var existing = current.Elements.Select(e => e.Id).ToHashSet();
        for (var n = 1; ; n++)
        {
            var candidate = $"{prefix}_{n:000}";
            if (!existing.Contains(candidate)) return candidate;
        }
    }

    private static string GenerateLinkId(ArchLinkKind kind, ArchModel.ArchModel current)
    {
        var prefix = kind switch
        {
            ArchLinkKind.DataFlow => "flow",
            ArchLinkKind.Relation => "rel",
            _ => "dep",
        };
        var existing = current.Links.Select(l => l.Id).ToHashSet();
        for (var n = 1; ; n++)
        {
            var candidate = $"{prefix}_{n:000}";
            if (!existing.Contains(candidate)) return candidate;
        }
    }

}
