using FluentAssertions;
using Stemma.Desktop;
using Xunit;

namespace Stemma.Desktop.Tests;

/// <summary>
/// F-002 AC5 — <c>--workspace &lt;path&gt;</c> opens that workspace directly, which is what lets a
/// <c>.desktop</c> entry register Stemma as a folder handler later.
/// </summary>
public class DesktopOptionsTests
{
    [Fact]
    public void Takes_a_workspace_to_open()
    {
        var options = DesktopOptions.Parse(["--workspace", "/home/someone/models/payments"]);

        options.WorkspacePath.Should().Be("/home/someone/models/payments");
    }

    [Fact]
    public void Resolves_a_relative_workspace_against_the_shell_that_launched_it()
    {
        // A folder handler passes what it has; by the time the window is up, the working directory
        // is no longer evidence of anything.
        var options = DesktopOptions.Parse(["--workspace", "."]);

        options.WorkspacePath.Should().Be(Path.GetFullPath("."));
    }

    [Fact]
    public void Takes_a_bare_path_too()
    {
        // What a `.desktop` entry's %f expands to when Stemma is registered as a folder handler,
        // and what anyone types by hand.
        DesktopOptions.Parse(["/home/someone/models/payments"])
            .WorkspacePath.Should().Be("/home/someone/models/payments");
    }

    [Fact]
    public void Does_not_mistake_a_flags_value_for_a_workspace()
    {
        var options = DesktopOptions.Parse(["--log-level", "debug"]);

        options.WorkspacePath.Should().BeNull();
        options.HostArgs.Should().Equal("--log-level", "debug");
    }

    [Fact]
    public void A_bare_path_after_a_flag_and_its_value_is_still_a_workspace()
    {
        var options = DesktopOptions.Parse(["--log-level", "debug", "/home/someone/m"]);

        options.WorkspacePath.Should().Be("/home/someone/m");
        options.HostArgs.Should().Equal("--log-level", "debug");
    }

    [Fact]
    public void An_explicit_workspace_flag_wins_over_a_stray_argument()
    {
        var options = DesktopOptions.Parse(["--workspace", "/chosen", "/stray"]);

        options.WorkspacePath.Should().Be("/chosen");
        options.HostArgs.Should().Equal("/stray");
    }

    [Fact]
    public void Hands_everything_it_does_not_know_to_the_backend()
    {
        var options = DesktopOptions.Parse(["--log-level", "debug", "--workspace", "/tmp/m", "--log-format", "json"]);

        options.HostArgs.Should().Equal("--log-level", "debug", "--log-format", "json");
        options.WorkspacePath.Should().Be("/tmp/m");
    }

    [Fact]
    public void A_dangling_workspace_flag_is_passed_on_rather_than_swallowed()
    {
        // Better a host that reports an unknown switch than a silent no-op.
        var options = DesktopOptions.Parse(["--workspace"]);

        options.WorkspacePath.Should().BeNull();
        options.HostArgs.Should().Equal("--workspace");
    }

    [Theory]
    [InlineData("-h")]
    [InlineData("--help")]
    [InlineData("help")]
    public void Asks_for_help(string flag)
    {
        DesktopOptions.Parse([flag]).ShowHelp.Should().BeTrue();
    }

    [Fact]
    public void Asks_for_the_version()
    {
        var options = DesktopOptions.Parse(["--version"]);

        options.ShowVersion.Should().BeTrue();
        options.HostArgs.Should().BeEmpty("the host is never started to answer it");
    }

    [Fact]
    public void No_arguments_just_opens_the_window()
    {
        var options = DesktopOptions.Parse([]);

        options.ShowHelp.Should().BeFalse();
        options.ShowVersion.Should().BeFalse();
        options.WorkspacePath.Should().BeNull();
        options.HostArgs.Should().BeEmpty();
    }

    [Fact]
    public void Usage_names_the_flags_it_parses()
    {
        DesktopOptions.Usage.Should().Contain("--workspace");
    }
}
