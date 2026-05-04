using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.CSharp;
using Microsoft.CodeAnalysis.CSharp.Syntax;

namespace Verso.Engine.ArchModel;

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
        "Module", "BoundedContext", "SoftwareSystem", "Container", "Person", "UseCase", "Capability"
    };

    private static readonly HashSet<string> LinkTypeNames = new(StringComparer.Ordinal)
    {
        "DataFlow", "Dependency"
    };

    private const string DecisionTypeName = "Decision";
    private const string OptionTypeName = "DecisionOption";

    public static ArchModel? TryRead(string filePath, SyntaxNode root)
    {
        var buildBody = FindBuildMethodBody(root);
        if (buildBody is null) return null;

        var elements = new List<ArchElement>();
        var links = new List<ArchLink>();
        var tags = new List<ArchTag>();
        var decisions = new List<ArchDecision>();
        var options = new List<ArchDecisionOption>();
        var concerns = new List<ArchDecisionConcerns>();
        var supersedes = new List<ArchDecisionSupersedes>();
        var varToId = new Dictionary<string, string>();
        var lastDecisionVar = (string?)null; // for `var opt = new DecisionOption(...)` to attach to recent Decision

        // First pass: locals (elements, links, decisions, options).
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
                    var kind = typeName == "DataFlow" ? ArchLinkKind.DataFlow : ArchLinkKind.Dependency;
                    var (id, fromId, toId, attrs) = ParseLinkArgs(kind, args);
                    if (id is not null && fromId is not null && toId is not null)
                    {
                        links.Add(new ArchLink(id, fromId, toId, kind, attrs));
                        varToId[v.Identifier.Text] = id;
                    }
                }
                else if (typeName == DecisionTypeName)
                {
                    var dec = ParseDecisionArgs(args);
                    if (dec is not null)
                    {
                        decisions.Add(dec);
                        varToId[v.Identifier.Text] = dec.Id;
                        lastDecisionVar = v.Identifier.Text;
                    }
                }
                else if (typeName == OptionTypeName)
                {
                    var opt = ParseOptionArgs(args, fallbackDecisionId: lastDecisionVar is not null && varToId.TryGetValue(lastDecisionVar, out var did) ? did : null);
                    if (opt is not null)
                    {
                        options.Add(opt);
                        varToId[v.Identifier.Text] = opt.Id;
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
                var name = arg.NameColon?.Name.Identifier.Text;
                if (name == "lifecycle" && arg.Expression is BaseObjectCreationExpressionSyntax lcOc)
                    lifecycle = ParseLifecycleFromCreation(lcOc);
                else if (name == "ownership" && arg.Expression is BaseObjectCreationExpressionSyntax owOc)
                    ownership = ParseOwnershipFromCreation(owOc);
            }
            tags.Add(new ArchTag(targetId, lifecycle, ownership));
        }

        // Third pass: Decision.Concerns / Decision.Supersedes invocations.
        foreach (var statement in buildBody.Statements.OfType<ExpressionStatementSyntax>())
        {
            if (statement.Expression is not InvocationExpressionSyntax inv) continue;
            if (inv.Expression is not MemberAccessExpressionSyntax mae) continue;
            if (mae.Expression is not IdentifierNameSyntax recv || recv.Identifier.Text != "Decision") continue;
            var args2 = inv.ArgumentList.Arguments;
            if (args2.Count < 2) continue;

            string? FirstArgVarToId() =>
                args2[0].Expression is IdentifierNameSyntax aId && varToId.TryGetValue(aId.Identifier.Text, out var id) ? id : null;

            if (mae.Name.Identifier.Text == "Concerns")
            {
                var decId = FirstArgVarToId();
                if (decId is null) continue;
                for (var i = 1; i < args2.Count; i++)
                {
                    if (args2[i].Expression is IdentifierNameSyntax e && varToId.TryGetValue(e.Identifier.Text, out var elemId))
                        concerns.Add(new ArchDecisionConcerns(decId, elemId));
                }
            }
            else if (mae.Name.Identifier.Text == "Supersedes")
            {
                var newerId = FirstArgVarToId();
                var olderId = args2[1].Expression is IdentifierNameSyntax o && varToId.TryGetValue(o.Identifier.Text, out var oid) ? oid : null;
                if (newerId is not null && olderId is not null)
                    supersedes.Add(new ArchDecisionSupersedes(newerId, olderId));
            }
        }

        return new ArchModel(filePath, elements, links, tags, decisions, options, concerns, supersedes);
    }

    private static ArchDecision? ParseDecisionArgs(IReadOnlyList<(string? Name, string? Value)> args)
    {
        var positional = new[] { "id", "title", "status", "date", "chosenOptionId" };
        string? id = null, title = null, status = "proposed", date = null, chosen = null;
        for (var i = 0; i < args.Count; i++)
        {
            var key = args[i].Name ?? (i < positional.Length ? positional[i] : $"arg{i}");
            switch (key.ToLowerInvariant())
            {
                case "id": id = args[i].Value; break;
                case "title": title = args[i].Value; break;
                case "status": status = args[i].Value ?? "proposed"; break;
                case "date": date = args[i].Value; break;
                case "chosenoptionid": chosen = args[i].Value; break;
            }
        }
        return (id is not null && title is not null) ? new ArchDecision(id, title, status ?? "proposed", date, chosen) : null;
    }

    private static ArchDecisionOption? ParseOptionArgs(IReadOnlyList<(string? Name, string? Value)> args, string? fallbackDecisionId)
    {
        var positional = new[] { "id", "title", "decisionId" };
        string? id = null, title = null, decId = null;
        for (var i = 0; i < args.Count; i++)
        {
            var key = args[i].Name ?? (i < positional.Length ? positional[i] : $"arg{i}");
            switch (key.ToLowerInvariant())
            {
                case "id": id = args[i].Value; break;
                case "title": title = args[i].Value; break;
                case "decisionid": decId = args[i].Value; break;
            }
        }
        decId ??= fallbackDecisionId;
        return (id is not null && title is not null && decId is not null) ? new ArchDecisionOption(id, title, decId) : null;
    }

    private static ArchLifecycle ParseLifecycleFromCreation(BaseObjectCreationExpressionSyntax oc)
    {
        var args = ExtractArgs(oc);
        var positional = new[] { "Status", "Phase", "ValidFrom", "ValidUntil" };
        string? status = null, phase = null, from = null, until = null;
        for (var i = 0; i < args.Count; i++)
        {
            var key = args[i].Name ?? (i < positional.Length ? positional[i] : $"arg{i}");
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
        string? squad = null, domain = null;
        for (var i = 0; i < args.Count; i++)
        {
            var key = args[i].Name?.ToLowerInvariant();
            if (key == "squad") squad = args[i].Value;
            else if (key == "domain") domain = args[i].Value;
        }
        return new ArchOwnership(squad, domain);
    }

    private static BlockSyntax? FindBuildMethodBody(SyntaxNode root)
    {
        // Multi-file workspaces have additional `static class XxxArchitecture { Build() }` files;
        // we accept any class that exposes a Build method body (the convention is: one class per
        // file, each contributing a partial Model).
        foreach (var cls in root.DescendantNodes().OfType<ClassDeclarationSyntax>())
        {
            var build = cls.Members.OfType<MethodDeclarationSyntax>().FirstOrDefault(m => m.Identifier.Text == "Build");
            if (build?.Body is not null) return build.Body;
        }
        return null;
    }

    private static string? ExtractTypeName(BaseObjectCreationExpressionSyntax oc, TypeSyntax declaredType)
    {
        // var x = new Module(...) — type comes from the constructor expression.
        if (oc is ObjectCreationExpressionSyntax explicitOc)
        {
            return GetSimpleTypeName(explicitOc.Type);
        }
        // Module x = new(...) — type comes from the declaration, but declaration is `var` here.
        return GetSimpleTypeName(declaredType);
    }

    private static string? GetSimpleTypeName(TypeSyntax? type) => type switch
    {
        IdentifierNameSyntax id => id.Identifier.Text,
        QualifiedNameSyntax q => GetSimpleTypeName(q.Right),
        _ => null
    };

    private static IReadOnlyList<(string? Name, string? Value)> ExtractArgs(BaseObjectCreationExpressionSyntax oc)
    {
        var result = new List<(string?, string?)>();
        if (oc.ArgumentList is null) return result;
        foreach (var arg in oc.ArgumentList.Arguments)
        {
            var argName = arg.NameColon?.Name.Identifier.Text;
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
        // Positional defaults by kind.
        var positional = kind switch
        {
            ArchElementKind.Module => new[] { "id", "name", "contextId" },
            ArchElementKind.BoundedContext => new[] { "id", "name" },
            ArchElementKind.SoftwareSystem => new[] { "id", "name" },
            ArchElementKind.Container => new[] { "id", "name", "systemId", "kind" },
            ArchElementKind.Person => new[] { "id", "name", "role" },
            ArchElementKind.UseCase => new[] { "id", "name" },
            ArchElementKind.Capability => new[] { "id", "name", "contextId" },
            _ => new[] { "id", "name" }
        };
        string? id = null;
        string? name = null;
        for (var i = 0; i < args.Count; i++)
        {
            var key = args[i].Name ?? (i < positional.Length ? positional[i] : $"arg{i}");
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
        var positional = kind switch
        {
            ArchLinkKind.DataFlow => new[] { "id", "fromId", "toId", "payload", "direction" },
            ArchLinkKind.Dependency => new[] { "id", "fromId", "toId", "kind" },
            _ => new[] { "id", "fromId", "toId" }
        };
        string? id = null;
        string? from = null;
        string? to = null;
        for (var i = 0; i < args.Count; i++)
        {
            var key = args[i].Name ?? (i < positional.Length ? positional[i] : $"arg{i}");
            var value = args[i].Value;
            if (key == "id") id = value;
            else if (key == "fromId") from = value;
            else if (key == "toId") to = value;
            else attrs[key] = value;
        }
        return (id, from, to, attrs);
    }
}
