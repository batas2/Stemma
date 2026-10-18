using System.Text;
using System.Text.RegularExpressions;

namespace Stemma.Web.Services;

/// <summary>
/// A page's narrative as prose. Architects write narratives in Markdown, because that is how the
/// editor and the presenter show them; the PDF goes to people who read prose, not Markdown, and a
/// <c>**must**</c> or a <c>## Why</c> printed literally reads as noise on a handout. This takes the
/// markup off and keeps the words, the paragraphs and the line breaks. It is deliberately not a
/// Markdown renderer: a narrative is a few paragraphs, and anything it does not recognise is left
/// as the author wrote it rather than guessed at.
/// </summary>
public static partial class NarrativeText
{
    /// <summary>The narrative with its Markdown markers removed and its layout kept.</summary>
    public static string Plain(string? markdown)
    {
        if (string.IsNullOrEmpty(markdown)) return string.Empty;

        var lines = markdown.Replace("\r\n", "\n").Replace('\r', '\n').Split('\n');
        var output = new StringBuilder(markdown.Length);
        foreach (var raw in lines)
        {
            // A fence holds no words of its own; the code between two fences stays, as text.
            if (Fence().IsMatch(raw)) continue;

            var heading = Heading().Match(raw);
            var line = heading.Success ? ClosingHashes().Replace(heading.Groups[1].Value, "") : raw;
            line = ListMarker().Replace(line, "$1• ");
            line = line.Replace("**", "").Replace("__", "").Replace("`", "");
            output.Append(line.TrimEnd()).Append('\n');
        }
        return output.ToString().TrimStart('\n').TrimEnd();
    }

    /// <summary>An ATX heading: up to three spaces, one to six <c>#</c>, then a space or nothing.</summary>
    [GeneratedRegex(@"^ {0,3}#{1,6}(?:[ \t]+|$)(.*)$")]
    private static partial Regex Heading();

    /// <summary>The optional closing <c>#</c>s of a heading, as in <c>## Why ##</c>.</summary>
    [GeneratedRegex(@"[ \t]+#+[ \t]*$")]
    private static partial Regex ClosingHashes();

    /// <summary>A bullet item: any indentation, <c>-</c> or <c>*</c>, then at least one space.</summary>
    [GeneratedRegex(@"^([ \t]*)[-*][ \t]+")]
    private static partial Regex ListMarker();

    [GeneratedRegex(@"^ {0,3}(?:```|~~~)")]
    private static partial Regex Fence();
}
