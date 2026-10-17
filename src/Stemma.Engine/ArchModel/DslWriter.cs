using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.CSharp;
using Microsoft.CodeAnalysis.CSharp.Syntax;

namespace Stemma.Engine.ArchModel;

/// <summary>An edit the writer will not make, and the reason the engine reports for it.</summary>
public sealed class DslEditRefusedException(string reason, string message) : InvalidOperationException(message)
{
    public string Reason { get; } = reason;
}

/// <summary>
/// Builds Roslyn syntax-tree edits that add, remove, or mutate Architecture.Build() locals.
/// Each call returns a new SyntaxNode root suitable for Document.WithSyntaxRoot(...).
///
/// The rule every method here keeps is the fidelity contract (engine-backend.md): change the
/// smallest node that carries the change, and nothing around it. Setting an attribute replaces one
/// argument's literal, not the declaration it sits in; removing a declaration removes its lines, not
/// the comments above them; new code takes its indentation and line ending from the line it is
/// placed next to, so a tab-indented CRLF file stays one. A declaration is never rebuilt from the
/// model: the model is a summary of the file, and a rebuild can only write the summary back.
/// </summary>
public static class DslWriter
{
    // ── Adding ──────────────────────────────────────────────────────────────────────────────

    public static SyntaxNode AddElement(SyntaxNode root, ArchElement element) =>
        AddDeclaration(root, BuildLocalForElement(element), VarNameFor(element.Id));

    public static SyntaxNode AddLink(SyntaxNode root, ArchLink link) =>
        AddDeclaration(root, BuildLocalForLink(link), VarNameFor(link.Id));

    private static SyntaxNode AddDeclaration(SyntaxNode root, StatementSyntax stmt, string varName)
    {
        var build = BuildBody(root);
        var ret = build.Statements.OfType<ReturnStatementSyntax>().FirstOrDefault();
        var index = ret is null ? build.Statements.Count : build.Statements.IndexOf(ret);
        return AddToReturn(root.ReplaceNode(build, InsertStatement(build, index, stmt)), varName);
    }

    // ── Removing ────────────────────────────────────────────────────────────────────────────

    /// <summary>
    /// Remove an element's or link's declaration, every <c>Tag.For</c> naming its variable, and its
    /// entry in <c>Model.Of(...)</c> — the three places it is written, and the least that leaves the
    /// file compiling. Links and views that name it by id are references, not code that depends on
    /// it, and are left in place: the UI tells the user they are detached, and <c>stemma validate</c>
    /// reports them.
    /// </summary>
    public static SyntaxNode RemoveDeclaration(SyntaxNode root, string id)
    {
        var declaration = FindDeclaration(root, id) ?? throw new InvalidOperationException($"No declaration with id {id}");
        var varName = declaration.Variable.Identifier.Text;
        while (FindTag(root, varName) is { } tag) root = RemoveStatement(root, tag);
        root = RemoveStatement(root, FindDeclaration(root, id)!.Value.Statement);
        return RemoveFromReturn(root, varName);
    }

    // ── Editing one attribute ───────────────────────────────────────────────────────────────

    /// <summary>
    /// Set, or clear when <paramref name="value"/> is null, one constructor argument of a
    /// declaration — <c>contextId</c> on a Module, <c>payload</c> on a DataFlow. Only that
    /// argument's literal changes; an argument that is added is written the way the call already
    /// writes its arguments, positionally or by name.
    /// </summary>
    public static SyntaxNode SetAttribute(SyntaxNode root, string id, string attribute, string? value)
    {
        var (stmt, _, creation) = FindDeclaration(root, id) ?? throw new InvalidOperationException($"No declaration with id {id}");
        var typeName = DslReader.ExtractTypeName(creation, stmt.Declaration.Type) ?? "";
        var parameters = DslVocabulary.ParametersOf(typeName);
        if (parameters is null || attribute is "id" or "name" || !parameters.Contains(attribute))
            throw new DslEditRefusedException("UnknownAttribute", $"A {typeName} has no attribute '{attribute}' that can be set.");

        var edited = SetArgument(creation.ArgumentList!, parameters, attribute, value, typeName, nullablePlaceholder: false);
        return edited is null ? root : root.ReplaceNode(creation.ArgumentList!, edited);
    }

    /// <summary>
    /// The argument list with one argument set, cleared or added; null when that changes nothing.
    /// A positional argument that later positional arguments depend on cannot simply be removed:
    /// where every parameter is nullable (a Lifecycle, an Ownership) it becomes <c>null</c>, and
    /// elsewhere the edit is refused, because the parameter is required.
    /// </summary>
    internal static ArgumentListSyntax? SetArgument(
        ArgumentListSyntax list, IReadOnlyList<string> parameters, string attribute, string? value, string typeName, bool nullablePlaceholder)
    {
        var args = list.Arguments;
        var at = -1;
        for (var i = 0; i < args.Count && at < 0; i++)
        {
            var key = args[i].NameColon is { } nc
                ? DslVocabulary.AttributeName(nc.Name.Identifier.Text)
                : i < parameters.Count ? parameters[i] : null;
            if (key == attribute) at = i;
        }

        if (at >= 0)
        {
            var arg = args[at];
            if (value is not null)
            {
                if (arg.Expression is LiteralExpressionSyntax lit && lit.IsKind(SyntaxKind.StringLiteralExpression) && lit.Token.ValueText == value)
                    return null;
                return list.WithArguments(args.Replace(arg, arg.WithExpression(Literal(value).WithTriviaFrom(arg.Expression))));
            }

            if (arg.NameColon is null && args.Skip(at + 1).Any(a => a.NameColon is null))
            {
                if (!nullablePlaceholder)
                    throw new DslEditRefusedException("AttributeRequired",
                        $"'{attribute}' cannot be cleared on a {typeName}: the arguments after it are positional and depend on it.");
                if (arg.Expression.IsKind(SyntaxKind.NullLiteralExpression)) return null;
                var nullLiteral = SyntaxFactory.LiteralExpression(SyntaxKind.NullLiteralExpression).WithTriviaFrom(arg.Expression);
                return list.WithArguments(args.Replace(arg, arg.WithExpression(nullLiteral)));
            }
            var (open, rest) = SeparatedEdits.RemoveAt(list.OpenParenToken, args, at);
            return list.WithOpenParenToken(open).WithArguments(rest);
        }

        if (value is null) return null;
        var positional = args.All(a => a.NameColon is null) && args.Count == IndexOf(parameters, attribute);
        var added = positional
            ? SyntaxFactory.Argument(Literal(value))
            : NamedArgument(DslVocabulary.ParameterName(attribute), Literal(value));
        return list.WithArguments(SeparatedEdits.Append(args, added));
    }

    // ── Renaming ────────────────────────────────────────────────────────────────────────────

    public static SyntaxNode RenameElement(SyntaxNode root, string id, string newName, bool renameVariable = true)
    {
        if (FindDeclaration(root, id) is not { } found) return root;
        var (stmt, variable, creation) = found;
        var args = creation.ArgumentList!.Arguments;
        var nameAt = -1;
        for (var i = 0; i < args.Count && nameAt < 0; i++)
        {
            var key = args[i].NameColon is { } nc ? DslVocabulary.AttributeName(nc.Name.Identifier.Text) : i == 1 ? "name" : null;
            if (key == "name") nameAt = i;
        }
        if (nameAt < 0) return root;

        var nameExpression = args[nameAt].Expression;
        var renamed = creation.ReplaceNode(nameExpression, Literal(newName).WithTriviaFrom(nameExpression));

        // The variable follows the name, so the C# keeps reading like the diagram — unless the new
        // name's variable is already taken, in which case the old one is kept rather than colliding.
        var typeName = DslReader.ExtractTypeName(creation, stmt.Declaration.Type);
        var oldVar = variable.Identifier.Text;
        var newVar = renameVariable && typeName is not null ? VarNameFromElementName(typeName, newName) : oldVar;
        var build = BuildBody(root);
        if (newVar == oldVar || IsDeclared(build, newVar))
            return root.ReplaceNode(creation, renamed);

        var declarator = variable.ReplaceNode(creation, renamed)
            .WithIdentifier(SyntaxFactory.Identifier(variable.Identifier.LeadingTrivia, newVar, variable.Identifier.TrailingTrivia));
        root = root.ReplaceNode(variable, declarator);
        // Then every use of the old variable inside Build(): its tag and its Model.Of entry. Only
        // identifier names are visited, so the declarator just renamed is not touched twice.
        build = BuildBody(root);
        return root.ReplaceNode(build, new IdentifierRewriter(oldVar, newVar).Visit(build) ?? build);
    }

    private static bool IsDeclared(BlockSyntax build, string name) =>
        build.DescendantNodes().OfType<VariableDeclaratorSyntax>().Any(v => v.Identifier.Text == name);

    // ── Tags ────────────────────────────────────────────────────────────────────────────────

    /// <summary>
    /// Set the fields of one part of a tag — <c>lifecycle</c> or <c>ownership</c> — on the element
    /// or link declared with <paramref name="targetId"/>. Each field is an argument of
    /// <c>new Lifecycle(...)</c> / <c>new Ownership(...)</c> and is edited where it stands; fields
    /// not passed (an Ownership's RAPID roles) are not touched. A part left with no arguments goes,
    /// and a tag left with no parts goes with it. A missing tag is inserted after the declaration.
    /// </summary>
    public static SyntaxNode SetTag(SyntaxNode root, string targetId, string part, IReadOnlyList<(string Field, string? Value)> fields)
    {
        var typeName = DslVocabulary.ParameterName(part);
        var parameters = DslVocabulary.ParametersOf(typeName) ?? throw new ArgumentException($"Not a tag part: {part}", nameof(part));
        var (decl, variable, _) = FindDeclaration(root, targetId) ?? throw new InvalidOperationException($"No declaration with id {targetId}");
        var varName = variable.Identifier.Text;
        var nothing = fields.All(f => f.Value is null);

        if (FindTag(root, varName) is not { } tag)
        {
            if (nothing) return root;
            var build = (BlockSyntax)decl.Parent!;
            var stmt = SyntaxFactory.ParseStatement($"Tag.For({varName}, {part}: {NewTagPart(typeName, fields)});");
            return root.ReplaceNode(build, InsertStatement(build, build.Statements.IndexOf(decl) + 1, stmt, lineLike: decl));
        }

        var invocation = (InvocationExpressionSyntax)tag.Expression;
        var args = invocation.ArgumentList.Arguments;
        var at = IndexOfTagPart(args, part);
        if (at < 0)
        {
            if (nothing) return root;
            var arg = NamedArgument(part, SyntaxFactory.ParseExpression(NewTagPart(typeName, fields)));
            // Lifecycle before ownership: the order Tag.For declares them in.
            var ownershipAt = part == "lifecycle" ? IndexOfTagPart(args, "ownership") : -1;
            var list = ownershipAt > 0 ? SeparatedEdits.Insert(args, ownershipAt, arg) : SeparatedEdits.Append(args, arg);
            return root.ReplaceNode(invocation.ArgumentList, invocation.ArgumentList.WithArguments(list));
        }

        if (args[at].Expression is not BaseObjectCreationExpressionSyntax { ArgumentList: { } partArgs })
            throw new DslEditRefusedException("UnreadableTag",
                $"The {part} of {targetId} is not written as new {typeName}(...), so it cannot be edited in place.");
        var edited = partArgs;
        foreach (var (field, value) in fields)
            edited = SetArgument(edited, parameters, field, value, typeName, nullablePlaceholder: true) ?? edited;
        if (ReferenceEquals(edited, partArgs)) return root;
        if (edited.Arguments.Count > 0) return root.ReplaceNode(partArgs, edited);

        // Nothing left in this part: it goes, and a tag with no other part goes with it.
        if (args.Count <= 2) return RemoveStatement(root, tag);
        var (open, rest) = SeparatedEdits.RemoveAt(invocation.ArgumentList.OpenParenToken, args, at);
        return root.ReplaceNode(invocation.ArgumentList, invocation.ArgumentList.WithOpenParenToken(open).WithArguments(rest));
    }

    private static int IndexOfTagPart(SeparatedSyntaxList<ArgumentSyntax> args, string part)
    {
        for (var i = 1; i < args.Count; i++)
            if (DslReader.TagPartOf(args[i]) == part) return i;
        return -1;
    }

    private static string NewTagPart(string typeName, IReadOnlyList<(string Field, string? Value)> fields) =>
        $"new {typeName}({string.Join(", ", fields.Where(f => f.Value is not null).Select(f => $"{DslVocabulary.ParameterName(f.Field)}: {Literal(f.Value!)}"))})";

    // ── Finding things ──────────────────────────────────────────────────────────────────────

    private static BlockSyntax BuildBody(SyntaxNode root) =>
        DslReader.FindBuildMethodBody(root) ?? throw new InvalidOperationException("Architecture.Build() body not found");

    private static (LocalDeclarationStatementSyntax Statement, VariableDeclaratorSyntax Variable, BaseObjectCreationExpressionSyntax Creation)?
        FindDeclaration(SyntaxNode root, string id)
    {
        var build = DslReader.FindBuildMethodBody(root);
        if (build is null) return null;
        foreach (var stmt in build.Statements.OfType<LocalDeclarationStatementSyntax>())
            foreach (var v in stmt.Declaration.Variables)
                if (v.Initializer?.Value is BaseObjectCreationExpressionSyntax { ArgumentList: not null } oc && DeclaredId(oc) == id)
                    return (stmt, v, oc);
        return null;
    }

    /// <summary>The id a declaration declares: its first argument, or the one named <c>Id</c>.</summary>
    private static string? DeclaredId(BaseObjectCreationExpressionSyntax oc)
    {
        var args = DslReader.ExtractArgs(oc);
        for (var i = 0; i < args.Count; i++)
            if ((args[i].Name ?? (i == 0 ? "id" : null)) == "id") return args[i].Value;
        return null;
    }

    private static ExpressionStatementSyntax? FindTag(SyntaxNode root, string varName) =>
        DslReader.FindBuildMethodBody(root)?.Statements.OfType<ExpressionStatementSyntax>()
            .FirstOrDefault(s => s.Expression is InvocationExpressionSyntax
            {
                Expression: MemberAccessExpressionSyntax { Name.Identifier.Text: "For", Expression: IdentifierNameSyntax { Identifier.Text: "Tag" } },
                ArgumentList.Arguments: [{ Expression: IdentifierNameSyntax target }, ..],
            } && target.Identifier.Text == varName);

    private static InvocationExpressionSyntax? FindModelOf(SyntaxNode root) =>
        DslReader.FindBuildMethodBody(root)?.Statements.OfType<ReturnStatementSyntax>().FirstOrDefault()?.Expression as InvocationExpressionSyntax;

    // ── Statements ──────────────────────────────────────────────────────────────────────────

    /// <summary>
    /// Insert <paramref name="stmt"/> at <paramref name="index"/>, indented like the statement it goes
    /// before (or <paramref name="lineLike"/>) and ended with the line ending of the line above it.
    /// </summary>
    private static BlockSyntax InsertStatement(BlockSyntax body, int index, StatementSyntax stmt, StatementSyntax? lineLike = null)
    {
        var model = lineLike ?? (index < body.Statements.Count ? body.Statements[index] : body.Statements.LastOrDefault());
        var indent = model is null ? SyntaxTriviaList.Empty : Trivia.Indentation(model.GetLeadingTrivia());
        var placed = stmt.WithLeadingTrivia(indent).WithTrailingTrivia(LineEndingBefore(body, index));
        return body.WithStatements(body.Statements.Insert(index, placed));
    }

    private static SyntaxTrivia LineEndingBefore(BlockSyntax body, int index)
    {
        var above = index > 0 ? body.Statements[index - 1].GetTrailingTrivia() : body.OpenBraceToken.TrailingTrivia;
        var eol = above.LastOrDefault(t => t.IsKind(SyntaxKind.EndOfLineTrivia));
        if (eol.IsKind(SyntaxKind.EndOfLineTrivia)) return eol;
        // The line above ends some other way (a directive, the end of the file): use the file's own.
        var any = body.DescendantTrivia(descendIntoTrivia: true).FirstOrDefault(t => t.IsKind(SyntaxKind.EndOfLineTrivia));
        return any.IsKind(SyntaxKind.EndOfLineTrivia) ? any : SyntaxFactory.EndOfLine("\n");
    }

    /// <summary>
    /// Remove a statement and its own line — its indentation, a comment on the same line, its line
    /// ending — and none of the comments or directives above it, which move to the next line
    /// (<see cref="Trivia.KeptAbove"/> says why).
    /// </summary>
    private static SyntaxNode RemoveStatement(SyntaxNode root, StatementSyntax stmt)
    {
        var body = (BlockSyntax)stmt.Parent!;
        var index = body.Statements.IndexOf(stmt);
        var above = Trivia.KeptAbove(stmt.GetLeadingTrivia(), beforeClosing: index == body.Statements.Count - 1);
        var statements = body.Statements.RemoveAt(index);
        BlockSyntax edited;
        if (index < statements.Count)
        {
            var next = statements[index];
            edited = body.WithStatements(statements.Replace(next, next.WithLeadingTrivia(above.AddRange(next.GetLeadingTrivia()))));
        }
        else
        {
            edited = body.WithStatements(statements)
                .WithCloseBraceToken(body.CloseBraceToken.WithLeadingTrivia(above.AddRange(body.CloseBraceToken.LeadingTrivia)));
        }
        return root.ReplaceNode(body, edited);
    }

    // ── Model.Of(...) ───────────────────────────────────────────────────────────────────────

    private static SyntaxNode AddToReturn(SyntaxNode root, string varName)
    {
        if (FindModelOf(root) is not { } inv) return root;
        var arg = SyntaxFactory.Argument(SyntaxFactory.IdentifierName(varName));
        return root.ReplaceNode(inv.ArgumentList, inv.ArgumentList.WithArguments(SeparatedEdits.Append(inv.ArgumentList.Arguments, arg)));
    }

    private static SyntaxNode RemoveFromReturn(SyntaxNode root, string varName)
    {
        if (FindModelOf(root) is not { } inv) return root;
        var args = inv.ArgumentList.Arguments;
        var at = -1;
        for (var i = 0; i < args.Count && at < 0; i++)
            if (args[i].Expression is IdentifierNameSyntax id && id.Identifier.Text == varName) at = i;
        if (at < 0) return root;
        var (open, rest) = SeparatedEdits.RemoveAt(inv.ArgumentList.OpenParenToken, args, at);
        return root.ReplaceNode(inv.ArgumentList, inv.ArgumentList.WithOpenParenToken(open).WithArguments(rest));
    }

    // ── New code ────────────────────────────────────────────────────────────────────────────

    private static StatementSyntax BuildLocalForElement(ArchElement e)
    {
        var args = new List<string> { Literal(e.Id).ToString(), Literal(e.Name).ToString() };
        foreach (var attribute in DslVocabulary.ParametersOf(e.Kind.ToString())?.Skip(2) ?? [])
        {
            // Positional, so the first attribute the element lacks ends the list.
            if (!e.Attributes.TryGetValue(attribute, out var value) || value is null) break;
            args.Add(Literal(value).ToString());
        }
        return LocalDeclaration(VarNameFor(e.Id), e.Kind.ToString(), args);
    }

    private static StatementSyntax BuildLocalForLink(ArchLink l)
    {
        var args = new List<string> { Literal(l.Id).ToString(), Literal(l.FromId).ToString(), Literal(l.ToId).ToString() };
        foreach (var attribute in DslVocabulary.ParametersOf(l.Kind.ToString())?.Skip(3) ?? [])
        {
            if (!l.Attributes.TryGetValue(attribute, out var value) || value is null) break;
            args.Add(Literal(value).ToString());
        }
        return LocalDeclaration(VarNameFor(l.Id), l.Kind.ToString(), args);
    }

    /// <summary>A new declaration with no trivia of its own; it is laid out where it is inserted.</summary>
    private static StatementSyntax LocalDeclaration(string varName, string typeName, IEnumerable<string> args) =>
        SyntaxFactory.ParseStatement($"var {varName} = new {typeName}({string.Join(", ", args)});");

    internal static LiteralExpressionSyntax Literal(string value) =>
        SyntaxFactory.LiteralExpression(SyntaxKind.StringLiteralExpression, SyntaxFactory.Literal(value));

    internal static ArgumentSyntax NamedArgument(string name, ExpressionSyntax value) =>
        SyntaxFactory.Argument(
            SyntaxFactory.NameColon(SyntaxFactory.IdentifierName(name))
                .WithColonToken(SyntaxFactory.Token(SyntaxKind.ColonToken).WithTrailingTrivia(SyntaxFactory.Space)),
            default,
            value);

    private static int IndexOf(IReadOnlyList<string> list, string value)
    {
        for (var i = 0; i < list.Count; i++)
            if (list[i] == value) return i;
        return -1;
    }

    private static string VarNameFromElementName(string typeName, string elementName)
    {
        var prefix = typeName switch
        {
            "Module" => "mod",
            "BoundedContext" => "ctx",
            "SoftwareSystem" => "sys",
            "Container" => "cnt",
            "Person" => "per",
            "UseCase" => "uc",
            "Capability" => "cap",
            "Question" => "q",
            "Assumption" => "asm",
            "Risk" => "risk",
            "Concept" => "con",
            _ => "v"
        };
        var sanitized = new System.Text.StringBuilder();
        var capNext = true;
        foreach (var ch in elementName)
        {
            if (char.IsLetterOrDigit(ch))
            {
                sanitized.Append(capNext ? char.ToUpperInvariant(ch) : ch);
                capNext = false;
            }
            else { capNext = true; }
        }
        return prefix + (sanitized.Length > 0 ? sanitized.ToString() : "Item");
    }

    private sealed class IdentifierRewriter : CSharpSyntaxRewriter
    {
        private readonly string _from;
        private readonly string _to;
        public IdentifierRewriter(string from, string to) { _from = from; _to = to; }
        public override SyntaxNode? VisitIdentifierName(IdentifierNameSyntax node)
            => node.Identifier.Text == _from
                ? node.WithIdentifier(SyntaxFactory.Identifier(node.Identifier.LeadingTrivia, _to, node.Identifier.TrailingTrivia))
                : base.VisitIdentifierName(node);
    }

    public static string VarNameFor(string id)
    {
        // Convert "mod_buyer_onboarding" → "modBuyerOnboarding"
        var parts = id.Split('_', StringSplitOptions.RemoveEmptyEntries);
        if (parts.Length == 0) return "v";
        var sb = new System.Text.StringBuilder(parts[0]);
        for (var i = 1; i < parts.Length; i++)
        {
            sb.Append(char.ToUpperInvariant(parts[i][0]));
            if (parts[i].Length > 1) sb.Append(parts[i][1..]);
        }
        return sb.ToString();
    }
}
