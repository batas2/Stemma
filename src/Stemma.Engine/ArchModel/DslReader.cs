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

    public static ArchModel? TryRead(string filePath, SyntaxNode root)
    {
        var buildBody = FindBuildMethodBody(root);
        if (buildBody is null) return null;

        var elements = new List<ArchElement>();
        var links = new List<ArchLink>();
        var tags = new List<ArchTag>();
        var varToId = new Dictionary<string, string>();

        // First pass: locals (elements, links).
        foreach (var statement in buildBody.Statements.OfType<LocalDeclarationStatementSyntax>())
        {
            foreach (var v in statement.Declaration.Variables)
            {
                if (v.Initializer?.Value is not BaseObjectCreationExpressionSyntax oc) continue;
                var typeName = ExtractTypeName(oc, statement.Declaration.Type);
                if (typeName is null) continue;
                var args = ExtractArgs(oc);

                if (ElementTypeNames.Contains(typeName))
                {
                    var kind = (ArchElementKind)Enum.Parse(typeof(ArchElementKind), typeName);
                    var (id, name, attrs) = ParseElementArgs(kind, args);
                    if (id is not null && name is not null)
                    {
                        elements.Add(new ArchElement(id, name, kind, attrs));
                        varToId[v.Identifier.Text] = id;
                    }
                }
                else if (LinkTypeNames.Contains(typeName))
                {
                    var kind = typeName switch
                    {
                        "DataFlow" => ArchLinkKind.DataFlow,
                        "Relation" => ArchLinkKind.Relation,
                        _ => ArchLinkKind.Dependency,
                    };
                    var (id, fromId, toId, attrs) = ParseLinkArgs(kind, args);
                    if (id is not null && fromId is not null && toId is not null)
                    {
                        links.Add(new ArchLink(id, fromId, toId, kind, attrs));
                        varToId[v.Identifier.Text] = id;
                    }
                }
            }
        }

        // Second pass: Tag.For(...) statements.
        foreach (var statement in buildBody.Statements.OfType<ExpressionStatementSyntax>())
        {
            if (statement.Expression is not InvocationExpressionSyntax inv) continue;
            if (inv.Expression is not MemberAccessExpressionSyntax mae) continue;
            if (mae.Name.Identifier.Text != "For") continue;
            if (mae.Expression is not IdentifierNameSyntax tagId || tagId.Identifier.Text != "Tag") continue;
            if (inv.ArgumentList.Arguments.Count == 0) continue;

            var firstArg = inv.ArgumentList.Arguments[0].Expression;
            string? targetId = firstArg switch
            {
                IdentifierNameSyntax id when varToId.TryGetValue(id.Identifier.Text, out var resolved) => resolved,
                _ => null
            };
            if (targetId is null) continue;

            ArchLifecycle? lifecycle = null;
            ArchOwnership? ownership = null;
            foreach (var arg in inv.ArgumentList.Arguments.Skip(1))
            {
                if (arg.Expression is not BaseObjectCreationExpressionSyntax part) continue;
                switch (TagPartOf(arg))
                {
                    case "lifecycle": lifecycle = ParseLifecycleFromCreation(part); break;
                    case "ownership": ownership = ParseOwnershipFromCreation(part); break;
                }
            }
            tags.Add(new ArchTag(targetId, lifecycle, ownership));
        }

        return new ArchModel(filePath, elements, links, tags);
    }

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

    private static ArchLifecycle ParseLifecycleFromCreation(BaseObjectCreationExpressionSyntax oc)
    {
        var args = ExtractArgs(oc);
        var positional = DslVocabulary.ParametersOf("Lifecycle")!;
        string? status = null, phase = null, from = null, until = null;
        for (var i = 0; i < args.Count; i++)
        {
            var key = args[i].Name ?? (i < positional.Count ? positional[i] : $"arg{i}");
            switch (key.ToLowerInvariant())
            {
                case "status": status = args[i].Value; break;
                case "phase": phase = args[i].Value; break;
                case "validfrom": from = args[i].Value; break;
                case "validuntil": until = args[i].Value; break;
            }
        }
        return new ArchLifecycle(status, phase, from, until);
    }

    private static ArchOwnership ParseOwnershipFromCreation(BaseObjectCreationExpressionSyntax oc)
    {
        // For Spike 03, only Squad and Domain (single-string properties) are read; RAPID lists
        // are placeholders. The DSL writer below still accepts and persists them; the reader will
        // be extended in a follow-up pass.
        var args = ExtractArgs(oc);
        var positional = DslVocabulary.ParametersOf("Ownership")!;
        string? squad = null, domain = null;
        for (var i = 0; i < args.Count; i++)
        {
            var key = args[i].Name ?? (i < positional.Count ? positional[i] : null);
            if (key == "squad") squad = args[i].Value;
            else if (key == "domain") domain = args[i].Value;
        }
        return new ArchOwnership(squad, domain);
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

    internal static IReadOnlyList<(string? Name, string? Value)> ExtractArgs(BaseObjectCreationExpressionSyntax oc)
    {
        var result = new List<(string?, string?)>();
        if (oc.ArgumentList is null) return result;
        foreach (var arg in oc.ArgumentList.Arguments)
        {
            // `Id:` and `id` are the same argument. Compared as written, every named-argument
            // declaration was invisible to the reader, so there was nothing for an edit to find.
            var argName = arg.NameColon is { } nc ? DslVocabulary.AttributeName(nc.Name.Identifier.Text) : null;
            var literal = ResolveStringValue(arg.Expression);
            result.Add((argName, literal));
        }
        return result;
    }

    private static string? ResolveStringValue(ExpressionSyntax expr) => expr switch
    {
        LiteralExpressionSyntax lit when lit.Token.IsKind(SyntaxKind.StringLiteralToken)
            => lit.Token.ValueText,
        LiteralExpressionSyntax lit when lit.Token.IsKind(SyntaxKind.NullKeyword)
            => null,
        _ => null
    };

    private static (string? id, string? name, IReadOnlyDictionary<string, string?> attrs) ParseElementArgs(
        ArchElementKind kind, IReadOnlyList<(string? Name, string? Value)> args)
    {
        var attrs = new Dictionary<string, string?>();
        var positional = DslVocabulary.ParametersOf(kind.ToString()) ?? ["id", "name"];
        string? id = null;
        string? name = null;
        for (var i = 0; i < args.Count; i++)
        {
            var key = args[i].Name ?? (i < positional.Count ? positional[i] : $"arg{i}");
            var value = args[i].Value;
            if (key == "id") id = value;
            else if (key == "name") name = value;
            else attrs[key] = value;
        }
        return (id, name, attrs);
    }

    private static (string? id, string? from, string? to, IReadOnlyDictionary<string, string?> attrs) ParseLinkArgs(
        ArchLinkKind kind, IReadOnlyList<(string? Name, string? Value)> args)
    {
        var attrs = new Dictionary<string, string?>();
        var positional = DslVocabulary.ParametersOf(kind.ToString()) ?? ["id", "fromId", "toId"];
        string? id = null;
        string? from = null;
        string? to = null;
        for (var i = 0; i < args.Count; i++)
        {
            var key = args[i].Name ?? (i < positional.Count ? positional[i] : $"arg{i}");
            var value = args[i].Value;
            if (key == "id") id = value;
            else if (key == "fromId") from = value;
            else if (key == "toId") to = value;
            else attrs[key] = value;
        }
        return (id, from, to, attrs);
    }
}
