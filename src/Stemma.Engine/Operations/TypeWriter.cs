using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.CSharp;
using Microsoft.CodeAnalysis.CSharp.Syntax;
using Stemma.Engine.ArchModel;

namespace Stemma.Engine.Operations;

/// <summary>
/// The syntax edits behind the type operations, held to the same rule as <see cref="DslWriter"/>:
/// a new member is laid out like its neighbours — their indentation, the file's line ending — and
/// a removed one takes its own lines and its documentation comment, and nothing else. Roslyn's
/// <c>AddMembers</c> and <c>RemoveNode</c> do neither; the first appends a member with no
/// indentation and no line ending, so it lands on the closing brace's line.
/// </summary>
internal static class TypeWriter
{
    /// <summary>Append <paramref name="member"/> after the last member of <paramref name="type"/>.</summary>
    public static TypeDeclarationSyntax AddMember(TypeDeclarationSyntax type, MemberDeclarationSyntax member)
    {
        var last = type.Members.LastOrDefault();
        var indent = last is not null
            ? Trivia.Indentation(last.GetLeadingTrivia())
            : Trivia.Indentation(type.GetLeadingTrivia()).AddRange(IndentUnit(type));
        var eol = LineEnding(last?.GetTrailingTrivia() ?? type.OpenBraceToken.TrailingTrivia, type);
        return type.WithMembers(type.Members.Add(member.WithLeadingTrivia(indent).WithTrailingTrivia(eol)));
    }

    /// <summary>
    /// Add a new, empty type declaration after the last type in <paramref name="root"/>'s namespace,
    /// separated from it by a blank line, the way the types above it are.
    /// </summary>
    public static SyntaxNode AddType(CompilationUnitSyntax root, string? namespaceName, string header)
    {
        var container = (SyntaxNode?)root.Members.OfType<BaseNamespaceDeclarationSyntax>()
            .FirstOrDefault(n => n.Name.ToString() == namespaceName) ?? root;
        var members = container switch
        {
            BaseNamespaceDeclarationSyntax ns => ns.Members,
            _ => root.Members,
        };
        var last = members.LastOrDefault();
        var indent = last is null ? SyntaxTriviaList.Empty : Trivia.Indentation(last.GetLeadingTrivia());
        var eol = LineEnding(last?.GetTrailingTrivia() ?? SyntaxTriviaList.Empty, root);
        var text = $"{header}{eol}{indent}{{{eol}{indent}}}";
        var declaration = SyntaxFactory.ParseMemberDeclaration(text)!
            .WithLeadingTrivia(last is null ? indent : SyntaxFactory.TriviaList(eol).AddRange(indent))
            .WithTrailingTrivia(eol);
        return container switch
        {
            BaseNamespaceDeclarationSyntax ns => root.ReplaceNode(ns, ns.WithMembers(ns.Members.Add(declaration))),
            _ => root.WithMembers(root.Members.Add(declaration)),
        };
    }

    /// <summary>
    /// Remove a member — a type, a property — with its own lines, its documentation comment and its
    /// attributes. Whatever stood above it that was not its own moves to the next line
    /// (<see cref="Trivia.KeptAbove"/>).
    /// </summary>
    public static SyntaxNode RemoveMember(SyntaxNode root, MemberDeclarationSyntax member)
    {
        var next = member.GetLastToken().GetNextToken(includeZeroWidth: true);
        var beforeClosing = next.IsKind(SyntaxKind.CloseBraceToken) || next.IsKind(SyntaxKind.EndOfFileToken);
        var kept = Trivia.KeptAbove(member.GetLeadingTrivia(), beforeClosing);

        var memberMark = new SyntaxAnnotation();
        var nextMark = new SyntaxAnnotation();
        root = root.ReplaceSyntax(
            [member], (_, m) => m.WithAdditionalAnnotations(memberMark),
            [next], (_, t) => t.WithAdditionalAnnotations(nextMark),
            [], (_, t) => t);
        root = root.RemoveNode(root.GetAnnotatedNodes(memberMark).Single(), SyntaxRemoveOptions.KeepNoTrivia)!;
        var marked = root.GetAnnotatedTokens(nextMark).Single();
        return root.ReplaceToken(marked, marked.WithLeadingTrivia(kept.AddRange(marked.LeadingTrivia)));
    }

    /// <summary>Add to the base list — first for a base class, last for an interface — or start one.</summary>
    public static TypeDeclarationSyntax AddBase(TypeDeclarationSyntax type, BaseTypeSyntax baseType, bool first)
    {
        if (type.BaseList is null)
        {
            // `class Dog⏎{` becomes `class Dog : Animal⏎{`: what followed the name follows the list.
            var list = SyntaxFactory.BaseList(SyntaxFactory.SingletonSeparatedList(baseType.WithTrailingTrivia(type.Identifier.TrailingTrivia)))
                .WithColonToken(SyntaxFactory.Token(SyntaxKind.ColonToken).WithTrailingTrivia(SyntaxFactory.Space));
            return type.WithIdentifier(type.Identifier.WithTrailingTrivia(SyntaxFactory.Space)).WithBaseList(list);
        }
        var types = first
            ? SeparatedEdits.Insert(type.BaseList.Types, 0, baseType)
            : SeparatedEdits.Append(type.BaseList.Types, baseType);
        return type.WithBaseList(type.BaseList.WithTypes(types));
    }

    public static TypeDeclarationSyntax RemoveBase(TypeDeclarationSyntax type, int index)
    {
        var list = type.BaseList!;
        if (list.Types.Count == 1)
        {
            // `class Dog : Animal⏎{` becomes `class Dog⏎{`.
            return type.WithBaseList(null).WithIdentifier(type.Identifier.WithTrailingTrivia(list.GetTrailingTrivia()));
        }
        var (colon, rest) = SeparatedEdits.RemoveAt(list.ColonToken, list.Types, index);
        return type.WithBaseList(list.WithColonToken(colon).WithTypes(rest));
    }

    private static SyntaxTriviaList IndentUnit(SyntaxNode type) =>
        SyntaxFactory.TriviaList(Trivia.Indentation(type.GetLeadingTrivia()).ToString().Contains('\t')
            ? SyntaxFactory.Whitespace("\t")
            : SyntaxFactory.Whitespace("    "));

    /// <summary>The line ending of <paramref name="trivia"/>'s line, or the first one in the file.</summary>
    private static SyntaxTrivia LineEnding(SyntaxTriviaList trivia, SyntaxNode anywhere)
    {
        var eol = trivia.LastOrDefault(t => t.IsKind(SyntaxKind.EndOfLineTrivia));
        if (eol.IsKind(SyntaxKind.EndOfLineTrivia)) return eol;
        var first = anywhere.SyntaxTree.GetRoot().DescendantTrivia(descendIntoTrivia: true).FirstOrDefault(t => t.IsKind(SyntaxKind.EndOfLineTrivia));
        return first.IsKind(SyntaxKind.EndOfLineTrivia) ? first : SyntaxFactory.EndOfLine("\n");
    }
}
