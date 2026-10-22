using FluentAssertions;
using Microsoft.CodeAnalysis.CSharp;
using Stemma.Engine.ArchModel;
using Stemma.Engine.Conformance;
using Stemma.Engine.Validation;
using Xunit;

namespace Stemma.Engine.Tests;

/// <summary>
/// The model against the code it describes (F-025): a temporary tree of three projects — Orders, which
/// references Dispatch and Shared; Dispatch, a web project; Shared, which references a library outside
/// the tree — and a workspace beside them that maps its containers onto them.
/// </summary>
public sealed class ConformanceTests : IDisposable
{
    private readonly string _root = Directory.CreateDirectory(
        Path.Combine(Path.GetTempPath(), $"stemma-conformance-{Guid.NewGuid():N}")).FullName;

    private string Src => Path.Combine(_root, "src");
    private string Workspace => Path.Combine(_root, "workspace");

    public ConformanceTests()
    {
        Write("src/Directory.Build.props", "<Project><PropertyGroup><TargetFramework>net10.0</TargetFramework></PropertyGroup></Project>");
        Write("src/Orders/Orders.csproj", """
            <Project Sdk="Microsoft.NET.Sdk">
              <PropertyGroup>
                <OutputType>Exe</OutputType>
                <TargetFrameworks>net8.0;net10.0</TargetFrameworks>
              </PropertyGroup>
              <ItemGroup>
                <ProjectReference Include="..\Dispatch\Dispatch.csproj" />
                <ProjectReference Include="../Shared/Shared.csproj" Condition="'$(Configuration)' == 'Debug'" />
              </ItemGroup>
            </Project>
            """);
        Write("src/Dispatch/Dispatch.csproj", """
            <Project Sdk="Microsoft.NET.Sdk.Web">
              <PropertyGroup><TargetFramework>net8.0</TargetFramework></PropertyGroup>
            </Project>
            """);
        Write("src/Shared/Shared.csproj", """
            <Project Sdk="Microsoft.NET.Sdk">
              <ItemGroup><ProjectReference Include="..\..\vendor\Lib\Lib.csproj" /></ItemGroup>
            </Project>
            """);
        Write("vendor/Lib/Lib.csproj", "<Project Sdk=\"Microsoft.NET.Sdk\" />");
        Write("src/Shared/bin/Debug/Stale.csproj", "<Project />");
        Write("src/Shared/obj/Shared.csproj.nuget.g.csproj", "<Project />");
        Write("src/.idea/Hidden.csproj", "<Project />");
    }

    public void Dispose() => Directory.Delete(_root, recursive: true);

    private void Write(string relative, string content)
    {
        var path = Path.Combine(_root, relative);
        Directory.CreateDirectory(Path.GetDirectoryName(path)!);
        File.WriteAllText(path, content);
    }

    // ---- ProjectGraph ------------------------------------------------------------------------------

    [Fact]
    public void Projects_are_found_under_a_folder_and_never_in_build_output_or_a_dot_folder()
    {
        var graph = ProjectGraph.Read(Src);

        graph.Root.Should().Be(Src);
        graph.Projects.Select(p => p.Name).Should().Equal("Dispatch", "Orders", "Shared");
    }

    [Fact]
    public void A_project_says_its_sdk_output_frameworks_and_references_resolved_against_its_own_folder()
    {
        var projects = ProjectGraph.Read(Src).Projects.ToDictionary(p => p.Name);

        projects["Orders"].Should().BeEquivalentTo(new
        {
            Sdk = "Microsoft.NET.Sdk",
            OutputType = "Exe",
            TargetFrameworks = new[] { "net8.0", "net10.0" },
            Problem = (string?)null,
        });
        projects["Orders"].References.Should().BeEquivalentTo(new[]
        {
            new ProjectReferenceInfo(@"..\Dispatch\Dispatch.csproj", Path.Combine(Src, "Dispatch", "Dispatch.csproj"), false),
            new ProjectReferenceInfo("../Shared/Shared.csproj", Path.Combine(Src, "Shared", "Shared.csproj"), false),
        }, options => options.WithStrictOrdering(), "a conditional reference counts: conditions are not evaluated");

        projects["Dispatch"].Should().BeEquivalentTo(new { Sdk = "Microsoft.NET.Sdk.Web", OutputType = "Exe", TargetFrameworks = new[] { "net8.0" } },
            "a web project is an executable without saying so");
        projects["Shared"].Should().BeEquivalentTo(new { OutputType = "Library", TargetFrameworks = new[] { "net10.0" } },
            "a project naming no framework takes the one Directory.Build.props names");
    }

    [Fact]
    public void A_reference_to_a_project_outside_the_tree_is_kept_and_marked_external()
    {
        var shared = ProjectGraph.Read(Src).Projects.Single(p => p.Name == "Shared");

        shared.References.Should().ContainSingle().Which.Should().Be(
            new ProjectReferenceInfo(@"..\..\vendor\Lib\Lib.csproj", Path.Combine(_root, "vendor", "Lib", "Lib.csproj"), true));
    }

    [Fact]
    public void A_project_in_the_old_format_is_read_through_its_namespace()
    {
        Write("src/Legacy/Legacy.csproj", """
            <?xml version="1.0" encoding="utf-8"?>
            <Project ToolsVersion="15.0" xmlns="http://schemas.microsoft.com/developer/msbuild/2003">
              <PropertyGroup><OutputType>WinExe</OutputType><TargetFrameworkVersion>v4.8</TargetFrameworkVersion></PropertyGroup>
              <ItemGroup><ProjectReference Include="..\Shared\Shared.csproj"><Project>{guid}</Project></ProjectReference></ItemGroup>
            </Project>
            """);

        var legacy = ProjectGraph.Read(Src).Projects.Single(p => p.Name == "Legacy");

        legacy.OutputType.Should().Be("WinExe");
        legacy.References.Select(r => r.Path).Should().Equal(Path.Combine(Src, "Shared", "Shared.csproj"));
    }

    [Fact]
    public void A_project_file_that_is_not_XML_says_why_rather_than_being_skipped()
    {
        Write("src/Broken/Broken.csproj", "<Project><ItemGroup>");

        var broken = ProjectGraph.Read(Src).Projects.Single(p => p.Name == "Broken");

        broken.Problem.Should().StartWith("not readable as a project file");
        broken.References.Should().BeEmpty();
    }

    [Fact]
    public void A_project_file_is_parsed_again_only_when_its_time_or_length_changes()
    {
        var path = Path.Combine(Src, "Dispatch", "Dispatch.csproj");
        ProjectGraph.ReadProject(path).References.Should().BeEmpty();
        var written = File.GetLastWriteTimeUtc(path);

        // Same length, same time: the poll must not parse it again, so it still reads as it was.
        var same = File.ReadAllText(path).Replace("net8.0", "net9.0");
        File.WriteAllText(path, same);
        File.SetLastWriteTimeUtc(path, written);
        ProjectGraph.ReadProject(path).TargetFrameworks.Should().Equal("net8.0");

        File.SetLastWriteTimeUtc(path, written.AddSeconds(5));
        ProjectGraph.ReadProject(path).TargetFrameworks.Should().Equal("net9.0");
    }

    // ---- ConformanceCheck --------------------------------------------------------------------------

    private static ArchModel.ArchModel Model(string links) => C4Model.Read($$"""
        using Stemma.Model;
        public static class Architecture
        {
            public static Model Build()
            {
                var shop = new SoftwareSystem("sys_shop", "Shop");
                var orders = new Container("cnt_orders", "Orders", "sys_shop");
                var dispatch = new Container("cnt_dispatch", "Dispatch", "sys_shop");
                var shared = new Container("cnt_shared", "Shared", "sys_shop");
                {{links}}
                return Model.Of();
            }
        }
        """);

    private const string Mapped = """
                Code.At("../src"),
                Code.Map("cnt_orders", "Orders/Orders.csproj"),
                Code.Map("cnt_dispatch", "Dispatch"),
                Code.Map("cnt_shared", "Shared")
        """;

    private DeclaredRules Declare(string body) =>
        DeclaredRules.ReadFrom(Workspace, [(Path.Combine(Workspace, "Rules", "Code.cs"), CSharpSyntaxTree.ParseText($$"""
            using Stemma.Model;
            public static class Code
            {
                public static RuleSet Define() => RuleSet.Of(
            {{body}});
            }
            """).GetRoot())]);

    private IReadOnlyList<Violation> Check(string links, string body = Mapped)
    {
        Directory.CreateDirectory(Workspace);
        return ConformanceCheck.Run(Model(links), Workspace, Declare(body));
    }

    [Fact]
    public void A_reference_the_model_does_not_declare_is_an_undeclared_dependency_naming_both_projects()
    {
        var violations = Check("""var save = new DataFlow("flow_shared", "cnt_orders", "cnt_shared", "orders");""");

        var undeclared = violations.Should().ContainSingle(v => v.RuleId == ConformanceCheck.UndeclaredDependency).Subject;
        undeclared.Severity.Should().Be(Severity.Warning);
        undeclared.ElementIds.Should().Equal("cnt_orders", "cnt_dispatch");
        undeclared.Message.Should().Be(
            "Orders references Dispatch (Orders/Orders.csproj → Dispatch/Dispatch.csproj), so cnt_orders depends on cnt_dispatch in the code, " +
            "and the model has no data flow or dependency from cnt_orders to cnt_dispatch");
    }

    [Fact]
    public void A_data_flow_or_a_dependency_declares_the_relationship()
    {
        Check("""
                var call = new DataFlow("flow_dispatch", "cnt_orders", "cnt_dispatch", "jobs");
                var uses = new Dependency("dep_shared", "cnt_orders", "cnt_shared");
        """).Should().BeEmpty();
    }

    [Fact]
    public void A_relation_or_a_link_the_other_way_does_not_declare_it()
    {
        Check("""
                var said = new Relation("rel_dispatch", "cnt_orders", "cnt_dispatch", "talks to");
                var back = new Dependency("dep_back", "cnt_shared", "cnt_orders");
                var flow = new DataFlow("flow_shared", "cnt_orders", "cnt_shared", "orders");
        """).Where(v => v.RuleId == ConformanceCheck.UndeclaredDependency).SelectMany(v => v.ElementIds)
            .Should().Equal("cnt_orders", "cnt_dispatch");
    }

    [Fact]
    public void A_dependency_no_project_reference_realises_is_unrealised_and_a_data_flow_never_is()
    {
        var violations = Check("""
                var call = new DataFlow("flow_dispatch", "cnt_orders", "cnt_dispatch", "jobs");
                var uses = new Dependency("dep_shared", "cnt_orders", "cnt_shared");
                var claim = new Dependency("dep_dispatch_shared", "cnt_dispatch", "cnt_shared", "reads");
                var http = new DataFlow("flow_back", "cnt_dispatch", "cnt_orders", "status");
        """);

        var unrealised = violations.Should().ContainSingle().Subject;
        unrealised.RuleId.Should().Be(ConformanceCheck.UnrealisedDependency);
        unrealised.Severity.Should().Be(Severity.Info);
        unrealised.LinkIds.Should().Equal("dep_dispatch_shared");
        unrealised.Message.Should().Be(
            "dependency dep_dispatch_shared says cnt_dispatch depends on cnt_shared, and no project of cnt_dispatch (Dispatch) references a project of cnt_shared (Shared)");
    }

    [Fact]
    public void A_path_that_does_not_exist_or_holds_no_project_is_missing_code()
    {
        Directory.CreateDirectory(Path.Combine(Src, "Empty"));
        Write("src/Notes.txt", "not a project");

        var violations = Check("", """
                Code.At("../src"),
                Code.Map("cnt_orders", "Ordrs"),
                Code.Map("cnt_dispatch", "Empty"),
                Code.Map("cnt_shared", "Notes.txt")
        """).Where(v => v.RuleId == ConformanceCheck.MissingCode).ToList();

        violations.Should().HaveCount(3).And.OnlyContain(v => v.Severity == Severity.Error);
        violations[0].Message.Should().Be("Rules/Code.cs:6: Code.Map(\"cnt_orders\", \"Ordrs\") points at Ordrs, which does not exist, so cnt_orders is compared with no code");
        violations[0].ElementIds.Should().Equal("cnt_orders");
        violations[1].Message.Should().Contain("points at Empty, which holds no project");
        violations[2].Message.Should().Contain("points at Notes.txt, which is a file but not a project file");

        var nowhere = Check("", """Code.At("../nowhere"), Code.Map("cnt_orders", "Orders")""");
        nowhere.Should().ContainSingle().Which.Message.Should().StartWith("Rules/Code.cs:5: Code.At(\"../nowhere\") is ").And.EndWith("which does not exist, so no code is compared with the model");
    }

    [Fact]
    public void A_project_mapped_to_two_elements_is_ambiguous_and_compared_for_neither()
    {
        var violations = Check("", """
                Code.At("../src"),
                Code.Map("cnt_orders", "Orders"),
                Code.Map("cnt_dispatch", "Orders/Orders.csproj"),
                Code.Map("cnt_shared", "Shared")
        """);

        violations.Should().ContainSingle(v => v.RuleId == ConformanceCheck.AmbiguousMap).Which.Should().BeEquivalentTo(new
        {
            Severity = Severity.Warning,
            ElementIds = new[] { "cnt_orders", "cnt_dispatch" },
            Message = "Orders/Orders.csproj is mapped to cnt_orders and cnt_dispatch, so its references are compared for neither; map it to one",
        });
        violations.Should().NotContain(v => v.RuleId == ConformanceCheck.UndeclaredDependency);
    }

    [Fact]
    public void Projects_nothing_maps_are_named_ten_at_most_and_then_counted()
    {
        for (var i = 1; i <= 12; i++) Write($"src/Tools/Tool{i:00}/Tool{i:00}.csproj", "<Project />");

        var unmapped = Check("""
                var call = new DataFlow("flow_dispatch", "cnt_orders", "cnt_dispatch", "jobs");
                var uses = new Dependency("dep_shared", "cnt_orders", "cnt_shared");
        """).Should().ContainSingle().Subject;

        unmapped.RuleId.Should().Be(ConformanceCheck.UnmappedProject);
        unmapped.Severity.Should().Be(Severity.Info);
        unmapped.Message.Should().Be(
            "12 project(s) under Code.At(\"../src\") are mapped to no element: Tools/Tool01/Tool01.csproj, Tools/Tool02/Tool02.csproj, " +
            "Tools/Tool03/Tool03.csproj, Tools/Tool04/Tool04.csproj, Tools/Tool05/Tool05.csproj, Tools/Tool06/Tool06.csproj, " +
            "Tools/Tool07/Tool07.csproj, Tools/Tool08/Tool08.csproj, Tools/Tool09/Tool09.csproj, Tools/Tool10/Tool10.csproj, and 2 more");
    }

    [Fact]
    public void Unmapped_projects_are_not_listed_while_a_map_points_at_nothing()
    {
        Write("src/Tools/Tool/Tool.csproj", "<Project />");

        Check("", """Code.At("../src"), Code.Map("cnt_orders", "Gone")""")
            .Should().ContainSingle().Which.RuleId.Should().Be(ConformanceCheck.MissingCode);
    }

    [Fact]
    public void A_map_naming_an_element_that_is_not_there_is_left_to_rule_dangling_id()
    {
        Check("""
                var call = new DataFlow("flow_dispatch", "cnt_orders", "cnt_dispatch", "jobs");
                var uses = new Dependency("dep_shared", "cnt_orders", "cnt_shared");
        """, Mapped + """
                ,
                Code.Map("cnt_ghost", "Nowhere")
        """).Should().BeEmpty();
    }

    [Fact]
    public void Conformance_runs_through_the_rule_engine_and_stemma_rules_json_quietens_it_by_id()
    {
        Write("workspace/Architecture/Architecture.cs", """
            using Stemma.Model;
            public static class Architecture
            {
                public static Model Build()
                {
                    var shop = new SoftwareSystem("sys_shop", "Shop");
                    var orders = new Container("cnt_orders", "Orders", "sys_shop");
                    var dispatch = new Container("cnt_dispatch", "Dispatch", "sys_shop");
                    var shared = new Container("cnt_shared", "Shared", "sys_shop");
                    return Model.Of(shop, orders, dispatch, shared);
                }
            }
            """);
        Write("workspace/Rules/Code.cs", $$"""
            using Stemma.Model;
            public static class Code
            {
                public static RuleSet Define() => RuleSet.Of(
            {{Mapped}});
            }
            """);
        Write("workspace/stemma.rules.json", """{ "rules": { "conformance/undeclared-dependency": { "severity": "error" } } }""");
        var model = ArchModelMerge.ReadFrom(Workspace).Model!;

        var violations = RuleEngine.Default(Workspace).Run(model);

        violations.Where(v => v.RuleId == ConformanceCheck.UndeclaredDependency).Should().HaveCount(2)
            .And.OnlyContain(v => v.Severity == Severity.Error);
        violations.Should().NotContain(v => v.RuleId == ConformanceCheck.UnmappedProject);
    }
}
