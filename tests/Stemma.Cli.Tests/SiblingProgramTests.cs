using System.Runtime.InteropServices;
using FluentAssertions;
using Stemma.Cli;
using Xunit;

namespace Stemma.Cli.Tests;

/// <summary>
/// B-016. The CLI starts two programs that ship beside it — the web host for a render, the shell for
/// `stemma open` — and the right way to start them depends on how the CLI itself was shipped. The
/// tarball is self-contained and has no `dotnet` anywhere; asking PATH for one is what broke
/// `stemma render` on exactly the machine the tarball is for.
/// </summary>
public sealed class SiblingProgramTests : IDisposable
{
    private readonly string _root = Directory.CreateDirectory(
        Path.Combine(Path.GetTempPath(), $"stemma-sibling-{Guid.NewGuid():N}")).FullName;

    public void Dispose() => Directory.Delete(_root, recursive: true);

    private static string Executable(string name) => OperatingSystem.IsWindows() ? name + ".exe" : name;

    private string Touch(params string[] parts)
    {
        var path = Path.Combine([_root, .. parts]);
        Directory.CreateDirectory(Path.GetDirectoryName(path)!);
        File.WriteAllText(path, "");
        return path;
    }

    [Fact]
    public void On_a_shared_runtime_the_program_runs_on_that_runtime_not_on_whatever_PATH_finds()
    {
        var muxer = Touch("dotnet-root", Executable("dotnet"));
        var runtime = Directory.CreateDirectory(
            Path.Combine(_root, "dotnet-root", "shared", "Microsoft.NETCore.App", "10.0.0")).FullName;
        var dll = Touch("app", "Stemma.Web.dll");
        Touch("app", Executable("Stemma.Web"));

        var psi = SiblingProgram.StartInfo(dll, runtime + Path.DirectorySeparatorChar);

        psi.FileName.Should().Be(muxer);
        psi.ArgumentList.Should().Equal(dll);
    }

    [Fact]
    public void Self_contained_the_program_starts_from_its_own_executable()
    {
        var app = Path.Combine(_root, "stemma");
        var dll = Touch("stemma", "Stemma.Web.dll");
        var apphost = Touch("stemma", Executable("Stemma.Web"));

        // A self-contained app's runtime directory is the app's own folder, and it holds no muxer.
        var psi = SiblingProgram.StartInfo(dll, app + Path.DirectorySeparatorChar);

        psi.FileName.Should().Be(apphost);
        psi.ArgumentList.Should().BeEmpty();
    }

    [Fact]
    public void With_neither_it_falls_back_to_the_dotnet_on_PATH()
    {
        var dll = Touch("loose", "Stemma.Web.dll");

        var psi = SiblingProgram.StartInfo(dll, Path.Combine(_root, "loose"));

        psi.FileName.Should().Be("dotnet");
        psi.ArgumentList.Should().Equal(dll);
    }

    [Fact]
    public void A_runtime_directory_that_only_looks_shared_is_not_taken_for_one()
    {
        // `shared/<something else>/<version>` is not where a runtime lives, whatever sits two up.
        Touch("lookalike", Executable("dotnet"));
        var runtime = Directory.CreateDirectory(
            Path.Combine(_root, "lookalike", "shared", "Some.Library", "1.0.0")).FullName;
        var dll = Touch("app", "Stemma.Web.dll");
        var apphost = Touch("app", Executable("Stemma.Web"));

        SiblingProgram.StartInfo(dll, runtime).FileName.Should().Be(apphost);
    }

    [Fact]
    public void This_test_run_is_on_a_shared_runtime_and_finds_its_muxer()
    {
        var psi = SiblingProgram.StartInfo(Path.Combine(_root, "Any.dll"));

        Path.GetFileNameWithoutExtension(psi.FileName).Should().Be("dotnet");
        File.Exists(psi.FileName).Should().BeTrue(
            $"the muxer is found from {RuntimeEnvironment.GetRuntimeDirectory()}, not from PATH");
    }
}
