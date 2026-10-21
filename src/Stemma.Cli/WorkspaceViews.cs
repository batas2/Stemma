using Microsoft.CodeAnalysis.CSharp;
using Stemma.Engine.ArchModel;
using Stemma.Engine.Workspace;

namespace Stemma.Cli;

/// <summary>
/// The views of a workspace, read off the disk as the app holds them: every C# file in a folder named
/// <c>Views</c>, at any depth, that declares one — never build output, which the workspace leaves
/// out. Reading only the root's <c>Views/</c> took in a stale copy in <c>Views/obj/</c> and missed a
/// view the app lists.
/// </summary>
internal static class WorkspaceViews
{
    /// <summary>Each view with the file declaring it, in path order, so "the first one" is the same every run.</summary>
    public static IReadOnlyList<(string File, ArchView View)> Read(string workspaceRoot)
    {
        var root = Path.GetFullPath(workspaceRoot);
        return ModelWorkspaceLoader.SourcesIn(root)
            .Where(f => ("/" + Path.GetRelativePath(root, f).Replace('\\', '/')).Contains("/Views/", StringComparison.OrdinalIgnoreCase))
            .Order(StringComparer.Ordinal)
            .SelectMany(f => ViewsAdapter.ReadAllFrom([(f, CSharpSyntaxTree.ParseText(File.ReadAllText(f), path: f).GetRoot())])
                .Select(view => (f, view)))
            .ToList();
    }
}
