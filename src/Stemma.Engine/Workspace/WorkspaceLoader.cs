using Microsoft.Build.Locator;
using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.CSharp;
using Microsoft.CodeAnalysis.CSharp.Syntax;
using Microsoft.CodeAnalysis.MSBuild;
using Stemma.Engine.Models;
using TypeKind = Stemma.Engine.Models.TypeKind;

using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Logging.Abstractions;
using Stemma.Engine.Diagnostics;

namespace Stemma.Engine.Workspace;

public static class MsBuildBootstrap
{
    private static bool _registered;
    private static readonly object _gate = new();

    public static void EnsureRegistered()
    {
        lock (_gate)
        {
            if (_registered) return;
            if (!MSBuildLocator.IsRegistered)
            {
                MSBuildLocator.RegisterDefaults();
            }
            _registered = true;
        }
    }
}

public sealed class WorkspaceLoader(ILogger? log = null)
{
    /// <summary>Diagnostics only; absent by default so the loader stays usable without a stack.</summary>
    private readonly ILogger _log = log ?? NullLogger.Instance;

    public async Task<(MSBuildWorkspace Workspace, WorkspaceModel Model)> LoadAsync(string rootPath, CancellationToken ct = default)
    {
        MsBuildBootstrap.EnsureRegistered();
        var ws = MSBuildWorkspace.Create();
        ws.WorkspaceFailed += (_, e) =>
        {
            if (e.Diagnostic.Kind == WorkspaceDiagnosticKind.Failure)
            {
                // The whole of the backend's diagnostics used to be this line, on stderr, where a
                // desktop shell with no console cannot see it.
                EngineLog.WorkspaceLoadDiagnostic(_log, e.Diagnostic.Message);
            }
        };

        var slnPath = Directory.EnumerateFiles(rootPath, "*.sln", SearchOption.TopDirectoryOnly).FirstOrDefault();
        if (slnPath is not null)
        {
            await ws.OpenSolutionAsync(slnPath, cancellationToken: ct);
        }
        else
        {
            var csprojPaths = Directory.EnumerateFiles(rootPath, "*.csproj", SearchOption.AllDirectories).ToList();
            if (csprojPaths.Count == 0)
            {
                throw new InvalidOperationException($"No .sln or .csproj found under {rootPath}");
            }
            foreach (var csproj in csprojPaths)
            {
                await ws.OpenProjectAsync(csproj, cancellationToken: ct);
            }
        }

        var model = await BuildModelAsync(rootPath, ws.CurrentSolution, ct);
        return (ws, model);
    }

    /// <summary>
    /// The files <paramref name="projectFile"/> compiles, evaluated now: its globs against what is on
    /// disk at this moment, less whatever it removes. Kept apart from the engine's other code so that a
    /// model-only workspace, which may run with no SDK at all, never loads MSBuild through it.
    /// </summary>
    [System.Runtime.CompilerServices.MethodImpl(System.Runtime.CompilerServices.MethodImplOptions.NoInlining)]
    internal static async Task<HashSet<string>> CompileItemsAsync(Microsoft.CodeAnalysis.Workspace workspace, string projectFile, CancellationToken ct)
    {
        var loader = new MSBuildProjectLoader(workspace) { LoadMetadataForReferencedProjects = true };
        var projects = await loader.LoadProjectInfoAsync(projectFile, cancellationToken: ct);
        return projects
            .Where(p => string.Equals(p.FilePath, projectFile, StringComparison.OrdinalIgnoreCase))
            .SelectMany(p => p.Documents)
            .Select(d => d.FilePath)
            .OfType<string>()
            .ToHashSet(StringComparer.OrdinalIgnoreCase);
    }

    public static async Task<WorkspaceModel> BuildModelAsync(string rootPath, Solution solution, CancellationToken ct = default)
    {
        var projects = new List<ProjectModel>();
        foreach (var project in solution.Projects)
        {
            var types = new List<TypeModel>();
            foreach (var doc in project.Documents)
            {
                if (!doc.SupportsSyntaxTree) continue;
                var path = doc.FilePath;
                if (path is null) continue;
                if (path.EndsWith(".g.cs", StringComparison.OrdinalIgnoreCase)) continue;
                if (path.EndsWith(".designer.cs", StringComparison.OrdinalIgnoreCase)) continue;
                var tree = await doc.GetSyntaxTreeAsync(ct);
                if (tree is null) continue;
                var root = await tree.GetRootAsync(ct);

                foreach (var typeDecl in root.DescendantNodes().OfType<BaseTypeDeclarationSyntax>())
                {
                    var ns = GetNamespace(typeDecl);
                    var name = typeDecl.Identifier.Text;
                    var fqn = TypeIdOf(typeDecl);
                    var kind = typeDecl switch
                    {
                        ClassDeclarationSyntax => TypeKind.Class,
                        InterfaceDeclarationSyntax => TypeKind.Interface,
                        RecordDeclarationSyntax r => r.ClassOrStructKeyword.IsKind(SyntaxKind.StructKeyword) ? TypeKind.Struct : TypeKind.Record,
                        StructDeclarationSyntax => TypeKind.Struct,
                        EnumDeclarationSyntax => TypeKind.Enum,
                        _ => TypeKind.Class,
                    };
                    var visibility = ParseVisibility(typeDecl.Modifiers);

                    var props = new List<PropertyModel>();
                    var methods = new List<MethodSignatureModel>();
                    if (typeDecl is TypeDeclarationSyntax tds)
                    {
                        foreach (var prop in tds.Members.OfType<PropertyDeclarationSyntax>())
                        {
                            props.Add(new PropertyModel(
                                Name: prop.Identifier.Text,
                                Type: new TypeRef(prop.Type.ToString(), false),
                                Visibility: ParseVisibility(prop.Modifiers),
                                HasGetter: prop.AccessorList?.Accessors.Any(a => a.Kind() == SyntaxKind.GetAccessorDeclaration) ?? true,
                                HasSetter: prop.AccessorList?.Accessors.Any(a => a.Kind() == SyntaxKind.SetAccessorDeclaration) ?? false,
                                HasInit: prop.AccessorList?.Accessors.Any(a => a.Kind() == SyntaxKind.InitAccessorDeclaration) ?? false));
                        }
                        foreach (var meth in tds.Members.OfType<MethodDeclarationSyntax>())
                        {
                            var parameters = meth.ParameterList.Parameters
                                .Select(p => new ParameterModel(p.Identifier.Text, new TypeRef(p.Type?.ToString() ?? "object", false)))
                                .ToList();
                            methods.Add(new MethodSignatureModel(
                                Name: meth.Identifier.Text,
                                ReturnType: new TypeRef(meth.ReturnType.ToString(), false),
                                Parameters: parameters,
                                Visibility: ParseVisibility(meth.Modifiers)));
                        }
                    }

                    var baseTypes = new List<TypeRef>();
                    if (typeDecl.BaseList is { } bl)
                    {
                        foreach (var bt in bl.Types)
                        {
                            baseTypes.Add(new TypeRef(bt.Type.ToString(), false));
                        }
                    }

                    types.Add(new TypeModel(
                        Id: fqn,
                        Name: name,
                        Kind: kind,
                        FilePath: path,
                        Namespace: ns,
                        Visibility: visibility,
                        Properties: props,
                        Methods: methods,
                        BaseTypes: baseTypes));
                }
            }
            projects.Add(new ProjectModel(
                Name: project.Name,
                FilePath: project.FilePath ?? string.Empty,
                TargetFramework: ExtractTargetFramework(project),
                Types: types));
        }
        return new WorkspaceModel(rootPath, projects);
    }

    /// <summary>
    /// The id the model gives a type declaration: its namespace and its name. A type operation finds
    /// its declaration by this, never by the name alone.
    /// </summary>
    internal static string TypeIdOf(BaseTypeDeclarationSyntax typeDecl)
    {
        var ns = GetNamespace(typeDecl);
        return string.IsNullOrEmpty(ns) ? typeDecl.Identifier.Text : $"{ns}.{typeDecl.Identifier.Text}";
    }

    private static string GetNamespace(SyntaxNode node)
    {
        SyntaxNode? current = node.Parent;
        while (current is not null)
        {
            if (current is FileScopedNamespaceDeclarationSyntax fsns) return fsns.Name.ToString();
            if (current is NamespaceDeclarationSyntax nds) return nds.Name.ToString();
            current = current.Parent;
        }
        return string.Empty;
    }

    private static Visibility ParseVisibility(SyntaxTokenList modifiers)
    {
        if (modifiers.Any(SyntaxKind.PublicKeyword)) return Visibility.Public;
        if (modifiers.Any(SyntaxKind.ProtectedKeyword)) return Visibility.Protected;
        if (modifiers.Any(SyntaxKind.PrivateKeyword)) return Visibility.Private;
        return Visibility.Internal;
    }

    private static string ExtractTargetFramework(Project project)
    {
        var tf = project.ParseOptions?.PreprocessorSymbolNames.FirstOrDefault(s => s.StartsWith("NET"));
        return tf ?? "net10.0";
    }
}
