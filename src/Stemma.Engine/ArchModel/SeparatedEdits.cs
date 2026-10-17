using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.CSharp;

namespace Stemma.Engine.ArchModel;

/// <summary>
/// Adding to and removing from comma-separated lists — argument lists, array initialisers — the way
/// a person editing the file would. A new item is laid out like the last one, on its line or on its
/// own; a removed item takes its line with it when it had one to itself, and otherwise only itself
/// and one comma; a comment that belonged to a neighbour stays with the neighbour.
///
/// Roslyn's own <c>SeparatedSyntaxList.Add</c> and <c>Remove</c> do none of this — <c>Add</c> writes
/// <c>a,b</c> and <c>Remove</c> takes whichever comma it finds, line breaks and comments included —
/// which is why every list edit in the writer comes through here.
/// </summary>
internal static class SeparatedEdits
{
    public static SeparatedSyntaxList<T> Append<T>(SeparatedSyntaxList<T> list, T item) where T : SyntaxNode
    {
        if (list.Count == 0) return list.Add(item);

        var items = list.ToList();
        var commas = list.GetSeparators().ToList();
        var last = items[^1];
        var placed = item.WithLeadingTrivia(Trivia.Indentation(last.GetLeadingTrivia()));

        if (commas.Count == items.Count)
        {
            // `"a",⏎ "b",⏎` — every item carries its own comma, so the new one does too.
            items.Add(placed.WithTrailingTrivia(last.GetTrailingTrivia()));
            commas.Add(Comma(commas[^1]));
            return SyntaxFactory.SeparatedList(items, commas);
        }

        // Laid out the way the last item is laid out against the one before it: the same line, or a
        // line of its own. With only one item there is nothing to copy, so it is the plain ", ".
        var comma = items.Count >= 2
            ? Comma(commas[^1])
            : SyntaxFactory.Token(SyntaxKind.CommaToken).WithTrailingTrivia(SyntaxFactory.Space);
        if (items.Count < 2) placed = item;
        items[^1] = last.WithTrailingTrivia(SyntaxTriviaList.Empty);
        items.Add(placed.WithTrailingTrivia(last.GetTrailingTrivia()));
        commas.Add(comma);
        return SyntaxFactory.SeparatedList(items, commas);
    }

    /// <summary>Insert before the item at <paramref name="index"/>, laid out where that item was.</summary>
    public static SeparatedSyntaxList<T> Insert<T>(SeparatedSyntaxList<T> list, int index, T item) where T : SyntaxNode
    {
        if (index >= list.Count) return Append(list, item);

        var items = list.ToList();
        var commas = list.GetSeparators().ToList();
        var placed = item.WithLeadingTrivia(Trivia.Indentation(items[index].GetLeadingTrivia()));
        var comma = index > 0
            ? Comma(commas[index - 1])
            : SyntaxFactory.Token(SyntaxKind.CommaToken).WithTrailingTrivia(SyntaxFactory.Space);
        items.Insert(index, placed);
        commas.Insert(index, comma);
        return SyntaxFactory.SeparatedList(items, commas);
    }

    /// <summary>
    /// Remove the item at <paramref name="index"/>. Returns the list's opening token too, because
    /// removing the first item of a list that continues on the next line moves that line break onto it.
    /// </summary>
    public static (SyntaxToken Open, SeparatedSyntaxList<T> List) RemoveAt<T>(SyntaxToken open, SeparatedSyntaxList<T> list, int index)
        where T : SyntaxNode
    {
        var items = list.ToList();
        var commas = list.GetSeparators().ToList();
        var item = items[index];
        if (items.Count == 1) return (open, default);

        var before = index == 0 ? open : commas[index - 1];
        SyntaxToken? after = index < commas.Count ? commas[index] : null;
        var startsLine = Trivia.EndsLine(before.TrailingTrivia) || Trivia.EndsLine(item.GetLeadingTrivia());
        var endsLine = after is { } a ? Trivia.EndsLine(a.TrailingTrivia) : Trivia.EndsLine(item.GetTrailingTrivia());

        if (after is { } next && (index == 0 || startsLine || !endsLine))
        {
            // The item and the comma after it: `a, [b, ]c`, or the whole of b's line.
            items.RemoveAt(index);
            commas.RemoveAt(index);
            if (index < items.Count)
            {
                var follower = items[index];
                var leading = Trivia.Above(item.GetLeadingTrivia())
                    .AddRange(startsLine && !endsLine ? Trivia.Indentation(item.GetLeadingTrivia()) : follower.GetLeadingTrivia());
                items[index] = follower.WithLeadingTrivia(leading);
            }
            if (!startsLine && endsLine)
                open = open.WithTrailingTrivia(open.TrailingTrivia.AddRange(next.TrailingTrivia));
        }
        else
        {
            // The comma before the item and the item: `a[, b])`, or `a[, b],⏎`.
            var previous = items[index - 1];
            var comma = commas[index - 1];
            if (after is null && endsLine)
                previous = previous.WithTrailingTrivia(previous.GetTrailingTrivia()
                    .AddRange(startsLine ? comma.TrailingTrivia : item.GetTrailingTrivia()));
            else if (after is null && Trivia.HasComment(comma.TrailingTrivia) && Trivia.EndsLine(comma.TrailingTrivia))
                // `a, // note⏎ b)`: the note is about a's line. A comment on b's own line — `a, /* x */ b)` —
                // is b's, and goes with it.
                previous = previous.WithTrailingTrivia(previous.GetTrailingTrivia().AddRange(comma.TrailingTrivia));
            items[index - 1] = previous;
            items.RemoveAt(index);
            commas.RemoveAt(index - 1);
        }
        return (open, SyntaxFactory.SeparatedList(items, commas));
    }

    /// <summary>A new comma laid out like <paramref name="template"/>, without any comment it carried.</summary>
    private static SyntaxToken Comma(SyntaxToken template) =>
        SyntaxFactory.Token(Trivia.Layout(template.LeadingTrivia), SyntaxKind.CommaToken, Trivia.Layout(template.TrailingTrivia));
}

/// <summary>Reading the shape of the lines around a node from its trivia.</summary>
internal static class Trivia
{
    /// <summary>
    /// A trivia item that finishes a line. Directives and disabled text carry their own line ending
    /// inside them, so they count: <c>#endregion</c> above a declaration is a line of its own.
    /// </summary>
    public static bool IsLineEnd(SyntaxTrivia t) =>
        t.IsKind(SyntaxKind.EndOfLineTrivia) || t.IsDirective || t.IsKind(SyntaxKind.DisabledTextTrivia);

    public static bool EndsLine(SyntaxTriviaList trivia) => trivia.Any(IsLineEnd);

    public static bool HasComment(SyntaxTriviaList trivia) =>
        trivia.Any(t => t.IsKind(SyntaxKind.SingleLineCommentTrivia) || t.IsKind(SyntaxKind.MultiLineCommentTrivia));

    /// <summary>The whole lines in leading trivia — blank lines, comments, directives — up to the line the node is on.</summary>
    public static SyntaxTriviaList Above(SyntaxTriviaList leading)
    {
        var last = -1;
        for (var i = 0; i < leading.Count; i++)
            if (IsLineEnd(leading[i])) last = i;
        return last < 0 ? SyntaxTriviaList.Empty : SyntaxFactory.TriviaList(leading.Take(last + 1));
    }

    /// <summary>
    /// What stays of a removed node's leading trivia: the whole lines above it that are not its own.
    /// A documentation comment is the node's own and goes with it. Lines that are only blank go too,
    /// since the next node keeps its own blank line and two would be left; and before a closing
    /// brace or the end of the file, trailing blank lines go, so a block does not end on one.
    /// Comments and directives stay: Stemma cannot tell a note about the node from the header of the
    /// section it sits in, and removing someone's prose cannot be taken back.
    /// </summary>
    public static SyntaxTriviaList KeptAbove(SyntaxTriviaList leading, bool beforeClosing)
    {
        var kept = new List<SyntaxTrivia>();
        foreach (var t in Above(leading))
        {
            if (t.IsKind(SyntaxKind.SingleLineDocumentationCommentTrivia) || t.IsKind(SyntaxKind.MultiLineDocumentationCommentTrivia))
            {
                if (kept.Count > 0 && kept[^1].IsKind(SyntaxKind.WhitespaceTrivia)) kept.RemoveAt(kept.Count - 1);
                continue;
            }
            kept.Add(t);
        }
        if (!kept.Any(t => t.IsDirective || t.IsKind(SyntaxKind.DisabledTextTrivia)
                           || t.IsKind(SyntaxKind.SingleLineCommentTrivia) || t.IsKind(SyntaxKind.MultiLineCommentTrivia)))
            return SyntaxTriviaList.Empty;
        if (beforeClosing)
        {
            // A trailing line ending is a blank line when the line it ends had nothing on it.
            while (kept.Count > 0 && kept[^1].IsKind(SyntaxKind.EndOfLineTrivia)
                   && kept.Take(kept.Count - 1).LastOrDefault(x => !x.IsKind(SyntaxKind.WhitespaceTrivia)) is var before
                   && (before == default || IsLineEnd(before)))
            {
                kept.RemoveAt(kept.Count - 1);
                while (kept.Count > 0 && kept[^1].IsKind(SyntaxKind.WhitespaceTrivia)) kept.RemoveAt(kept.Count - 1);
            }
        }
        return SyntaxFactory.TriviaList(kept);
    }

    /// <summary>The whitespace at the start of the node's own line, without anything else on it.</summary>
    public static SyntaxTriviaList Indentation(SyntaxTriviaList leading)
    {
        var start = 0;
        for (var i = 0; i < leading.Count; i++)
            if (IsLineEnd(leading[i])) start = i + 1;
        return SyntaxFactory.TriviaList(leading.Skip(start).TakeWhile(t => t.IsKind(SyntaxKind.WhitespaceTrivia)));
    }

    /// <summary>
    /// Only the whitespace and line endings: the layout of some trivia without its content. The space
    /// that separated a removed comment from its comma would be left trailing, so it goes too.
    /// </summary>
    public static SyntaxTriviaList Layout(SyntaxTriviaList trivia)
    {
        var kept = trivia.Where(t => t.IsKind(SyntaxKind.WhitespaceTrivia) || t.IsKind(SyntaxKind.EndOfLineTrivia)).ToList();
        for (var i = kept.Count - 2; i >= 0; i--)
            if (kept[i].IsKind(SyntaxKind.WhitespaceTrivia) && kept[i + 1].IsKind(SyntaxKind.EndOfLineTrivia))
                kept.RemoveAt(i);
        return SyntaxFactory.TriviaList(kept);
    }
}
