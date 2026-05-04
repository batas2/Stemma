using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.CSharp;
using Microsoft.CodeAnalysis.CSharp.Syntax;

namespace Verso.Engine.ArchModel;

/// <summary>
/// Builds Roslyn syntax-tree edits that add, remove, or mutate Architecture.Build() locals.
/// Each call returns a new SyntaxNode root suitable for Document.WithSyntaxRoot(...).
/// </summary>
public static class DslWriter
{
    public static SyntaxNode AddElement(SyntaxNode root, ArchElement element)
    {
        var build = FindBuildBody(root) ?? throw new InvalidOperationException("Architecture.Build() body not found");
        var stmt = BuildLocalForElement(element);
        var newBuild = InsertBeforeReturn(build, stmt);
        return AddToReturn(root.ReplaceNode(build, newBuild), VarNameFor(element.Id));
    }

    public static SyntaxNode AddLink(SyntaxNode root, ArchLink link)
    {
        var build = FindBuildBody(root) ?? throw new InvalidOperationException("Architecture.Build() body not found");
        var stmt = BuildLocalForLink(link);
        var newBuild = InsertBeforeReturn(build, stmt);
        return AddToReturn(root.ReplaceNode(build, newBuild), VarNameFor(link.Id));
    }

    public static SyntaxNode RemoveStatementById(SyntaxNode root, string id)
    {
        var build = FindBuildBody(root) ?? throw new InvalidOperationException("Architecture.Build() body not found");
        var stmt = build.Statements.OfType<LocalDeclarationStatementSyntax>()
            .FirstOrDefault(s => s.Declaration.Variables.Any(v =>
                v.Initializer?.Value is BaseObjectCreationExpressionSyntax oc &&
                oc.ArgumentList?.Arguments.Count > 0 &&
                FirstArgIsLiteral(oc, id)));
        if (stmt is null) throw new InvalidOperationException($"No declaration with id {id}");

        var varName = stmt.Declaration.Variables.First().Identifier.Text;
        var newRoot = root.RemoveNode(stmt, SyntaxRemoveOptions.KeepNoTrivia);
        if (newRoot is null) throw new InvalidOperationException("RemoveNode returned null");
        return RemoveFromReturn(newRoot, varName);
    }

    public static SyntaxNode SetLinkAttribute(SyntaxNode root, ArchLink updatedLink)
    {
        var build = FindBuildBody(root) ?? throw new InvalidOperationException("Architecture.Build() body not found");
        foreach (var stmt in build.Statements.OfType<LocalDeclarationStatementSyntax>())
        {
            foreach (var v in stmt.Declaration.Variables)
            {
                if (v.Initializer?.Value is not BaseObjectCreationExpressionSyntax oc) continue;
                if (oc.ArgumentList is null || oc.ArgumentList.Arguments.Count == 0) continue;
                if (!FirstArgIsLiteral(oc, updatedLink.Id)) continue;
                var newStmt = BuildLocalForLink(updatedLink) as LocalDeclarationStatementSyntax;
                if (newStmt is null) return root;
                // Preserve the original variable name.
                var origVarName = v.Identifier.Text;
                var origDeclarator = newStmt.Declaration.Variables.First();
                var renamedDeclarator = origDeclarator.WithIdentifier(SyntaxFactory.Identifier(origVarName));
                var renamed = newStmt.WithDeclaration(newStmt.Declaration.WithVariables(SyntaxFactory.SingletonSeparatedList(renamedDeclarator)));
                return root.ReplaceNode(stmt, renamed);
            }
        }
        return root;
    }

    public static SyntaxNode RenameElement(SyntaxNode root, string id, string newName, bool renameVariable = true)
    {
        var build = FindBuildBody(root) ?? throw new InvalidOperationException("Architecture.Build() body not found");
        LocalDeclarationStatementSyntax? targetStmt = null;
        BaseObjectCreationExpressionSyntax? targetOc = null;
        VariableDeclaratorSyntax? targetVar = null;
        string? typeName = null;
        foreach (var stmt in build.Statements.OfType<LocalDeclarationStatementSyntax>())
        {
            foreach (var v in stmt.Declaration.Variables)
            {
                if (v.Initializer?.Value is not BaseObjectCreationExpressionSyntax oc) continue;
                if (oc.ArgumentList is null || oc.ArgumentList.Arguments.Count < 2) continue;
                if (!FirstArgIsLiteral(oc, id)) continue;
                targetStmt = stmt;
                targetOc = oc;
                targetVar = v;
                typeName = oc is ObjectCreationExpressionSyntax e ? GetSimpleTypeName(e.Type) : null;
                break;
            }
            if (targetOc is not null) break;
        }
        if (targetOc is null || targetVar is null || targetStmt is null) return root;

        var args = targetOc.ArgumentList!.Arguments;
        var nameArgIndex = args[1].NameColon is null
            ? 1
            : args.Select((a, i) => (a, i)).FirstOrDefault(x => x.a.NameColon?.Name.Identifier.Text == "name").i;
        if (nameArgIndex < 0 || nameArgIndex >= args.Count) return root;

        var newLiteral = SyntaxFactory.LiteralExpression(SyntaxKind.StringLiteralExpression, SyntaxFactory.Literal(newName));
        var newNameArg = args[nameArgIndex].WithExpression(newLiteral);
        var newArgs = args.Replace(args[nameArgIndex], newNameArg);
        BaseObjectCreationExpressionSyntax ocWithNewName = targetOc switch
        {
            ObjectCreationExpressionSyntax e => e.WithArgumentList(targetOc.ArgumentList.WithArguments(newArgs)),
            ImplicitObjectCreationExpressionSyntax i => i.WithArgumentList(targetOc.ArgumentList.WithArguments(newArgs)),
            _ => targetOc
        };

        if (!renameVariable || typeName is null)
        {
            return root.ReplaceNode(targetOc, ocWithNewName);
        }

        var newVarName = VarNameFromElementName(typeName, newName);
        var oldVarName = targetVar.Identifier.Text;
        if (newVarName == oldVarName)
        {
            return root.ReplaceNode(targetOc, ocWithNewName);
        }

        // First, replace the declaration itself with the renamed local + new name string.
        var newStmt = BuildRenamedLocal(targetStmt, newVarName, ocWithNewName);
        var afterReplace = root.ReplaceNode(targetStmt, newStmt);
        // Then walk every identifier reference and rewrite the *uses* of the old variable name.
        // The IdentifierRewriter only visits IdentifierNameSyntax, so declarators are untouched.
        var rewriter = new IdentifierRewriter(oldVarName, newVarName);
        return rewriter.Visit(afterReplace) ?? afterReplace;
    }

    private static LocalDeclarationStatementSyntax BuildRenamedLocal(LocalDeclarationStatementSyntax stmt, string newVarName, BaseObjectCreationExpressionSyntax newOc)
    {
        var oldDeclarator = stmt.Declaration.Variables.First();
        var oldId = oldDeclarator.Identifier;
        // Preserve original initializer trivia (the `=` token's leading/trailing whitespace).
        var oldInit = oldDeclarator.Initializer ?? SyntaxFactory.EqualsValueClause(newOc);
        var newInit = oldInit.WithValue(newOc);
        var newDeclarator = oldDeclarator
            .WithIdentifier(SyntaxFactory.Identifier(oldId.LeadingTrivia, newVarName, oldId.TrailingTrivia))
            .WithInitializer(newInit);
        var newDeclaration = stmt.Declaration.WithVariables(SyntaxFactory.SingletonSeparatedList(newDeclarator));
        return stmt.WithDeclaration(newDeclaration);
    }

    /// <summary>
    /// Insert or replace an `Architecture.Tag(varName, lifecycle: ..., ownership: ...)` call after the
    /// declaration of the targeted element/link. Removes the call when both lifecycle and ownership are null.
    /// </summary>
    public static SyntaxNode SetTag(SyntaxNode root, string targetId, ArchLifecycle? lifecycle, ArchOwnership? ownership)
    {
        var build = FindBuildBody(root) ?? throw new InvalidOperationException("Architecture.Build() body not found");

        string? varName = null;
        LocalDeclarationStatementSyntax? targetDecl = null;
        foreach (var stmt in build.Statements.OfType<LocalDeclarationStatementSyntax>())
        {
            foreach (var v in stmt.Declaration.Variables)
            {
                if (v.Initializer?.Value is BaseObjectCreationExpressionSyntax oc && FirstArgIsLiteral(oc, targetId))
                {
                    varName = v.Identifier.Text;
                    targetDecl = stmt;
                    break;
                }
            }
            if (varName is not null) break;
        }
        if (varName is null || targetDecl is null) throw new InvalidOperationException($"No declaration with id {targetId}");

        var existingTag = build.Statements.OfType<ExpressionStatementSyntax>()
            .FirstOrDefault(s => s.Expression is InvocationExpressionSyntax inv
                && inv.Expression is MemberAccessExpressionSyntax mae
                && mae.Name.Identifier.Text == "For"
                && mae.Expression is IdentifierNameSyntax tagId && tagId.Identifier.Text == "Tag"
                && inv.ArgumentList.Arguments.Count > 0
                && inv.ArgumentList.Arguments[0].Expression is IdentifierNameSyntax argId && argId.Identifier.Text == varName);

        if (lifecycle is null && ownership is null)
        {
            if (existingTag is null) return root;
            var removed = root.RemoveNode(existingTag, SyntaxRemoveOptions.KeepNoTrivia);
            return removed ?? root;
        }

        var tagStmt = BuildTagStatement(varName, lifecycle, ownership);
        if (existingTag is not null)
        {
            return root.ReplaceNode(existingTag, tagStmt);
        }

        var newBuild = build.WithStatements(build.Statements.Insert(build.Statements.IndexOf(targetDecl) + 1, tagStmt));
        return root.ReplaceNode(build, newBuild);
    }

    private static ExpressionStatementSyntax BuildTagStatement(string varName, ArchLifecycle? lifecycle, ArchOwnership? ownership)
    {
        var parts = new List<string> { varName };
        if (lifecycle is not null)
        {
            var inner = new List<string>();
            if (lifecycle.Status is not null) inner.Add($"Status: {Quote(lifecycle.Status)}");
            if (lifecycle.Phase is not null) inner.Add($"Phase: {Quote(lifecycle.Phase)}");
            if (lifecycle.ValidFrom is not null) inner.Add($"ValidFrom: {Quote(lifecycle.ValidFrom)}");
            if (lifecycle.ValidUntil is not null) inner.Add($"ValidUntil: {Quote(lifecycle.ValidUntil)}");
            parts.Add($"lifecycle: new Lifecycle({string.Join(", ", inner)})");
        }
        if (ownership is not null)
        {
            var inner = new List<string>();
            if (ownership.Squad is not null) inner.Add($"Squad: {Quote(ownership.Squad)}");
            if (ownership.Domain is not null) inner.Add($"Domain: {Quote(ownership.Domain)}");
            parts.Add($"ownership: new Ownership({string.Join(", ", inner)})");
        }
        var src = $"        Tag.For({string.Join(", ", parts)});\n";
        return (ExpressionStatementSyntax)SyntaxFactory.ParseStatement(src);
    }

    private static string Quote(string s) => "\"" + s.Replace("\\", "\\\\").Replace("\"", "\\\"") + "\"";

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
            "DataFlow" => "flow",
            "Dependency" => "dep",
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

    private static string? GetSimpleTypeName(TypeSyntax? type) => type switch
    {
        IdentifierNameSyntax id => id.Identifier.Text,
        QualifiedNameSyntax q => GetSimpleTypeName(q.Right),
        _ => null
    };

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

    private static BlockSyntax? FindBuildBody(SyntaxNode root)
    {
        foreach (var cls in root.DescendantNodes().OfType<ClassDeclarationSyntax>())
        {
            var build = cls.Members.OfType<MethodDeclarationSyntax>().FirstOrDefault(m => m.Identifier.Text == "Build");
            if (build?.Body is not null) return build.Body;
        }
        return null;
    }

    private static BlockSyntax InsertBeforeReturn(BlockSyntax build, StatementSyntax stmt)
    {
        var ret = build.Statements.OfType<ReturnStatementSyntax>().FirstOrDefault();
        if (ret is null) return build.AddStatements(stmt);
        var idx = build.Statements.IndexOf(ret);
        return build.WithStatements(build.Statements.Insert(idx, stmt));
    }

    private static SyntaxNode AddToReturn(SyntaxNode root, string varName)
    {
        var build = FindBuildBody(root);
        var ret = build?.Statements.OfType<ReturnStatementSyntax>().FirstOrDefault();
        if (ret?.Expression is not InvocationExpressionSyntax inv) return root;

        var newArg = SyntaxFactory.Argument(SyntaxFactory.IdentifierName(varName));
        var newArgs = inv.ArgumentList.Arguments.Add(newArg);
        var newInv = inv.WithArgumentList(inv.ArgumentList.WithArguments(newArgs));
        return root.ReplaceNode(inv, newInv);
    }

    private static SyntaxNode RemoveFromReturn(SyntaxNode root, string varName)
    {
        var build = FindBuildBody(root);
        var ret = build?.Statements.OfType<ReturnStatementSyntax>().FirstOrDefault();
        if (ret?.Expression is not InvocationExpressionSyntax inv) return root;

        var argToRemove = inv.ArgumentList.Arguments.FirstOrDefault(a =>
            a.Expression is IdentifierNameSyntax id && id.Identifier.Text == varName);
        if (argToRemove is null) return root;
        var newInv = inv.WithArgumentList(inv.ArgumentList.WithArguments(inv.ArgumentList.Arguments.Remove(argToRemove)));
        return root.ReplaceNode(inv, newInv);
    }

    private static bool FirstArgIsLiteral(BaseObjectCreationExpressionSyntax oc, string value)
    {
        if (oc.ArgumentList is null || oc.ArgumentList.Arguments.Count == 0) return false;
        var first = oc.ArgumentList.Arguments[0];
        return first.Expression is LiteralExpressionSyntax lit && lit.Token.ValueText == value;
    }

    private static StatementSyntax BuildLocalForElement(ArchElement e)
    {
        var typeName = e.Kind.ToString();
        var args = new List<ArgumentSyntax> { Lit(e.Id), Lit(e.Name) };
        switch (e.Kind)
        {
            case ArchElementKind.Module:
            case ArchElementKind.Capability:
                if (e.Attributes.TryGetValue("contextId", out var ctxId) && ctxId is not null)
                    args.Add(Lit(ctxId));
                break;
            case ArchElementKind.Container:
                if (e.Attributes.TryGetValue("systemId", out var sysId) && sysId is not null) args.Add(Lit(sysId));
                if (e.Attributes.TryGetValue("kind", out var kind) && kind is not null) args.Add(Lit(kind));
                break;
            case ArchElementKind.Person:
                if (e.Attributes.TryGetValue("role", out var role) && role is not null) args.Add(Lit(role));
                break;
        }
        return ParseLocal(VarNameFor(e.Id), typeName, args);
    }

    private static StatementSyntax BuildLocalForLink(ArchLink l)
    {
        var typeName = l.Kind.ToString();
        var args = new List<ArgumentSyntax> { Lit(l.Id), Lit(l.FromId), Lit(l.ToId) };
        switch (l.Kind)
        {
            case ArchLinkKind.DataFlow:
                if (l.Attributes.TryGetValue("payload", out var p) && p is not null) args.Add(Lit(p));
                if (l.Attributes.TryGetValue("direction", out var d) && d is not null) args.Add(Lit(d));
                break;
            case ArchLinkKind.Dependency:
                if (l.Attributes.TryGetValue("kind", out var k) && k is not null) args.Add(Lit(k));
                break;
        }
        return ParseLocal(VarNameFor(l.Id), typeName, args);
    }

    private static StatementSyntax ParseLocal(string varName, string typeName, IReadOnlyList<ArgumentSyntax> args)
    {
        var argText = string.Join(", ", args.Select(a => a.Expression.ToString()));
        var src = $"        var {varName} = new {typeName}({argText});\n";
        var stmt = SyntaxFactory.ParseStatement(src);
        return stmt;
    }

    private static ArgumentSyntax Lit(string value) =>
        SyntaxFactory.Argument(SyntaxFactory.LiteralExpression(SyntaxKind.StringLiteralExpression,
            SyntaxFactory.Literal(value)));

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
