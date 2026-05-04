using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.CSharp;
using Microsoft.CodeAnalysis.CSharp.Syntax;

namespace Verso.Engine.ArchModel;

/// <summary>
/// A user-defined view in code form. Persisted as a `Views/<Name>.cs` file in the workspace.
///
/// Encoding (one file per view):
///
/// <code>
/// using Verso.Model;
/// namespace YourWorkspace;
///
/// public static class BuyerJourney
/// {
///     public static View Define() => new(
///         Id: "view_abc",
///         Name: "Buyer Journey",
///         BaseView: "moduleMap",
///         ElementIds: new[] { "mod_001", "mod_002", "mod_003" });
/// }
/// </code>
/// </summary>
public sealed record ArchView(
    string Id,
    string Name,
    string BaseView,
    IReadOnlyList<string> ElementIds);

public static class ViewsAdapter
{
    public static IReadOnlyList<ArchView> ReadAllFrom(IEnumerable<(string FilePath, SyntaxNode Root)> docs)
    {
        var views = new List<ArchView>();
        foreach (var (filePath, root) in docs)
        {
            if (filePath is null) continue;
            if (!filePath.Replace('\\', '/').Contains("/Views/", StringComparison.OrdinalIgnoreCase)) continue;
            var v = TryReadOne(root);
            if (v is not null) views.Add(v);
        }
        return views;
    }

    private static ArchView? TryReadOne(SyntaxNode root)
    {
        // Look for a `static class XYZ { static View Define() => new(...) }` (or method body).
        foreach (var cls in root.DescendantNodes().OfType<ClassDeclarationSyntax>())
        {
            var define = cls.Members.OfType<MethodDeclarationSyntax>().FirstOrDefault(m => m.Identifier.Text == "Define");
            if (define is null) continue;

            var creation = define.DescendantNodes().OfType<BaseObjectCreationExpressionSyntax>().FirstOrDefault();
            if (creation?.ArgumentList is null) continue;

            string? id = null, name = null, baseView = null;
            var elementIds = new List<string>();
            foreach (var arg in creation.ArgumentList.Arguments)
            {
                var nameId = arg.NameColon?.Name.Identifier.Text;
                switch (nameId)
                {
                    case "Id": id = AsString(arg.Expression); break;
                    case "Name": name = AsString(arg.Expression); break;
                    case "BaseView": baseView = AsString(arg.Expression); break;
                    case "ElementIds":
                        foreach (var inner in arg.Expression.DescendantNodes().OfType<LiteralExpressionSyntax>())
                            if (inner.Token.IsKind(SyntaxKind.StringLiteralToken))
                                elementIds.Add(inner.Token.ValueText);
                        break;
                }
            }
            if (id is not null && name is not null)
                return new ArchView(id, name, baseView ?? "all", elementIds);
        }
        return null;
    }

    private static string? AsString(ExpressionSyntax expr) =>
        expr is LiteralExpressionSyntax lit && lit.Token.IsKind(SyntaxKind.StringLiteralToken) ? lit.Token.ValueText : null;

    /// <summary>
    /// Build the file content for a `Views/&lt;Name&gt;.cs` file. The class name is derived from
    /// the view's name by stripping non-alphanumerics; a `_` prefix is added if the result starts
    /// with a digit.
    /// </summary>
    public static (string FilePath, string Content) Render(string workspaceRoot, string namespaceName, ArchView view)
    {
        var className = ClassNameFromViewName(view.Name);
        var fileName = $"{className}.cs";
        var path = Path.Combine(workspaceRoot, "Views", fileName);

        var idsBlock = view.ElementIds.Count == 0
            ? "[]"
            : "new[] { " + string.Join(", ", view.ElementIds.Select(id => $"\"{id}\"")) + " }";

        var content = $$"""
            using Verso.Model;

            namespace {{namespaceName}};

            public static class {{className}}
            {
                public static View Define() => new(
                    Id: "{{view.Id}}",
                    Name: "{{view.Name.Replace("\"", "\\\"")}}",
                    BaseView: "{{view.BaseView}}",
                    ElementIds: {{idsBlock}});
            }
            """;
        return (path, content);
    }

    public static string ClassNameFromViewName(string viewName)
    {
        var sb = new System.Text.StringBuilder();
        var capNext = true;
        foreach (var ch in viewName)
        {
            if (char.IsLetterOrDigit(ch))
            {
                sb.Append(capNext ? char.ToUpperInvariant(ch) : ch);
                capNext = false;
            }
            else { capNext = true; }
        }
        if (sb.Length == 0) sb.Append("View");
        if (char.IsDigit(sb[0])) sb.Insert(0, '_');
        return sb.ToString();
    }
}
