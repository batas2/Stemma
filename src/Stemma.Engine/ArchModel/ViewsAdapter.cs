using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.CSharp;
using Microsoft.CodeAnalysis.CSharp.Syntax;

namespace Stemma.Engine.ArchModel;

/// <summary>
/// A user-defined view in code form. Persisted as a `Views/<Name>.cs` file in the workspace.
///
/// Encoding (one file per view):
///
/// <code>
/// using Stemma.Model;
/// namespace YourWorkspace;
///
/// public static class BuyerJourney
/// {
///     public static View Define() => new(
///         Id: "view_abc",
///         Name: "Buyer Journey",
///         BaseView: "moduleMap",
///         ElementIds: ["mod_001", "mod_002", "mod_003"]);
/// }
/// </code>
///
/// Hand-written view files are read in any of the usual forms — named or positional arguments,
/// <c>new[] { … }</c> or <c>[ … ]</c> — and saving one edits it in that form (<see cref="ViewsAdapter.Edit"/>).
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

    public static ArchView? TryReadOne(SyntaxNode root)
    {
        if (FindDefinition(root) is not { } creation) return null;
        var parameters = DslVocabulary.ParametersOf("View")!;
        string? id = null, name = null, baseView = null;
        var elementIds = new List<string>();
        var args = creation.ArgumentList!.Arguments;
        for (var i = 0; i < args.Count; i++)
        {
            switch (KeyOf(args[i], i, parameters))
            {
                case "id": id = AsString(args[i].Expression); break;
                case "name": name = AsString(args[i].Expression); break;
                case "baseView": baseView = AsString(args[i].Expression); break;
                case "elementIds":
                    foreach (var inner in args[i].Expression.DescendantNodes().OfType<LiteralExpressionSyntax>())
                        if (inner.Token.IsKind(SyntaxKind.StringLiteralToken))
                            elementIds.Add(inner.Token.ValueText);
                    break;
            }
        }
        return id is not null && name is not null ? new ArchView(id, name, baseView ?? "all", elementIds) : null;
    }

    /// <summary>The <c>new View(...)</c> a <c>Define()</c> method returns.</summary>
    private static BaseObjectCreationExpressionSyntax? FindDefinition(SyntaxNode root)
    {
        // Look for a `static class XYZ { static View Define() => new(...) }` (or method body).
        foreach (var cls in root.DescendantNodes().OfType<ClassDeclarationSyntax>())
        {
            var define = cls.Members.OfType<MethodDeclarationSyntax>().FirstOrDefault(m => m.Identifier.Text == "Define");
            var creation = define?.DescendantNodes().OfType<BaseObjectCreationExpressionSyntax>().FirstOrDefault();
            if (creation?.ArgumentList is not null) return creation;
        }
        return null;
    }

    private static string? KeyOf(ArgumentSyntax arg, int index, IReadOnlyList<string> parameters) =>
        arg.NameColon is { } nc ? DslVocabulary.AttributeName(nc.Name.Identifier.Text)
            : index < parameters.Count ? parameters[index] : null;

    private static string? AsString(ExpressionSyntax expr) =>
        expr is LiteralExpressionSyntax lit && lit.Token.IsKind(SyntaxKind.StringLiteralToken) ? lit.Token.ValueText : null;

    /// <summary>
    /// The view file with its name, lens and members set to <paramref name="view"/>'s, each edited
    /// where it stands: a literal replaced, an id removed with its own line, a new id laid out like
    /// the last. Everything else — the doc comment, the class and file name, ids that are not string
    /// literals — is left as written. Returns <paramref name="root"/> itself when nothing changes.
    /// </summary>
    public static SyntaxNode Edit(SyntaxNode root, ArchView view)
    {
        var creation = FindDefinition(root) ?? throw new DslEditRefusedException("UnreadableView", "No View definition in this file.");
        var parameters = DslVocabulary.ParametersOf("View")!;
        var list = creation.ArgumentList!;
        list = DslWriter.SetArgument(list, parameters, "name", view.Name, "View", nullablePlaceholder: false) ?? list;
        list = DslWriter.SetArgument(list, parameters, "baseView", view.BaseView, "View", nullablePlaceholder: false) ?? list;

        var args = list.Arguments;
        var at = -1;
        for (var i = 0; i < args.Count && at < 0; i++)
            if (KeyOf(args[i], i, parameters) == "elementIds") at = i;
        if (at < 0)
        {
            var ids = SyntaxFactory.ParseExpression($"[{string.Join(", ", view.ElementIds.Select(id => DslWriter.Literal(id).ToString()))}]");
            list = list.WithArguments(SeparatedEdits.Append(args, DslWriter.NamedArgument("ElementIds", ids)));
        }
        else
        {
            var expression = args[at].Expression;
            var edited = EditMembers(expression, view.ElementIds);
            if (!ReferenceEquals(edited, expression)) list = list.WithArguments(args.Replace(args[at], args[at].WithExpression(edited)));
        }
        return ReferenceEquals(list, creation.ArgumentList) ? root : root.ReplaceNode(creation.ArgumentList!, list);
    }

    private static ExpressionSyntax EditMembers(ExpressionSyntax expression, IReadOnlyList<string> wanted)
    {
        // `new[] { … }` cannot be empty — it has no type to infer — so an emptied array becomes `[]`.
        static ExpressionSyntax Empty(ExpressionSyntax replaced) =>
            SyntaxFactory.CollectionExpression().WithTriviaFrom(replaced);

        switch (expression)
        {
            case CollectionExpressionSyntax collection:
            {
                var (open, items) = EditList(collection.OpenBracketToken, collection.Elements, wanted,
                    e => e is ExpressionElementSyntax { Expression: var x } ? AsString(x) : null,
                    id => SyntaxFactory.ExpressionElement(DslWriter.Literal(id)));
                return collection.WithOpenBracketToken(open).WithElements(items);
            }
            case ImplicitArrayCreationExpressionSyntax { Initializer: var init }:
            {
                if (wanted.Count == 0) return Empty(expression);
                var (open, items) = EditList(init.OpenBraceToken, init.Expressions, wanted, AsString, id => DslWriter.Literal(id));
                return expression.ReplaceNode(init, init.WithOpenBraceToken(open).WithExpressions(items));
            }
            case ArrayCreationExpressionSyntax { Initializer: { } init }:
            {
                if (wanted.Count == 0) return Empty(expression);
                var (open, items) = EditList(init.OpenBraceToken, init.Expressions, wanted, AsString, id => DslWriter.Literal(id));
                return expression.ReplaceNode(init, init.WithOpenBraceToken(open).WithExpressions(items));
            }
            default:
                throw new DslEditRefusedException("UnreadableView",
                    "This view's ElementIds is not written as an array or a collection of strings, so it cannot be edited in place.");
        }
    }

    /// <summary>Remove the ids no longer wanted, then append the new ones; the order of the rest stays as written.</summary>
    private static (SyntaxToken Open, SeparatedSyntaxList<T> Items) EditList<T>(
        SyntaxToken open, SeparatedSyntaxList<T> items, IReadOnlyList<string> wanted, Func<T, string?> valueOf, Func<string, T> make)
        where T : SyntaxNode
    {
        var keep = wanted.ToHashSet(StringComparer.Ordinal);
        for (var i = items.Count - 1; i >= 0; i--)
            if (valueOf(items[i]) is { } value && !keep.Contains(value))
                (open, items) = SeparatedEdits.RemoveAt(open, items, i);
        var present = items.Select(valueOf).OfType<string>().ToHashSet(StringComparer.Ordinal);
        foreach (var id in wanted)
            if (present.Add(id)) items = SeparatedEdits.Append(items, make(id));
        return (open, items);
    }

    /// <summary>
    /// The content of a new <c>Views/&lt;ClassName&gt;.cs</c> file. Only ever used for a file that
    /// does not exist yet: an existing view is edited in place by <see cref="Edit"/>.
    /// </summary>
    public static string Render(string namespaceName, string className, ArchView view)
    {
        var ids = string.Join(", ", view.ElementIds.Select(id => DslWriter.Literal(id).ToString()));
        return $$"""
            using Stemma.Model;

            namespace {{namespaceName}};

            public static class {{className}}
            {
                public static View Define() => new(
                    Id: {{DslWriter.Literal(view.Id)}},
                    Name: {{DslWriter.Literal(view.Name)}},
                    BaseView: {{DslWriter.Literal(view.BaseView)}},
                    ElementIds: [{{ids}}]);
            }

            """;
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
