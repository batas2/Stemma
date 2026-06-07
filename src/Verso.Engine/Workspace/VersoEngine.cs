using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.CSharp;
using Microsoft.CodeAnalysis.CSharp.Syntax;
using Microsoft.CodeAnalysis.MSBuild;
using Microsoft.CodeAnalysis.Rename;
using Verso.Engine.ArchModel;
using Verso.Engine.Models;
using Verso.Engine.Operations;
using Verso.Engine.Validation;
using TypeKind = Verso.Engine.Models.TypeKind;

namespace Verso.Engine.Workspace;

public sealed class VersoEngine : IAsyncDisposable
{
    private readonly MSBuildWorkspace _workspace;
    private WorkspaceModel _model;
    private readonly SemaphoreSlim _gate = new(1, 1);
    private readonly UndoStack _undo = new();
    private ExternalWatcher? _watcher;
    private ArchModel.ArchModel? _archBeforeOp;
    private readonly Dictionary<string, DateTime> _lastSelfWriteAt = new(StringComparer.OrdinalIgnoreCase);
    private static readonly TimeSpan SelfWriteEchoWindow = TimeSpan.FromSeconds(1.5);

    public WorkspaceModel Model => _model;
    public string RootPath => _model.RootPath;
    public UndoStack Undo => _undo;
    public Microsoft.CodeAnalysis.Solution Solution => _workspace.CurrentSolution;
    public event Action<string>? ExternalChange;

    private VersoEngine(MSBuildWorkspace workspace, WorkspaceModel model)
    {
        _workspace = workspace;
        _model = model;
    }

    public void StartWatching()
    {
        _watcher?.DisposeAsync().AsTask().GetAwaiter().GetResult();
        _watcher = new ExternalWatcher(_model.RootPath, ShouldWatch);
        _watcher.Changed += OnExternalChange;
    }

    private bool ShouldWatch(string path)
    {
        // Watch Architecture/ + any project's tracked files.
        if (path.Replace('\\', '/').Contains("/Architecture/", StringComparison.OrdinalIgnoreCase)) return true;
        return _workspace.CurrentSolution.Projects
            .SelectMany(p => p.Documents)
            .Any(d => string.Equals(d.FilePath, path, StringComparison.OrdinalIgnoreCase));
    }

    private async void OnExternalChange(string path)
    {
        // Suppress the engine's own write echo: file events that arrive shortly after Verso wrote
        // the same file via TryApplyChanges are not user edits.
        lock (_lastSelfWriteAt)
        {
            if (_lastSelfWriteAt.TryGetValue(path, out var ts) && DateTime.UtcNow - ts < SelfWriteEchoWindow)
                return;
        }
        await _gate.WaitAsync();
        try
        {
            var contents = File.Exists(path) ? await File.ReadAllTextAsync(path) : null;
            // Try to update the existing document; otherwise reload solution.
            var doc = _workspace.CurrentSolution.Projects
                .SelectMany(p => p.Documents)
                .FirstOrDefault(d => string.Equals(d.FilePath, path, StringComparison.OrdinalIgnoreCase));
            if (doc is not null && contents is not null)
            {
                var newSol = doc.WithText(Microsoft.CodeAnalysis.Text.SourceText.From(contents)).Project.Solution;
                _workspace.TryApplyChanges(newSol);
            }
            await ReloadAsync();
            _undo.OnExternalChange();
            ExternalChange?.Invoke(path);
        }
        catch { /* engine swallows; client gets the broadcast eventually via reload */ }
        finally { _gate.Release(); }
    }

    public static async Task<VersoEngine> OpenAsync(string rootPath, CancellationToken ct = default)
    {
        var (ws, model) = await new WorkspaceLoader().LoadAsync(rootPath, ct);
        return new VersoEngine(ws, model);
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
        // Capture the arch model state BEFORE the op so we can build inverse ops.
        if (recordUndo)
        {
            try { _archBeforeOp = await ReadArchModelAsync(ct); }
            catch { _archBeforeOp = null; }
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
            SetElementContextOp x => await SetElementContextAsync(x, ct),
            SetElementAttributeOp x => await SetElementAttributeAsync(x, ct),
            _ => new OperationFailed(op.OpId, "UnknownOp", $"Unknown op {op.GetType().Name}")
        };

        if (recordUndo && result is OperationApplied)
        {
            var inverse = UndoStack.BuildInverse(op, _archBeforeOp);
            if (inverse is not null)
            {
                _undo.Push(op, inverse, DescribeOp(op));
            }
            else
            {
                // For Add* ops we defer the inverse until we know the new id.
                if (op is AddElementOp addEl)
                {
                    var fresh = await ReadArchModelAsync(ct);
                    var added = fresh?.Elements
                        .Where(e => e.Kind == addEl.ElementKind && e.Name == addEl.Name)
                        .OrderByDescending(e => e.Id)
                        .FirstOrDefault();
                    if (added is not null)
                    {
                        _undo.Push(op, new RemoveElementOp($"undo_{Guid.NewGuid():N}", added.Id), DescribeOp(op));
                    }
                }
                else if (op is AddLinkOp addLink)
                {
                    var fresh = await ReadArchModelAsync(ct);
                    var added = fresh?.Links
                        .Where(l => l.Kind == addLink.LinkKind && l.FromId == addLink.FromId && l.ToId == addLink.ToId)
                        .OrderByDescending(l => l.Id)
                        .FirstOrDefault();
                    if (added is not null)
                    {
                        _undo.Push(op, new RemoveLinkOp($"undo_{Guid.NewGuid():N}", added.Id), DescribeOp(op));
                    }
                }
            }
        }
        return result;
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
            foreach (var docId in projectChange.GetChangedDocuments().Concat(projectChange.GetAddedDocuments()))
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

        // Mark touched paths as self-writes so the file watcher's echo doesn't trigger a
        // spurious ExternalChange round-trip when MSBuildWorkspace persists the new content.
        lock (_lastSelfWriteAt)
        {
            var now = DateTime.UtcNow;
            foreach (var path in touchedPaths) _lastSelfWriteAt[path] = now;
        }

        // Capture the errors that already exist BEFORE the edit. The compile gate must only
        // reject errors the op itself INTRODUCES — a workspace can carry pre-existing or
        // environmental errors (e.g. an unresolved reference, or a framework that didn't load
        // in this host) and the user should still be able to edit it. Signatures drop source
        // locations so a pre-existing error that merely shifts down a line when the op inserts
        // a statement isn't mistaken for a new one.
        var baselineErrors = await CollectErrorSignaturesAsync(oldSolution, ct);

        if (!_workspace.TryApplyChanges(newSolution))
            return new OperationFailed(opId, "ApplyFailed", "TryApplyChanges returned false");

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
            return new OperationFailed(opId, "WouldBreakBuild", "This change introduced compile errors and was rolled back.", introduced);
        }

        await ReloadAsync(ct);
        return buildSuccessResult();
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
            var content = $"namespace {op.Namespace};{Environment.NewLine}{Environment.NewLine}{visibilityKw} {typeKindKw} {op.Name}{Environment.NewLine}{{{Environment.NewLine}}}{Environment.NewLine}";
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
            var newType = SyntaxFactory.ParseMemberDeclaration($"{visibilityKw} {typeKindKw} {op.Name}{Environment.NewLine}{{{Environment.NewLine}}}");
            if (newType is null) return new OperationFailed(op.OpId, "ParseError", "Could not synthesize new type");

            SyntaxNode newRoot;
            var ns = cu.DescendantNodes().OfType<BaseNamespaceDeclarationSyntax>()
                .FirstOrDefault(n => n.Name.ToString() == op.Namespace);
            if (ns is FileScopedNamespaceDeclarationSyntax fsns)
                newRoot = cu.ReplaceNode(fsns, fsns.AddMembers((MemberDeclarationSyntax)newType));
            else if (ns is NamespaceDeclarationSyntax nds)
                newRoot = cu.ReplaceNode(nds, nds.AddMembers((MemberDeclarationSyntax)newType));
            else
                newRoot = cu.AddMembers((MemberDeclarationSyntax)newType);
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

        var newRoot = root.RemoveNode(typeNode, SyntaxRemoveOptions.KeepLeadingTrivia);
        if (newRoot is null) return new OperationFailed(op.OpId, "RemoveFailed", "RemoveNode returned null");
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

        var newType = typeDecl.AddMembers((MemberDeclarationSyntax)prop);
        var newRoot = root.ReplaceNode(typeDecl, newType);
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

        var newRoot = root.RemoveNode(prop, SyntaxRemoveOptions.KeepLeadingTrivia);
        if (newRoot is null) return new OperationFailed(op.OpId, "RemoveFailed", "RemoveNode null");
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

        var newType = RemoveAtFromBaseList(typeDecl, 0);
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
        var newType = RemoveAtFromBaseList(typeDecl, idx);
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

        var baseTypeSyntax = SyntaxFactory.SimpleBaseType(SyntaxFactory.ParseTypeName(addedModel.Name));
        TypeDeclarationSyntax newType;
        if (typeDecl.BaseList is null)
        {
            // Move identifier's trailing trivia to the end of the base type so things like
            // "class Dog\n{" become "class Dog : Animal\n{" rather than collapsing whitespace.
            var origIdentifierTrailing = typeDecl.Identifier.TrailingTrivia;
            var typedBase = baseTypeSyntax.WithTrailingTrivia(origIdentifierTrailing);
            var newBaseList = SyntaxFactory.BaseList(SyntaxFactory.SingletonSeparatedList<BaseTypeSyntax>(typedBase))
                .WithColonToken(SyntaxFactory.Token(SyntaxKind.ColonToken)
                    .WithTrailingTrivia(SyntaxFactory.Space));
            newType = typeDecl
                .WithIdentifier(typeDecl.Identifier.WithTrailingTrivia(SyntaxFactory.Space))
                .WithBaseList(newBaseList);
        }
        else
        {
            if (typeDecl.BaseList.Types.Any(b => b.Type.ToString() == addedModel.Name))
                return new OperationFailed(opId, "AlreadyPresent", addedTypeId);
            var newBaseList = addAtFront
                ? typeDecl.BaseList.WithTypes(typeDecl.BaseList.Types.Insert(0, baseTypeSyntax))
                : typeDecl.BaseList.WithTypes(typeDecl.BaseList.Types.Add(baseTypeSyntax));
            newType = typeDecl.WithBaseList(newBaseList);
        }
        var newRoot = root.ReplaceNode(typeDecl, newType);
        var oldSolution = _workspace.CurrentSolution;
        var newSolution = doc.WithSyntaxRoot(newRoot).Project.Solution;
        return await CommitAsync(opId, oldSolution, newSolution, () =>
        {
            var refreshed = _model.FindType(typeId);
            return new OperationApplied(opId, refreshed is null ? [] : [new TypeUpdated(refreshed)]);
        }, ct);
    }

    private static TypeDeclarationSyntax RemoveAtFromBaseList(TypeDeclarationSyntax typeDecl, int index)
    {
        var bl = typeDecl.BaseList!;
        var newTypes = bl.Types.RemoveAt(index);
        if (newTypes.Count == 0)
        {
            // Move base list trailing trivia back to the identifier so things like
            // "class Dog : Animal\n{" become "class Dog\n{" cleanly.
            var origTrailing = bl.GetTrailingTrivia();
            return typeDecl
                .WithBaseList(null)
                .WithIdentifier(typeDecl.Identifier.WithTrailingTrivia(origTrailing));
        }
        return typeDecl.WithBaseList(bl.WithTypes(newTypes));
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
    /// Find the document that declares the given element/link id, falling back to the primary
    /// Architecture document if the id is not yet present (i.e. for AddElement / AddLink ops).
    /// </summary>
    public Document? FindDocumentForId(string id)
    {
        foreach (var doc in FindArchitectureDocuments())
        {
            var root = doc.GetSyntaxRootAsync().GetAwaiter().GetResult();
            if (root is null) continue;
            var hit = root.DescendantNodes().OfType<LocalDeclarationStatementSyntax>()
                .Any(s => s.Declaration.Variables.Any(v =>
                    v.Initializer?.Value is BaseObjectCreationExpressionSyntax oc
                    && oc.ArgumentList?.Arguments.Count > 0
                    && oc.ArgumentList.Arguments[0].Expression is LiteralExpressionSyntax lit
                    && lit.Token.ValueText == id));
            if (hit) return doc;
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
            () => new OperationApplied(op.OpId, []), ct);
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
        try { newRoot = DslWriter.RemoveStatementById(root, op.ElementId); }
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

        var attrs = new Dictionary<string, string?>(element.Attributes);
        if (string.IsNullOrEmpty(op.ContextId)) attrs.Remove("contextId");
        else attrs["contextId"] = op.ContextId;
        var updated = element with { Attributes = attrs };

        var newRoot = DslWriter.SetElement(root, updated);
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

        var attrs = new Dictionary<string, string?>(element.Attributes);
        if (string.IsNullOrEmpty(op.Value)) attrs.Remove(op.AttributeName);
        else attrs[op.AttributeName] = op.Value;
        var updated = element with { Attributes = attrs };

        var newRoot = DslWriter.SetElement(root, updated);
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
            () => new OperationApplied(op.OpId, []), ct);
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

        var attrs = new Dictionary<string, string?>(link.Attributes);
        if (op.Value is null) attrs.Remove(op.AttributeName);
        else attrs[op.AttributeName] = op.Value;

        var updated = link with { Attributes = attrs };
        var newRoot = DslWriter.SetLinkAttribute(root, updated);
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
        try { newRoot = DslWriter.RemoveStatementById(root, op.LinkId); }
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
        var link = new ArchModel.ArchLink(op.LinkId, op.FromId, op.ToId, op.LinkKind, attrs);
        var newRoot = DslWriter.AddLink(root, link);
        var oldSolution = _workspace.CurrentSolution;
        var newSolution = doc.WithSyntaxRoot(newRoot).Project.Solution;
        return await CommitAsync(op.OpId, oldSolution, newSolution,
            () => new OperationApplied(op.OpId, []), ct);
    }

    private async Task<OperationResult> SetLifecycleAsync(SetLifecycleOp op, CancellationToken ct)
    {
        var doc = FindDocumentForId(op.TargetId) ?? FindArchitectureDocument();
        if (doc is null) return new OperationFailed(op.OpId, "NoArchitectureFile", "No Architecture file");
        var root = await doc.GetSyntaxRootAsync(ct);
        if (root is null) return new OperationFailed(op.OpId, "ParseError", "Could not parse");
        var current = await ReadArchModelAsync(ct);
        if (current is null) return new OperationFailed(op.OpId, "InvalidArch", "Build() not found");
        var existingTag = current.Tags.FirstOrDefault(t => t.TargetId == op.TargetId);
        var existingOwnership = existingTag?.Ownership;

        var allEmpty = string.IsNullOrEmpty(op.Status) && string.IsNullOrEmpty(op.Phase)
                    && string.IsNullOrEmpty(op.ValidFrom) && string.IsNullOrEmpty(op.ValidUntil);
        var lifecycle = allEmpty ? null : new ArchLifecycle(op.Status, op.Phase, op.ValidFrom, op.ValidUntil);

        SyntaxNode newRoot;
        try { newRoot = DslWriter.SetTag(root, op.TargetId, lifecycle, existingOwnership); }
        catch (Exception e) { return new OperationFailed(op.OpId, "SetTagFailed", e.Message); }

        var oldSolution = _workspace.CurrentSolution;
        var newSolution = doc.WithSyntaxRoot(newRoot).Project.Solution;
        return await CommitAsync(op.OpId, oldSolution, newSolution,
            () => new OperationApplied(op.OpId, []), ct);
    }

    private async Task<OperationResult> SetOwnershipAsync(SetOwnershipOp op, CancellationToken ct)
    {
        var doc = FindDocumentForId(op.TargetId) ?? FindArchitectureDocument();
        if (doc is null) return new OperationFailed(op.OpId, "NoArchitectureFile", "No Architecture file");
        var root = await doc.GetSyntaxRootAsync(ct);
        if (root is null) return new OperationFailed(op.OpId, "ParseError", "Could not parse");
        var current = await ReadArchModelAsync(ct);
        if (current is null) return new OperationFailed(op.OpId, "InvalidArch", "Build() not found");
        var existingTag = current.Tags.FirstOrDefault(t => t.TargetId == op.TargetId);
        var existingLifecycle = existingTag?.Lifecycle;

        var allEmpty = string.IsNullOrEmpty(op.Squad) && string.IsNullOrEmpty(op.Domain);
        var ownership = allEmpty ? null : new ArchOwnership(op.Squad, op.Domain);

        SyntaxNode newRoot;
        try { newRoot = DslWriter.SetTag(root, op.TargetId, existingLifecycle, ownership); }
        catch (Exception e) { return new OperationFailed(op.OpId, "SetTagFailed", e.Message); }

        var oldSolution = _workspace.CurrentSolution;
        var newSolution = doc.WithSyntaxRoot(newRoot).Project.Solution;
        return await CommitAsync(op.OpId, oldSolution, newSolution,
            () => new OperationApplied(op.OpId, []), ct);
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
        var prefix = kind == ArchLinkKind.DataFlow ? "flow" : "dep";
        var existing = current.Links.Select(l => l.Id).ToHashSet();
        for (var n = 1; ; n++)
        {
            var candidate = $"{prefix}_{n:000}";
            if (!existing.Contains(candidate)) return candidate;
        }
    }

}
