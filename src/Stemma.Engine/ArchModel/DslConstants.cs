using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.CSharp;
using Microsoft.CodeAnalysis.CSharp.Syntax;

namespace Stemma.Engine.ArchModel;

/// <summary>
/// The string an argument of a declaration stands for, when it can be known without running the code.
///
/// Constants are the obvious way to keep an id from being mistyped in every flow that names it, and
/// the reader used to take nothing but a plain literal: <c>new Container(Api, …)</c> was missing from
/// the model, a flow to <c>Api</c> was dropped, and a context written as <c>Ids.Ctx</c> read as none,
/// all without a word. What is read here is what C# itself folds into a constant string: a literal
/// of any form (regular, verbatim, raw), <c>null</c>, <c>+</c> and interpolation over those,
/// <c>nameof</c>, and a <c>const</c> declared in the same file — a local of <c>Build()</c>, a field
/// of the enclosing class, or a field of a class named by its member access. With a semantic model
/// at hand the compiler answers instead, which also sees constants declared in other files.
/// </summary>
internal static class DslConstants
{
    // Constants defined in terms of each other are folded through; a chain this long is a cycle.
    private const int MaxDepth = 32;

    /// <summary>Whether <paramref name="expression"/> can be read, and if so as which string (or null).</summary>
    public static bool TryRead(ExpressionSyntax expression, SemanticModel? semantic, out string? value)
    {
        if (expression is LiteralExpressionSyntax) return Fold(expression, 0, out value);
        if (semantic is not null && semantic.SyntaxTree == expression.SyntaxTree)
        {
            var constant = semantic.GetConstantValue(expression);
            if (constant is { HasValue: true, Value: null or string })
            {
                value = (string?)constant.Value;
                return true;
            }
        }
        return Fold(expression, 0, out value);
    }

    /// <summary>A string literal of any form, or <c>null</c>: the arguments an edit may replace.</summary>
    public static bool IsLiteral(ExpressionSyntax expression) =>
        expression.IsKind(SyntaxKind.StringLiteralExpression) || expression.IsKind(SyntaxKind.NullLiteralExpression);

    private static bool Fold(ExpressionSyntax expression, int depth, out string? value)
    {
        value = null;
        if (depth > MaxDepth) return false;
        switch (expression)
        {
            case LiteralExpressionSyntax literal when literal.IsKind(SyntaxKind.StringLiteralExpression):
                value = literal.Token.ValueText;
                return true;
            case LiteralExpressionSyntax literal when literal.IsKind(SyntaxKind.NullLiteralExpression):
                return true;
            case ParenthesizedExpressionSyntax parenthesized:
                return Fold(parenthesized.Expression, depth + 1, out value);
            case BinaryExpressionSyntax binary when binary.IsKind(SyntaxKind.AddExpression):
                if (!Fold(binary.Left, depth + 1, out var left) || !Fold(binary.Right, depth + 1, out var right)) return false;
                value = left + right;
                return true;
            case InterpolatedStringExpressionSyntax interpolated:
                return FoldInterpolation(interpolated, depth, out value);
            case InvocationExpressionSyntax { Expression: IdentifierNameSyntax { Identifier.ValueText: "nameof" }, ArgumentList.Arguments: [var argument] }:
                value = NameOf(argument.Expression);
                return value is not null;
            case IdentifierNameSyntax name:
                return FoldConstant(LocalOrEnclosingConstant(name), depth, out value);
            case MemberAccessExpressionSyntax { RawKind: (int)SyntaxKind.SimpleMemberAccessExpression, Name: IdentifierNameSyntax member } access:
                return FoldConstant(MemberConstant(access.Expression, member.Identifier.ValueText), depth, out value);
            default:
                return false;
        }
    }

    private static bool FoldInterpolation(InterpolatedStringExpressionSyntax interpolated, int depth, out string? value)
    {
        value = null;
        var text = new System.Text.StringBuilder();
        foreach (var content in interpolated.Contents)
        {
            switch (content)
            {
                case InterpolatedStringTextSyntax part:
                    text.Append(part.TextToken.ValueText);
                    break;
                // A hole is a constant only when it is a constant string with no alignment or format.
                case InterpolationSyntax { AlignmentClause: null, FormatClause: null } hole
                    when Fold(hole.Expression, depth + 1, out var inner):
                    text.Append(inner);
                    break;
                default:
                    return false;
            }
        }
        value = text.ToString();
        return true;
    }

    private static string? NameOf(ExpressionSyntax expression) => expression switch
    {
        IdentifierNameSyntax id => id.Identifier.ValueText,
        GenericNameSyntax generic => generic.Identifier.ValueText,
        MemberAccessExpressionSyntax access => NameOf(access.Name),
        QualifiedNameSyntax qualified => NameOf(qualified.Right),
        _ => null,
    };

    /// <summary>The initializer that folds, or a reason it cannot: unknown, or declared twice differently.</summary>
    private static bool FoldConstant(IReadOnlyList<ExpressionSyntax> initializers, int depth, out string? value)
    {
        value = null;
        if (initializers.Count == 0) return false;
        string? first = null;
        for (var i = 0; i < initializers.Count; i++)
        {
            if (!Fold(initializers[i], depth + 1, out var folded)) return false;
            if (i == 0) first = folded;
            else if (folded != first) return false;
        }
        value = first;
        return true;
    }

    /// <summary>
    /// A bare name: a <c>const</c> local of an enclosing block, else a <c>const</c> field of the
    /// innermost enclosing type that has one by that name — the order C# looks in.
    /// </summary>
    private static IReadOnlyList<ExpressionSyntax> LocalOrEnclosingConstant(IdentifierNameSyntax name)
    {
        var text = name.Identifier.ValueText;
        foreach (var block in name.Ancestors().OfType<BlockSyntax>())
        {
            var local = block.Statements.OfType<LocalDeclarationStatementSyntax>()
                .Where(s => s.IsConst)
                .SelectMany(s => s.Declaration.Variables)
                .FirstOrDefault(v => v.Identifier.ValueText == text);
            if (local?.Initializer is { } init) return [init.Value];
        }
        foreach (var type in name.Ancestors().OfType<TypeDeclarationSyntax>())
        {
            var found = ConstantFields(type, text);
            if (found.Count > 0) return found;
        }
        return [];
    }

    /// <summary><c>Ids.Ctx</c>: the constant <c>Ctx</c> of every type in the file named <c>Ids</c>.</summary>
    private static IReadOnlyList<ExpressionSyntax> MemberConstant(ExpressionSyntax owner, string member)
    {
        var typeName = owner switch
        {
            IdentifierNameSyntax id => id.Identifier.ValueText,
            MemberAccessExpressionSyntax access => access.Name.Identifier.ValueText,
            _ => null,
        };
        if (typeName is null) return [];
        return owner.SyntaxTree.GetRoot().DescendantNodes().OfType<TypeDeclarationSyntax>()
            .Where(t => t.Identifier.ValueText == typeName)
            .SelectMany(t => ConstantFields(t, member))
            .ToList();
    }

    private static IReadOnlyList<ExpressionSyntax> ConstantFields(TypeDeclarationSyntax type, string name) =>
        type.Members.OfType<FieldDeclarationSyntax>()
            .Where(f => f.Modifiers.Any(SyntaxKind.ConstKeyword))
            .SelectMany(f => f.Declaration.Variables)
            .Where(v => v.Identifier.ValueText == name && v.Initializer is not null)
            .Select(v => v.Initializer!.Value)
            .ToList();
}
