using System.Text.Json;
using FluentAssertions;
using Xunit;

namespace Stemma.Cli.Tests;

/// <summary>
/// `stemma validate` as it is typed: run as the shipped command, from a directory that is not the
/// workspace, so a command that quietly checks the current directory instead cannot pass.
/// </summary>
public sealed class ValidateCommandTests : IDisposable
{
    private readonly string _dir = Directory.CreateDirectory(
        Path.Combine(Path.GetTempPath(), $"stemma-validate-{Guid.NewGuid():N}")).FullName;

    public void Dispose() => Directory.Delete(_dir, recursive: true);

    private string Elsewhere => Directory.CreateDirectory(Path.Combine(_dir, "elsewhere")).FullName;

    private string Workspace(string name = "model")
    {
        var root = Path.Combine(_dir, name);
        Directory.CreateDirectory(Path.Combine(root, "Architecture"));
        File.WriteAllText(Path.Combine(root, "Architecture", "Architecture.cs"), """
            using Stemma.Model;
            namespace Probe;
            public static class Architecture
            {
                public static Model Build()
                {
                    var a = new Module("mod_a", "A");
                    return Model.Of(a);
                }
            }
            """);
        return root;
    }

    private (int ExitCode, string Output, string Error) Stemma(params string[] args)
    {
        var psi = SiblingProgram.StartInfo(Path.Combine(AppContext.BaseDirectory, "stemma.dll"));
        psi.RedirectStandardOutput = true;
        psi.RedirectStandardError = true;
        psi.WorkingDirectory = Elsewhere;
        foreach (var a in args) psi.ArgumentList.Add(a);
        using var p = System.Diagnostics.Process.Start(psi)!;
        var error = p.StandardError.ReadToEndAsync();
        var output = p.StandardOutput.ReadToEnd();
        p.WaitForExit();
        return (p.ExitCode, output.Trim(), error.Result.Trim());
    }

    [Fact]
    public void A_workspace_given_as_a_bare_path_is_the_one_checked()
    {
        // `stemma validate <path>` checked the current directory and reported it was no workspace.
        var root = Workspace();

        var (exit, output, _) = Stemma("validate", root, "--json");

        exit.Should().Be(0);
        using var json = JsonDocument.Parse(output);
        json.RootElement.GetProperty("workspace").GetString().Should().Be(root);
    }

    [Fact]
    public void Two_different_workspaces_are_a_mistake_on_the_command_line()
    {
        var (exit, _, error) = Stemma("validate", Workspace("one"), "--workspace", Workspace("two"));

        exit.Should().Be(2);
        error.Should().Contain("two workspaces");
    }

    [Fact]
    public void The_same_workspace_given_both_ways_is_fine()
    {
        var root = Workspace();

        Stemma("validate", root, "--workspace", root + Path.DirectorySeparatorChar).ExitCode.Should().Be(0);
    }

    [Fact]
    public void A_second_bare_argument_is_refused_rather_than_ignored()
    {
        var (exit, _, error) = Stemma("validate", Workspace(), "extra");

        exit.Should().Be(2);
        error.Should().Contain("'extra'");
    }
}
