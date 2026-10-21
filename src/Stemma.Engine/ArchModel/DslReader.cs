using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.CSharp;
using Microsoft.CodeAnalysis.CSharp.Syntax;

namespace Stemma.Engine.ArchModel;

/// <summary>
/// Parses an Architecture/Architecture.cs file into an ArchModel by walking the
/// `static class Architecture { static Model Build() { ... } }` body.
///
/// Each `var foo = new Module("...", "...", ...)` becomes an ArchElement.
/// Each `var foo = new DataFlow(...)` or `new Dependency(...)` becomes an ArchLink.
/// </summary>
public static class DslReader
{
    private static readonly HashSet<string> ElementTypeNames = new(StringComparer.Ordinal)
    {
        "Module", "BoundedContext", "SoftwareSystem", "Container", "Person", "UseCase", "Capability",
        "Question", "Assumption", "Risk", "Concept"
    };

    private static readonly HashSet<string> LinkTypeNames = new(StringComparer.Ordinal)
    {
        "DataFlow", "Dependency", "Relation"
    };

    /// <param name="semantic">
    /// The file's semantic model, when the caller has a compilation: a constant declared in another
    /// file is then read too. Without one, constants are read from this file alone (<see cref="DslConstants"/>).
    /// </param>
    public static ArchModel? TryRead(string filePath, SyntaxNode root, SemanticModel? semantic = null)
    {
        var buildBody = FindBuildMethodBody(root);
        if (buildBody is null) return null;

        var elements = new List<ArchElement>();
        var links = new List<ArchLink>();
        var tags = new List<ArchTag>();
        var unreadable = new List<ArchReadProblem>();
        var varToId = new Dictionary<string, string>();
        var file = Path.GetFileName(filePath);

        // First pass: locals (elements, links).
        foreach (var statement in buildBody.Statements.OfType<LocalDeclarationStatementSyntax>())
        {
            foreach (var v in statement.Declaration.Variables)
            {
                if (v.Initializer?.Value is not BaseObjectCreationExpressionSyntax oc) continue;
                var typeName = ExtractTypeName(oc, statement.Declaration.Type);
                if (typeName is null) continue;
                var isElement = ElementTypeNames.Contains(typeName);
                if (!isElement && !LinkTypeNames.Contains(typeName)) continue;

                var args = Keyed(ExtractArgs(oc, semantic), DslVocabulary.ParametersOf(typeName)!);
                // An id, or a link's end, that cannot be read leaves nothing to draw or to connect: the
                // declaration is left out, and said to be.
                string[] identity = isElement ? ["id"] : ["id", "fromId", "toId"];
                var unknown = args.Where(a => identity.Contains(a.Key) && !a.Arg.Readable).ToList();
                if (unknown.Count > 0)
                {
                    var line = LineOf(unknown[0].Arg.Expression);
                    unreadable.Add(new ArchReadProblem(filePath, line, null, LeftOut: true,
                        $"{file}:{line}: this {typeName} is not in the model, because its " +
                        $"{string.Join(" and ", unknown.Select(u => $"{u.Key} is written as `{Quote(u.Arg.Expression)}`"))}, " +
                        $"which Stemma cannot read. {Advice}"));
                    continue;
                }

                var id = Value(args, "id");
                if (id is null) continue;
                var attrs = new Dictionary<string, string?>();
                foreach (var (key, arg) in args.Where(a => !identity.Contains(a.Key)))
                {
                    attrs[key] = arg.Value;
                    if (arg.Readable) continue;
                    var line = LineOf(arg.Expression);
                    var consequence = key == "name" ? "so the canvas shows its id instead" : "so it is read as empty";
                    unreadable.Add(new ArchReadProblem(filePath, line, id, LeftOut: false,
                        $"{file}:{line}: the {key} of {id} is written as `{Quote(arg.Expression)}`, " +
                        $"which Stemma cannot read, {consequence}. {Advice}"));
                }

                if (isElement)
                {
                    attrs.Remove("name", out var name);
                    if (args.Any(a => a.Key == "name" && !a.Arg.Readable)) name = id;
                    if (name is null) continue;
                    elements.Add(new ArchElement(id, name, Enum.Parse<ArchElementKind>(typeName), attrs));
                }
                else
                {
                    var kind = typeName switch
                    {
                        "DataFlow" => ArchLinkKind.DataFlow,
                        "Relation" => ArchLinkKind.Relation,
                        _ => ArchLinkKind.Dependency,
                    };
                    var (from, to) = (Value(args, "fromId"), Value(args, "toId"));
                    if (from is null || to is null) continue;
                    links.Add(new ArchLink(id, from, to, kind, attrs));
                }
                varToId[v.Identifier.Text] = id;
            }
        }

        // Second pass: Tag.For(...), as a statement of its own or a local's value.
        var sites = TagsIn(buildBody).ToList();
        foreach (var inv in buildBody.DescendantNodes().OfType<InvocationExpressionSyntax>().Where(IsTagFor).Except(sites.Select(s => s.Invocation)))
        {
            var line = LineOf(inv);
            unreadable.Add(new ArchReadProblem(filePath, line, TargetOf(inv), LeftOut: false,
                $"{file}:{line}: this Tag.For sits inside another expression, where Stemma does not look for tags, so it is " +
                "not read. Write it as a statement of its own, or as a local: var tag = Tag.For(...);"));
        }
        foreach (var inv in sites.Select(s => s.Invocation))
        {
            if (TargetOf(inv) is not { } targetId) continue;

            ArchLifecycle? lifecycle = null;
            ArchOwnership? ownership = null;
            foreach (var arg in inv.ArgumentList.Arguments.Skip(1))
            {
                if (arg.Expression is not BaseObjectCreationExpressionSyntax part) continue;
                switch (TagPartOf(arg))
                {
                    case "lifecycle":
                        var l = ReadTagPart(part, "Lifecycle", targetId);
                        lifecycle = new ArchLifecycle(l.GetValueOrDefault("status"), l.GetValueOrDefault("phase"),
                            l.GetValueOrDefault("validFrom"), l.GetValueOrDefault("validUntil"));
                        break;
                    case "ownership":
                        // Only Squad and Domain are read; the RAPID lists are placeholders. The writer
                        // still accepts and persists them; the reader will be extended in a follow-up pass.
                        var o = ReadTagPart(part, "Ownership", targetId);
                        ownership = new ArchOwnership(o.GetValueOrDefault("squad"), o.GetValueOrDefault("domain"));
                        break;
                }
            }
            tags.Add(new ArchTag(targetId, lifecycle, ownership));
        }

        return new ArchModel(filePath, elements, links, tags) { Unreadable = unreadable };

        string? TargetOf(InvocationExpressionSyntax inv) =>
            inv.ArgumentList.Arguments[0].Expression is IdentifierNameSyntax id && varToId.TryGetValue(id.Identifier.Text, out var resolved)
                ? resolved
                : null;

        // The fields of a Lifecycle or an Ownership by name, and each one Stemma reads but cannot, reported.
        Dictionary<string, string?> ReadTagPart(BaseObjectCreationExpressionSyntax part, string typeName, string targetId)
        {
            var fields = new Dictionary<string, string?>();
            foreach (var (key, arg) in Keyed(ExtractArgs(part, semantic), DslVocabulary.ParametersOf(typeName)!))
            {
                if (!TagFieldsRead.Contains(key)) continue;
                fields[key] = arg.Value;
                if (arg.Readable) continue;
                var line = LineOf(arg.Expression);
                unreadable.Add(new ArchReadProblem(filePath, line, targetId, LeftOut: false,
                    $"{file}:{line}: the {key} in the {typeName.ToLowerInvariant()} of {targetId} is written as " +
                    $"`{Quote(arg.Expression)}`, which Stemma cannot read, so it is read as empty. {Advice}"));
            }
            return fields;
        }
    }

    private const string Advice = "Write it as a string literal, or as a const string declared in this file.";

    /// <summary>The tag fields the model carries. An Ownership's RAPID lists are not read, so not reported.</summary>
    private static readonly HashSet<string> TagFieldsRead = ["status", "phase", "validFrom", "validUntil", "squad", "domain"];

    /// <summary>Each argument with the parameter it is for: its name when it has one, else its position.</summary>
    private static List<(string Key, DslArgument Arg)> Keyed(IReadOnlyList<DslArgument> args, IReadOnlyList<string> positional) =>
        args.Select((a, i) => (a.Name ?? (i < positional.Count ? positional[i] : $"arg{i}"), a)).ToList();

    private static string? Value(List<(string Key, DslArgument Arg)> args, string key) =>
        args.FirstOrDefault(a => a.Key == key).Arg.Value;

    private static int LineOf(SyntaxNode node) => node.GetLocation().GetLineSpan().StartLinePosition.Line + 1;

    /// <summary>The argument as written, on one line and short enough to quote in a sentence.</summary>
    private static string Quote(ExpressionSyntax expression)
    {
        var lines = expression.ToString().Split(['\r', '\n'], StringSplitOptions.RemoveEmptyEntries);
        var text = string.Join(" ", lines.Select(l => l.Trim()));
        return text.Length <= 60 ? text : text[..59] + "…";
    }

    /// <summary>
    /// Every <c>Tag.For(...)</c> in <paramref name="build"/> that is read and can be edited: a statement
    /// of its own, or the value of a local, <c>var tag = Tag.For(...)</c>, which is the way the domain
    /// model writes one. Only the first used to be looked for, so a tag written as the docs show was
    /// never read, and setting a lifecycle added a second tag beside it. The reader and the writer
    /// both find tags here.
    /// </summary>
    internal static IEnumerable<TagSite> TagsIn(BlockSyntax build)
    {
        foreach (var statement in build.Statements)
        {
            switch (statement)
            {
                case ExpressionStatementSyntax { Expression: InvocationExpressionSyntax inv } when IsTagFor(inv):
                    yield return new TagSite(statement, inv, null);
                    break;
                case LocalDeclarationStatementSyntax { Declaration.Variables: [{ Initializer.Value: InvocationExpressionSyntax inv } local] } when IsTagFor(inv):
                    yield return new TagSite(statement, inv, local.Identifier.Text);
                    break;
            }
        }
    }

    private static bool IsTagFor(InvocationExpressionSyntax inv) => inv is
    {
        Expression: MemberAccessExpressionSyntax { Name.Identifier.Text: "For", Expression: IdentifierNameSyntax { Identifier.Text: "Tag" } },
        ArgumentList.Arguments.Count: > 0,
    };

    /// <summary>
    /// Which part of a tag an argument of <c>Tag.For</c> is: by its name when it has one
    /// (<c>lifecycle: …</c>), otherwise by the type it constructs (<c>new Lifecycle(…)</c>).
    /// </summary>
    internal static string? TagPartOf(ArgumentSyntax arg)
    {
        if (arg.NameColon is { } nc) return nc.Name.Identifier.Text;
        return arg.Expression is ObjectCreationExpressionSyntax { Type: var t } && GetSimpleTypeName(t) is { } typeName
            ? DslVocabulary.AttributeName(typeName)
            : null;
    }

    /// <summary>
    /// The statement in the file that declares this id, exactly as it is written there.
    ///
    /// Read off the tree rather than composed from the model: the point of showing someone the C#
    /// their first click produced is that it is the file's own text. Anything reconstructed could
    /// be right and would still be a claim about the file rather than the file, which is the one
    /// thing this product cannot afford to be casual about.
    /// </summary>
    public static DslDeclaration? FindDeclaration(string filePath, SyntaxNode root, string id)
    {
        var buildBody = FindBuildMethodBody(root);
        if (buildBody is null) return null;

        foreach (var statement in buildBody.Statements.OfType<LocalDeclarationStatementSyntax>())
        {
            foreach (var v in statement.Declaration.Variables)
            {
                if (v.Initializer?.Value is not BaseObjectCreationExpressionSyntax oc) continue;
                var typeName = ExtractTypeName(oc, statement.Declaration.Type);
                if (typeName is null) continue;
                if (!ElementTypeNames.Contains(typeName) && !LinkTypeNames.Contains(typeName)) continue;

                // The id is the first constructor argument for every kind in the vocabulary, and is
                // also nameable, so ask the parsed arguments rather than the first literal.
                var args = ExtractArgs(oc);
                var declaredId = args.Select((a, i) => (Key: a.Name ?? (i == 0 ? "id" : $"arg{i}"), a.Value))
                    .FirstOrDefault(a => a.Key == "id").Value;
                if (declaredId != id) continue;

                // Leading trivia excluded: a doc comment or a blank line above belongs to the file,
                // not to this declaration, and including it makes the snippet start with whitespace.
                var line = statement.GetLocation().GetLineSpan().StartLinePosition.Line + 1;
                return new DslDeclaration(id, filePath, line, statement.ToString());
            }
        }
        return null;
    }

    /// <summary>
    /// The body of the file's <c>static Model Build()</c>: the one in the class named
    /// <c>Architecture</c> when there is one, otherwise the first. The reader and the writer both
    /// find the model here, so what is read is what is edited.
    ///
    /// Multi-file workspaces have further <c>static class XxxArchitecture { static Model Build() }</c>
    /// files, each contributing part of the model. Any method called Build used to do: a helper
    /// declared above the model was read as the model, and an edit would have been written into its
    /// body.
    /// </summary>
    internal static BlockSyntax? FindBuildMethodBody(SyntaxNode root)
    {
        BlockSyntax? first = null;
        foreach (var cls in root.DescendantNodes().OfType<ClassDeclarationSyntax>())
        {
            var build = cls.Members.OfType<MethodDeclarationSyntax>().FirstOrDefault(IsModelBuilder);
            if (build?.Body is null) continue;
            if (cls.Identifier.Text == "Architecture") return build.Body;
            first ??= build.Body;
        }
        return first;
    }

    private static bool IsModelBuilder(MethodDeclarationSyntax method) =>
        method.Identifier.Text == "Build"
        && method.ParameterList.Parameters.Count == 0
        && method.Modifiers.Any(SyntaxKind.StaticKeyword)
        && GetSimpleTypeName(method.ReturnType) == "Model";

    internal static string? ExtractTypeName(BaseObjectCreationExpressionSyntax oc, TypeSyntax declaredType)
    {
        // var x = new Module(...) — type comes from the constructor expression.
        if (oc is ObjectCreationExpressionSyntax explicitOc)
        {
            return GetSimpleTypeName(explicitOc.Type);
        }
        // Module x = new(...) — type comes from the declaration, but declaration is `var` here.
        return GetSimpleTypeName(declaredType);
    }

    internal static string? GetSimpleTypeName(TypeSyntax? type) => type switch
    {
        IdentifierNameSyntax id => id.Identifier.Text,
        QualifiedNameSyntax q => GetSimpleTypeName(q.Right),
        _ => null
    };

    /// <summary>
    /// The constructor's arguments, each with its name if it has one and the string it stands for
    /// (<see cref="DslConstants"/>); <see cref="DslArgument.Readable"/> is false when that cannot be known.
    /// </summary>
    internal static IReadOnlyList<DslArgument> ExtractArgs(BaseObjectCreationExpressionSyntax oc, SemanticModel? semantic = null)
    {
        var result = new List<DslArgument>();
        if (oc.ArgumentList is null) return result;
        foreach (var arg in oc.ArgumentList.Arguments)
        {
            // `Id:` and `id` are the same argument. Compared as written, every named-argument
            // declaration was invisible to the reader, so there was nothing for an edit to find.
            var argName = arg.NameColon is { } nc ? DslVocabulary.AttributeName(nc.Name.Identifier.Text) : null;
            var readable = DslConstants.TryRead(arg.Expression, semantic, out var value);
            result.Add(new DslArgument(argName, value, readable, arg.Expression));
        }
        return result;
    }

    /// <summary>
    /// Whether an edit setting <paramref name="expression"/> to <paramref name="value"/> would change
    /// nothing. A literal that says something else is the edit's to replace. An argument written any
    /// other way — a constant, a concatenation, <c>nameof</c> — is the author's choice, and replacing it
    /// with the literal it stands for would undo that choice, so unless it already says
    /// <paramref name="value"/> the edit is refused.
    /// </summary>
    internal static bool AlreadySays(ExpressionSyntax expression, string? value, string what)
    {
        var says = DslConstants.TryRead(expression, null, out var current) && current == value;
        if (says || DslConstants.IsLiteral(expression)) return says;
        throw NotALiteral(expression, what);
    }

    /// <summary>Refuse to remove an argument that is not written as a literal, for the same reason.</summary>
    internal static void RefuseUnlessLiteral(ExpressionSyntax expression, string what)
    {
        if (!DslConstants.IsLiteral(expression)) throw NotALiteral(expression, what);
    }

    private static DslEditRefusedException NotALiteral(ExpressionSyntax expression, string what) =>
        new("NotALiteral", $"The {what} is written as `{Quote(expression)}` rather than as a literal, so Stemma does not change it. Edit it in the code.");
}

/// <summary>
/// A <c>Tag.For(...)</c> where Stemma reads and edits one: <paramref name="Statement"/> is the statement
/// it is, or the local declaration whose value it is, and <paramref name="Variable"/> that local's name.
/// </summary>
internal sealed record TagSite(StatementSyntax Statement, InvocationExpressionSyntax Invocation, string? Variable);

/// <summary>An argument of a declaration: its name if it has one, and the string it stands for when that can be read.</summary>
internal readonly record struct DslArgument(string? Name, string? Value, bool Readable, ExpressionSyntax Expression);
