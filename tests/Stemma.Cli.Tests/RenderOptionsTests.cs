using FluentAssertions;
using Stemma.Cli;
using Xunit;

namespace Stemma.Cli.Tests;

/// <summary>
/// The command line is the only interface an agent has to the renderer, and an agent cannot see a
/// mistake it made — it gets one attempt and then a file it never looks at. So the rules that matter
/// here are the ones that turn a bad invocation into a clear refusal rather than a plausible-looking
/// wrong picture.
/// </summary>
public sealed class RenderOptionsTests
{
    private static RenderOptions Parse(params string[] args)
    {
        var r = RenderOptions.Parse(args);
        r.Ok.Should().BeTrue(because: r.Error);
        return r.Options!;
    }

    private static string ErrorFrom(params string[] args)
    {
        var r = RenderOptions.Parse(args);
        r.Ok.Should().BeFalse("this invocation should have been refused");
        return r.Error!;
    }

    private static readonly string[] Minimal = ["--workspace", "/tmp/ws", "--view", "v1", "--out", "/tmp/out.png"];

    [Theory]
    [InlineData("--workspace")]
    [InlineData("--view")]
    [InlineData("--out")]
    public void Every_required_option_is_named_in_its_own_error(string flag)
    {
        var args = Minimal.ToList();
        var i = args.IndexOf(flag);
        args.RemoveRange(i, 2);
        ErrorFrom([.. args]).Should().Contain(flag);
    }

    [Fact]
    public void Defaults_are_the_publication_ones_because_that_is_what_the_command_is_for()
    {
        var o = Parse(Minimal);
        o.Profile.Should().Be("publication");
        o.Transparent.Should().BeTrue();
        o.Scale.Should().Be(2);
        o.Themes.Should().Equal("light");
        o.Formats.Should().Equal("png");
    }

    [Fact]
    public void Paths_are_absolute_so_the_output_does_not_depend_on_the_shell_that_launched_it()
    {
        var o = Parse("--workspace", "rel/ws", "--view", "v1", "--out", "rel/out.png");
        Path.IsPathRooted(o.Workspace).Should().BeTrue();
        Path.IsPathRooted(o.Output).Should().BeTrue();
    }

    [Fact]
    public void Scale_is_clamped_rather_than_rejected()
    {
        // A scale of 99 is a typo, not a position worth arguing with; failing the whole render
        // over it helps nobody.
        Parse([.. Minimal, "--scale", "99"]).Scale.Should().Be(RenderOptions.ScaleMax);
        Parse([.. Minimal, "--scale", "0"]).Scale.Should().Be(RenderOptions.ScaleMin);
        Parse([.. Minimal, "--scale", "3"]).Scale.Should().Be(3);
    }

    [Fact]
    public void A_non_numeric_scale_is_refused_rather_than_silently_defaulted()
    {
        ErrorFrom([.. Minimal, "--scale", "big"]).Should().Contain("--scale");
    }

    [Fact]
    public void Unknown_themes_formats_and_profiles_are_refused_and_list_what_is_known()
    {
        ErrorFrom([.. Minimal, "--theme", "sepia"]).Should().Contain("light").And.Contain("dark");
        ErrorFrom([.. Minimal, "--format", "jpeg"]).Should().Contain("png").And.Contain("svg");
        ErrorFrom([.. Minimal, "--profile", "fancy"]).Should().Contain("publication");
    }

    [Fact]
    public void An_unknown_option_is_refused_rather_than_ignored()
    {
        // Silently ignoring --transparant would produce an opaque file that looks like a success.
        ErrorFrom([.. Minimal, "--transparant"]).Should().Contain("--transparant");
    }

    [Fact]
    public void Lists_are_split_deduplicated_and_case_folded()
    {
        var o = Parse([.. Minimal, "--theme", "Light, dark ,light", "--format", "PNG,svg"]);
        o.Themes.Should().Equal("light", "dark");
        o.Formats.Should().Equal("png", "svg");
    }

    [Fact]
    public void An_empty_list_falls_back_instead_of_rendering_nothing()
    {
        var o = Parse([.. Minimal, "--theme", "", "--format", ""]);
        o.Themes.Should().Equal("light");
        o.Formats.Should().Equal("png");
    }

    [Fact]
    public void Opaque_is_opt_in()
    {
        Parse([.. Minimal, "--opaque"]).Transparent.Should().BeFalse();
    }

    [Fact]
    public void A_single_theme_keeps_the_filename_it_was_given()
    {
        // Asking for who-do-you-ask.png and getting who-do-you-ask-light.png breaks every reference
        // already written into the post.
        var o = Parse("--workspace", "/tmp/ws", "--view", "v1", "--out", "/tmp/d/who-do-you-ask.png");
        o.OutputFor("light", "png").Should().Be(Path.Combine("/tmp/d", "who-do-you-ask.png"));
    }

    [Fact]
    public void Two_themes_suffix_the_name_into_the_pair_the_picture_element_expects()
    {
        var o = Parse("--workspace", "/tmp/ws", "--view", "v1", "--out", "/tmp/d/two-jobs.png", "--theme", "light,dark");
        o.OutputFor("light", "png").Should().Be(Path.Combine("/tmp/d", "two-jobs-light.png"));
        o.OutputFor("dark", "png").Should().Be(Path.Combine("/tmp/d", "two-jobs-dark.png"));
    }

    [Fact]
    public void The_format_drives_the_extension_not_the_name_that_was_passed()
    {
        var o = Parse("--workspace", "/tmp/ws", "--view", "v1", "--out", "/tmp/d/x.png", "--format", "png,svg");
        o.OutputFor("light", "svg").Should().EndWith(".svg");
    }

    [Fact]
    public void Timeout_is_bounded_so_a_typo_cannot_hang_a_build_forever()
    {
        Parse([.. Minimal, "--timeout", "100000"]).TimeoutSeconds.Should().BeLessThanOrEqualTo(600);
        Parse([.. Minimal, "--timeout", "1"]).TimeoutSeconds.Should().BeGreaterThanOrEqualTo(5);
    }

    [Fact]
    public void Usage_documents_every_option_the_parser_accepts()
    {
        // The usage text is the whole discovery surface for anyone who is not reading this file.
        foreach (var flag in new[] { "--workspace", "--view", "--out", "--profile", "--palette", "--theme", "--format", "--opaque", "--scale", "--pad", "--timeout" })
            RenderOptions.Usage.Should().Contain(flag);
    }
}
