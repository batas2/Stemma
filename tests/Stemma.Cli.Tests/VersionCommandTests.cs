using FluentAssertions;
using Stemma.Engine.Diagnostics;
using Xunit;

namespace Stemma.Cli.Tests;

/// <summary>
/// F-012. `stemma --version` is what a bug report quotes and what the release smoke test checks
/// against the tag, so it is run as the shipped command, not called.
/// </summary>
public sealed class VersionCommandTests
{
    private static (int ExitCode, string Output) Stemma(params string[] args)
    {
        var psi = SiblingProgram.StartInfo(Path.Combine(AppContext.BaseDirectory, "stemma.dll"));
        psi.RedirectStandardOutput = true;
        foreach (var a in args) psi.ArgumentList.Add(a);
        using var p = System.Diagnostics.Process.Start(psi)!;
        var output = p.StandardOutput.ReadToEnd();
        p.WaitForExit();
        return (p.ExitCode, output.Trim());
    }

    [Fact]
    public void Prints_the_release()
    {
        var (exit, output) = Stemma("--version");

        exit.Should().Be(0);
        output.Should().Be($"stemma {StemmaVersion.Release}");
    }

    [Fact]
    public void Is_listed_in_the_usage()
    {
        Stemma("--help").Output.Should().Contain("--version");
    }
}
