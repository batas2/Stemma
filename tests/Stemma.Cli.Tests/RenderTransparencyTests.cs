using FluentAssertions;
using Xunit;

namespace Stemma.Cli.Tests;

/// <summary>
/// The manifest's `transparent` and the guard that stops a contradicted render from exiting zero.
///
/// B-003's real damage was the exit code: six opaque files were published because the render
/// reported success and the manifest agreed with the request rather than with the files.
/// </summary>
public class RenderTransparencyTests
{
    private static RenderedFile Png(bool? hasAlpha, string name = "a.png") =>
        new(name, "light", "png", 3, 100, 100, hasAlpha);

    private static RenderedFile Svg(string name = "a.svg") =>
        new(name, "light", "svg", 3, 100, 100, null);

    [Fact]
    public void Reports_transparent_when_every_png_carries_alpha() =>
        RenderTransparency.Of([Png(true), Png(true, "b.png")]).Should().BeTrue();

    [Fact]
    public void Reports_opaque_when_any_png_lacks_alpha() =>
        RenderTransparency.Of([Png(true), Png(false, "b.png")]).Should().BeFalse();

    [Fact]
    public void Reports_nothing_when_only_svg_was_written() =>
        // Transparency in SVG is markup, not an encoding. "Not established" beats a guess.
        RenderTransparency.Of([Svg()]).Should().BeNull();

    [Fact]
    public void Ignores_svg_when_a_png_was_also_written() =>
        RenderTransparency.Of([Svg(), Png(true)]).Should().BeTrue();

    [Fact]
    public void Accepts_a_transparent_render_that_produced_alpha() =>
        RenderTransparency.Mismatch(requested: true, [Png(true)]).Should().BeNull();

    [Fact]
    public void Accepts_an_opaque_render_that_produced_no_alpha() =>
        RenderTransparency.Mismatch(requested: false, [Png(false)]).Should().BeNull();

    [Fact]
    public void Rejects_a_transparent_render_that_produced_an_opaque_file()
    {
        // This is B-003 exactly: --opaque was never passed, and the file came out without alpha.
        var mismatch = RenderTransparency.Mismatch(requested: true, [Png(false, "hero.png")]);

        mismatch.Should().NotBeNull().And.Contain("hero.png");
        mismatch.Should().Contain("--opaque", "the message has to name the way out");
    }

    [Fact]
    public void Rejects_an_opaque_render_that_produced_alpha() =>
        RenderTransparency.Mismatch(requested: false, [Png(true)]).Should().NotBeNull();

    [Fact]
    public void Does_not_judge_a_file_it_could_not_read() =>
        RenderTransparency.Mismatch(requested: true, [Png(null)]).Should().BeNull();

    [Fact]
    public void Names_the_offending_file_when_only_one_theme_is_wrong() =>
        RenderTransparency.Mismatch(requested: true, [Png(true, "light.png"), Png(false, "dark.png")])
            .Should().NotBeNull().And.Contain("dark.png");
}
