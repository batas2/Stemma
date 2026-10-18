using FluentAssertions;
using Stemma.Web.Services;
using Xunit;

namespace Stemma.Web.Tests;

/// <summary>The PDF prints a narrative as prose: the Markdown markers go, the words and the layout stay.</summary>
public sealed class NarrativeTextTests
{
    [Theory]
    [InlineData("Payment Orchestration is the **only** module allowed.", "Payment Orchestration is the only module allowed.")]
    [InlineData("It __must not__ call the PSP directly.", "It must not call the PSP directly.")]
    [InlineData("Call `PaymentPort.Charge` once.", "Call PaymentPort.Charge once.")]
    [InlineData("# Why", "Why")]
    [InlineData("### Where the money moves", "Where the money moves")]
    [InlineData("## Why ##", "Why")]
    [InlineData("- first", "• first")]
    [InlineData("* second", "• second")]
    [InlineData("  - nested", "  • nested")]
    public void Plain_removes_the_markup(string markdown, string expected)
    {
        NarrativeText.Plain(markdown).Should().Be(expected);
    }

    [Theory]
    [InlineData("C# is the model.")]
    [InlineData("#hashtag is not a heading")]
    [InlineData("mod_payment calls ext_psp")]
    [InlineData("2 * 3 is six")]
    [InlineData("1. Ordered items stay numbered")]
    public void Plain_leaves_what_is_not_markup(string text)
    {
        NarrativeText.Plain(text).Should().Be(text);
    }

    [Fact]
    public void Plain_keeps_paragraphs_and_line_breaks()
    {
        var markdown = "## The path\n\nFirst the **wider** context,\nthen the part that matters.\n\n- Ticketing\n- Payments\n";

        NarrativeText.Plain(markdown).Should().Be(
            "The path\n\nFirst the wider context,\nthen the part that matters.\n\n• Ticketing\n• Payments");
    }

    [Fact]
    public void Plain_trims_trailing_whitespace_and_reads_windows_line_endings()
    {
        NarrativeText.Plain("\r\nOne   \r\n\r\nTwo\t \r\n\r\n").Should().Be("One\n\nTwo");
    }

    [Fact]
    public void Plain_drops_code_fences_and_keeps_the_code()
    {
        NarrativeText.Plain("Before\n```csharp\nvar x = 1;\n```\nAfter").Should().Be("Before\nvar x = 1;\nAfter");
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    public void Plain_of_nothing_is_empty(string? markdown)
    {
        NarrativeText.Plain(markdown).Should().BeEmpty();
    }
}
