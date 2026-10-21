using FluentAssertions;
using Stemma.Cli;
using Xunit;

namespace Stemma.Cli.Tests;

/// <summary>
/// The host a render starts is a private one, gone when the render is done. Nothing it does may show
/// up in the person's own Stemma: it used to put every workspace it rendered at the top of their
/// recent list, as if they had opened it.
/// </summary>
public sealed class HostProcessTests
{
    [Fact]
    public void The_host_a_render_starts_keeps_nothing_in_the_recent_list()
    {
        var psi = HostProcess.StartInfo(Path.Combine(Path.GetTempPath(), "Stemma.Web.dll"), "/content", "http://127.0.0.1:5399");

        var args = psi.ArgumentList.ToList();
        args.Should().Contain("--recents");
        args[args.IndexOf("--recents") + 1].Should().Be("off");
    }
}
