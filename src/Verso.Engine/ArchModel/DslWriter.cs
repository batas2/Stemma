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

    public static SyntaxNode RenameElement(SyntaxNode root, string id, string newName)
    {
        var build = FindBuildBody(root) ?? throw new InvalidOperationException("Architecture.Build() body not found");
        foreach (var stmt in build.Statements.OfType<LocalDeclarationStatementSyntax>())
        {
            foreach (var v in stmt.Declaration.Variables)
            {
                if (v.Initializer?.Value is not BaseObjectCreationExpressionSyntax oc) continue;
                if (oc.ArgumentList is null || oc.ArgumentList.Arguments.Count < 2) continue;
                if (!FirstArgIsLiteral(oc, id)) continue;

                var args = oc.ArgumentList.Arguments;
                var nameArgIndex = args[1].NameColon is null
                    ? 1
                    : args.Select((a, i) => (a, i)).FirstOrDefault(x => x.a.NameColon?.Name.Identifier.Text == "name").i;
                if (nameArgIndex < 0 || nameArgIndex >= args.Count) return root;

                var newLiteral = SyntaxFactory.LiteralExpression(SyntaxKind.StringLiteralExpression,
                    SyntaxFactory.Literal(newName));
                var newArg = args[nameArgIndex].WithExpression(newLiteral);
                var newArgs = args.Replace(args[nameArgIndex], newArg);
                var newOc = oc switch
                {
                    ObjectCreationExpressionSyntax explicitOc =>
                        (BaseObjectCreationExpressionSyntax)explicitOc.WithArgumentList(oc.ArgumentList.WithArguments(newArgs)),
                    ImplicitObjectCreationExpressionSyntax implicitOc =>
                        implicitOc.WithArgumentList(oc.ArgumentList.WithArguments(newArgs)),
                    _ => oc
                };
                return root.ReplaceNode(oc, newOc);
            }
        }
        return root;
    }

    private static BlockSyntax? FindBuildBody(SyntaxNode root)
    {
        foreach (var cls in root.DescendantNodes().OfType<ClassDeclarationSyntax>())
        {
            if (cls.Identifier.Text != "Architecture") continue;
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
