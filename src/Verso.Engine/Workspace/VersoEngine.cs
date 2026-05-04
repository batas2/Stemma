using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.CSharp;
using Microsoft.CodeAnalysis.CSharp.Syntax;
using Microsoft.CodeAnalysis.MSBuild;
using Microsoft.CodeAnalysis.Rename;
using Verso.Engine.ArchModel;
using Verso.Engine.Models;
using Verso.Engine.Operations;
using TypeKind = Verso.Engine.Models.TypeKind;

namespace Verso.Engine.Workspace;

public sealed class VersoEngine : IAsyncDisposable
{
    private readonly MSBuildWorkspace _workspace;
    private WorkspaceModel _model;
    private readonly SemaphoreSlim _gate = new(1, 1);

    public WorkspaceModel Model => _model;
    public string RootPath => _model.RootPath;

    private VersoEngine(MSBuildWorkspace workspace, WorkspaceModel model)
    {
        _workspace = workspace;
        _model = model;
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
            return op switch
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
                _ => new OperationFailed(op.OpId, "UnknownOp", $"Unknown op {op.GetType().Name}")
            };
        }
        finally
        {
            _gate.Release();
        }
    }

    public async Task ReloadAsync(CancellationToken ct = default)
    {
        _model = await WorkspaceLoader.BuildModelAsync(_model.RootPath, _workspace.CurrentSolution, ct);
    }

    public async ValueTask DisposeAsync()
    {
        _workspace.Dispose();
        await Task.CompletedTask;
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

        if (!_workspace.TryApplyChanges(newSolution))
            return new OperationFailed(opId, "ApplyFailed", "TryApplyChanges returned false");

        var (ok, errors) = await CheckCompileAsync(ct);
        if (!ok)
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
            return new OperationFailed(opId, "WouldBreakBuild", "Compilation broke", errors);
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

    private async Task<(bool ok, IReadOnlyList<string> errors)> CheckCompileAsync(CancellationToken ct)
    {
        var errors = new List<string>();
        foreach (var project in _workspace.CurrentSolution.Projects)
        {
            var compilation = await project.GetCompilationAsync(ct);
            if (compilation is null) continue;
            foreach (var d in compilation.GetDiagnostics(ct))
            {
                if (d.Severity == DiagnosticSeverity.Error)
                    errors.Add($"{project.Name}: {d.Id} {d.GetMessage()} at {d.Location.GetLineSpan()}");
            }
        }
        return (errors.Count == 0, errors);
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
    /// Locate the document whose root contains a `static class Architecture { Build() {...} }`.
    /// Returns null if the workspace is not a model workspace (i.e. has no Architecture/).
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

    public async Task<ArchModel.ArchModel?> ReadArchModelAsync(CancellationToken ct = default)
    {
        var doc = FindArchitectureDocument();
        if (doc is null) return null;
        var root = await doc.GetSyntaxRootAsync(ct);
        if (root is null) return null;
        return DslReader.TryRead(doc.FilePath!, root);
    }

    private async Task<OperationResult> AddArchElementAsync(AddElementOp op, CancellationToken ct)
    {
        var doc = FindArchitectureDocument();
        if (doc is null) return new OperationFailed(op.OpId, "NoArchitectureFile", "No Architecture/Architecture.cs found");
        var root = await doc.GetSyntaxRootAsync(ct);
        if (root is null) return new OperationFailed(op.OpId, "ParseError", "Could not parse Architecture file");

        var current = DslReader.TryRead(doc.FilePath!, root);
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
        var doc = FindArchitectureDocument();
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
        var doc = FindArchitectureDocument();
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
        var doc = FindArchitectureDocument();
        if (doc is null) return new OperationFailed(op.OpId, "NoArchitectureFile", "No Architecture file");
        var root = await doc.GetSyntaxRootAsync(ct);
        if (root is null) return new OperationFailed(op.OpId, "ParseError", "Could not parse");
        var current = DslReader.TryRead(doc.FilePath!, root);
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
        var doc = FindArchitectureDocument();
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
