using System.Text.Json;
using FluentAssertions;
using Xunit;

namespace Stemma.Cli.Tests;

/// <summary>
/// `stemma scan`, run as the shipped command from a directory that is not the one scanned. It is what
/// an agent reads to start a model from the code, so it has to be the graph conformance compares with:
/// every project, every reference, an external one kept and said to be.
/// </summary>
public sealed class ScanCommandTests : IDisposable
{
    private readonly string _dir = Directory.CreateDirectory(
        Path.Combine(Path.GetTempPath(), $"stemma-scan-{Guid.NewGuid():N}")).FullName;

    public void Dispose() => Directory.Delete(_dir, recursive: true);

    private void Write(string relative, string content)
    {
        var path = Path.Combine(_dir, relative);
        Directory.CreateDirectory(Path.GetDirectoryName(path)!);
        File.WriteAllText(path, content);
    }

    private string Tree()
    {
        Write("repo/src/Shop.Api/Shop.Api.csproj", """
            <Project Sdk="Microsoft.NET.Sdk.Web">
              <PropertyGroup><TargetFramework>net8.0</TargetFramework></PropertyGroup>
              <ItemGroup>
                <ProjectReference Include="..\Shop.Core\Shop.Core.csproj" />
                <ProjectReference Include="..\..\..\vendor\Payments.Client\Payments.Client.csproj" />
              </ItemGroup>
            </Project>
            """);
        Write("repo/src/Shop.Core/Shop.Core.csproj", """
            <Project Sdk="Microsoft.NET.Sdk">
              <PropertyGroup><TargetFrameworks>net8.0;netstandard2.0</TargetFrameworks></PropertyGroup>
            </Project>
            """);
        Write("repo/src/Shop.Core/obj/Shop.Core.csproj.nuget.g.csproj", "<Project />");
        Write("vendor/Payments.Client/Payments.Client.csproj", "<Project Sdk=\"Microsoft.NET.Sdk\" />");
        return Path.Combine(_dir, "repo", "src");
    }

    private (int ExitCode, string Output, string Error) Stemma(params string[] args)
    {
        var psi = SiblingProgram.StartInfo(Path.Combine(AppContext.BaseDirectory, "stemma.dll"));
        psi.RedirectStandardOutput = true;
        psi.RedirectStandardError = true;
        psi.WorkingDirectory = _dir;
        foreach (var a in args) psi.ArgumentList.Add(a);
        using var p = System.Diagnostics.Process.Start(psi)!;
        var error = p.StandardError.ReadToEndAsync();
        var output = p.StandardOutput.ReadToEnd();
        p.WaitForExit();
        return (p.ExitCode, output.Trim(), error.Result.Trim());
    }

    [Fact]
    public void The_json_lists_each_project_and_its_references_an_external_one_marked()
    {
        var src = Tree();

        var (exit, output, _) = Stemma("scan", src, "--json");

        exit.Should().Be(0);
        using var json = JsonDocument.Parse(output);
        var root = json.RootElement;
        root.GetProperty("root").GetString().Should().Be(src);
        var projects = root.GetProperty("projects").EnumerateArray().ToList();
        projects.Select(p => p.GetProperty("name").GetString()).Should().Equal("Shop.Api", "Shop.Core");

        var api = projects[0];
        api.GetProperty("path").GetString().Should().Be("Shop.Api/Shop.Api.csproj");
        api.GetProperty("sdk").GetString().Should().Be("Microsoft.NET.Sdk.Web");
        api.GetProperty("outputType").GetString().Should().Be("Exe");
        api.GetProperty("targetFrameworks").EnumerateArray().Select(f => f.GetString()).Should().Equal("net8.0");
        api.GetProperty("references").EnumerateArray()
            .Select(r => (r.GetProperty("name").GetString(), r.GetProperty("path").GetString(), r.GetProperty("external").GetBoolean()))
            .Should().Equal(
                ("Shop.Core", "Shop.Core/Shop.Core.csproj", false),
                ("Payments.Client", "../../vendor/Payments.Client/Payments.Client.csproj", true));
        api.GetProperty("problem").ValueKind.Should().Be(JsonValueKind.Null);

        projects[1].GetProperty("outputType").GetString().Should().Be("Library");
        projects[1].GetProperty("targetFrameworks").EnumerateArray().Select(f => f.GetString()).Should().Equal("net8.0", "netstandard2.0");
    }

    [Fact]
    public void The_text_lists_each_project_with_its_references_under_it()
    {
        var src = Tree();

        var (exit, output, _) = Stemma("scan", src);

        exit.Should().Be(0);
        var lines = output.Split('\n').Select(l => l.TrimEnd()).ToList();
        lines[0].Should().Be($"stemma scan: 2 project(s) under {src}");
        lines.Should().Contain(l => l.StartsWith("  Shop.Api ") && l.Contains("Exe") && l.Contains("net8.0") && l.EndsWith("Shop.Api/Shop.Api.csproj"));
        lines.Should().Contain("    -> Shop.Core");
        lines.Should().Contain("    -> Payments.Client  (external: ../../vendor/Payments.Client/Payments.Client.csproj)");
        lines.Should().Contain(l => l.StartsWith("  Shop.Core ") && l.Contains("net8.0;netstandard2.0"));
    }

    [Fact]
    public void A_folder_with_no_projects_says_so_and_succeeds()
    {
        Directory.CreateDirectory(Path.Combine(_dir, "empty"));

        var (exit, output, _) = Stemma("scan", "empty");

        exit.Should().Be(0);
        output.Should().Be($"stemma scan: no projects under {Path.Combine(_dir, "empty")}");
    }

    [Fact]
    public void A_path_that_does_not_exist_or_a_wrong_command_line_exits_two()
    {
        Stemma("scan", "nowhere").Should().Match<(int ExitCode, string Output, string Error)>(r => r.ExitCode == 2 && r.Error.Contains("no such folder"));
        Stemma("scan", "--xml").ExitCode.Should().Be(2);
        Stemma("scan", "a", "b").ExitCode.Should().Be(2);
    }

    [Fact]
    public void Scan_is_one_of_the_commands_the_root_usage_lists()
    {
        Stemma("--help").Output.Should().Contain("stemma scan");
        Stemma("scan", "--help").Output.Should().StartWith("stemma scan —");
    }
}
