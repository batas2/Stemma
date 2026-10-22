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
///
/// A view is a scope and rules as well as a list (ADR-0026): <paramref name="Scope"/> names the system a
/// C4 lens is drawn around, and <paramref name="Include"/> / <paramref name="Exclude"/> are selector
/// strings. They are edited where they stand, like the members.
/// </summary>
/// <param name="ElementIds">As written; empty when the file has none.</param>
/// <param name="Scope">Null when the file has none; on a save, null leaves it as written and "" removes it.</param>
/// <param name="Include">Null when the file has none; on a save, null leaves it as written.</param>
/// <param name="Exclude">Null when the file has none; on a save, null leaves it as written.</param>
public sealed record ArchView(
    string Id,
    string Name,
    string BaseView,
    IReadOnlyList<string> ElementIds,
    string? Scope = null,
    IReadOnlyList<string>? Include = null,
    IReadOnlyList<string>? Exclude = null);

public static class ViewsAdapter
{
    /// <summary>
    /// Whether <paramref name="path"/> is in a folder called Views inside the workspace, at any depth —
    /// counted from <paramref name="workspaceRoot"/>, never from the top of the disk: looked for in the
    /// absolute path, a workspace kept in ~/Views/shop took every file in it for a view file.
    /// </summary>
    public static bool IsViewFile(string workspaceRoot, string path)
    {
        var relative = Path.GetRelativePath(workspaceRoot, path);
        if (relative.StartsWith("..", StringComparison.Ordinal) || Path.IsPathRooted(relative)) return false;
        return relative.Split(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar).SkipLast(1)
            .Contains("Views", StringComparer.OrdinalIgnoreCase);
    }

    public static IReadOnlyList<ArchView> ReadAllFrom(string workspaceRoot, IEnumerable<(string FilePath, SyntaxNode Root)> docs)
    {
        var views = new List<ArchView>();
        foreach (var (filePath, root) in docs)
        {
            if (filePath is null) continue;
            if (!IsViewFile(workspaceRoot, filePath)) continue;
            var v = TryReadOne(root);
            if (v is not null) views.Add(v);
        }
        return views;
    }

    public static ArchView? TryReadOne(SyntaxNode root)
    {
        if (FindDefinition(root) is not { } creation) return null;
        var parameters = DslVocabulary.ParametersOf("View")!;
        string? id = null, name = null, baseView = null, scope = null;
        IReadOnlyList<string>? elementIds = null, include = null, exclude = null;
        var args = creation.ArgumentList!.Arguments;
        for (var i = 0; i < args.Count; i++)
        {
            var expression = args[i].Expression;
            switch (KeyOf(args[i], i, parameters))
            {
                case "id": id = AsString(expression); break;
                case "name": name = AsString(expression); break;
                case "baseView": baseView = AsString(expression); break;
                case "elementIds": elementIds = Strings(expression); break;
                case "scope": scope = AsString(expression); break;
                case "include": include = Strings(expression); break;
                case "exclude": exclude = Strings(expression); break;
            }
        }
        return id is not null && name is not null
            ? new ArchView(id, name, baseView ?? "all", elementIds ?? [], scope, include, exclude)
            : null;
    }

    /// <summary>The string literals in a list argument, in order; null for a <c>null</c> written in its place.</summary>
    private static IReadOnlyList<string>? Strings(ExpressionSyntax expression) =>
        expression.IsKind(SyntaxKind.NullLiteralExpression)
            ? null
            : expression.DescendantNodes().OfType<LiteralExpressionSyntax>()
                .Where(l => l.Token.IsKind(SyntaxKind.StringLiteralToken))
                .Select(l => l.Token.ValueText)
                .ToList();

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
    /// The view file with its name, lens, members, scope and rules set to <paramref name="view"/>'s,
    /// each edited where it stands: a literal replaced, an id removed with its own line, a new id laid
    /// out like the last, a missing argument appended by name (ADR-0026). A scope, include or exclude
    /// that <paramref name="view"/> leaves null is left as written, so a save from a canvas that only
    /// changed the members keeps the rules. Everything else — the doc comment, the class and file name,
    /// ids that are not string literals — is left as written. Returns <paramref name="root"/> itself
    /// when nothing changes.
    /// </summary>
    public static SyntaxNode Edit(SyntaxNode root, ArchView view)
    {
        var creation = FindDefinition(root) ?? throw new DslEditRefusedException("UnreadableView", "No View definition in this file.");
        var parameters = DslVocabulary.ParametersOf("View")!;
        var list = creation.ArgumentList!;
        list = DslWriter.SetArgument(list, parameters, "name", view.Name, "View", nullablePlaceholder: false) ?? list;
        list = DslWriter.SetArgument(list, parameters, "baseView", view.BaseView, "View", nullablePlaceholder: false) ?? list;
        list = EditList(list, parameters, "elementIds", view.ElementIds);
        if (view.Scope is not null) list = EditScope(list, parameters, view.Scope);
        if (view.Include is not null) list = EditList(list, parameters, "include", view.Include);
        if (view.Exclude is not null) list = EditList(list, parameters, "exclude", view.Exclude);
        return ReferenceEquals(list, creation.ArgumentList) ? root : root.ReplaceNode(creation.ArgumentList!, list);
    }

    private static int IndexOf(SeparatedSyntaxList<ArgumentSyntax> args, IReadOnlyList<string> parameters, string key)
    {
        for (var i = 0; i < args.Count; i++)
            if (KeyOf(args[i], i, parameters) == key) return i;
        return -1;
    }

    /// <summary>
    /// The scope replaced where it stands, removed when it is "", or appended by name. A scope written
    /// by position before a rule that is too becomes <c>null</c>, which keeps the rule in its place.
    /// </summary>
    private static ArgumentListSyntax EditScope(ArgumentListSyntax list, IReadOnlyList<string> parameters, string scope)
    {
        var value = scope.Length == 0 ? null : scope;
        if (IndexOf(list.Arguments, parameters, "scope") >= 0)
            return DslWriter.SetArgument(list, parameters, "scope", value, "View", nullablePlaceholder: true) ?? list;
        return value is null
            ? list
            : list.WithArguments(SeparatedEdits.Append(list.Arguments, DslWriter.NamedArgument("Scope", DslWriter.Literal(value))));
    }

    /// <summary>
    /// A list argument — the members, the includes, the excludes — edited in whatever form it is written
    /// in, or appended by name when it is missing and <paramref name="wanted"/> has something in it.
    /// </summary>
    private static ArgumentListSyntax EditList(ArgumentListSyntax list, IReadOnlyList<string> parameters, string key, IReadOnlyList<string> wanted)
    {
        var args = list.Arguments;
        var at = IndexOf(args, parameters, key);
        if (at < 0)
        {
            if (wanted.Count == 0) return list;
            var items = SyntaxFactory.ParseExpression($"[{string.Join(", ", wanted.Select(id => DslWriter.Literal(id).ToString()))}]");
            return list.WithArguments(SeparatedEdits.Append(args, DslWriter.NamedArgument(DslVocabulary.ParameterName(key), items)));
        }
        var expression = args[at].Expression;
        var edited = EditMembers(expression, wanted, DslVocabulary.ParameterName(key));
        return ReferenceEquals(edited, expression) ? list : list.WithArguments(args.Replace(args[at], args[at].WithExpression(edited)));
    }

    private static ExpressionSyntax EditMembers(ExpressionSyntax expression, IReadOnlyList<string> wanted, string what)
    {
        // `new[] { … }` cannot be empty — it has no type to infer — so an emptied array becomes `[]`.
        static ExpressionSyntax Empty(ExpressionSyntax replaced) =>
            SyntaxFactory.CollectionExpression().WithTriviaFrom(replaced);

        switch (expression)
        {
            case LiteralExpressionSyntax when expression.IsKind(SyntaxKind.NullLiteralExpression):
                // `Exclude: null` is an empty list written another way; it becomes a list only when it has to.
                return wanted.Count == 0
                    ? expression
                    : SyntaxFactory.ParseExpression($"[{string.Join(", ", wanted.Select(id => DslWriter.Literal(id).ToString()))}]").WithTriviaFrom(expression);
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
                    $"This view's {what} is not written as an array or a collection of strings, so it cannot be edited in place.");
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
        static string List(IEnumerable<string> items) => $"[{string.Join(", ", items.Select(id => DslWriter.Literal(id).ToString()))}]";

        // The scope and rules only when they are set, and the members unless the view is made of those
        // alone: a rule-based view does not need an empty list to say it has no listed members.
        var arguments = new List<string>
        {
            $"Id: {DslWriter.Literal(view.Id)}",
            $"Name: {DslWriter.Literal(view.Name)}",
            $"BaseView: {DslWriter.Literal(view.BaseView)}",
        };
        if (view.ElementIds.Count > 0 || (string.IsNullOrEmpty(view.Scope) && view.Include is not { Count: > 0 }))
            arguments.Add($"ElementIds: {List(view.ElementIds)}");
        if (!string.IsNullOrEmpty(view.Scope)) arguments.Add($"Scope: {DslWriter.Literal(view.Scope)}");
        if (view.Include is { Count: > 0 }) arguments.Add($"Include: {List(view.Include)}");
        if (view.Exclude is { Count: > 0 }) arguments.Add($"Exclude: {List(view.Exclude)}");

        return $$"""
            using Stemma.Model;

            namespace {{namespaceName}};

            public static class {{className}}
            {
                public static View Define() => new(
                    {{string.Join(",\n        ", arguments)}});
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
