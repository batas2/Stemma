using System.Text.RegularExpressions;
using FluentAssertions;
using Stemma.Engine.Diagnostics;
using Xunit;

namespace Stemma.Engine.Tests;

/// <summary>
/// F-012. The version is stated once, in Directory.Build.props, and everything that reports one reads
/// it from the assembly the build stamped. A second place to state it is a second place to forget.
/// </summary>
public sealed class StemmaVersionTests
{
    private static string Stated()
    {
        var dir = new DirectoryInfo(AppContext.BaseDirectory);
        while (dir is not null && !File.Exists(Path.Combine(dir.FullName, "Directory.Build.props"))) dir = dir.Parent;
        dir.Should().NotBeNull("the tests run from inside the repository");
        var props = File.ReadAllText(Path.Combine(dir!.FullName, "Directory.Build.props"));
        return Regex.Match(props, "<VersionPrefix>([^<]+)</VersionPrefix>").Groups[1].Value;
    }

    [Fact]
    public void The_release_is_the_version_stated_in_Directory_Build_props()
    {
        Stated().Should().MatchRegex(@"^\d+\.\d+\.\d+$");
        StemmaVersion.Release.Should().Be(Stated());
    }

    [Fact]
    public void The_build_is_the_release_and_the_commit_it_was_built_from()
    {
        StemmaVersion.Build.Should().StartWith(StemmaVersion.Release);
        StemmaVersion.Build.Should().MatchRegex(@"^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?(\+[0-9a-f]{7,40})?$");
    }
}
