using System.Runtime.CompilerServices;
using FluentAssertions;
using Stemma.Cli;
using Xunit;

namespace Stemma.Cli.Tests;

/// <summary>
/// Ids in flows, dependencies, `AboutId` and views are strings that nothing verifies. These tests
/// are about the failures that are *silent*: a diagram that renders successfully and is missing the
/// element or the arrow the author believes is there. An agent never sees the picture, so a check
/// that only reports crashes would report nothing at all.
/// </summary>
public sealed class WorkspaceCheckTests : IDisposable
{
    private readonly string _root = Directory.CreateDirectory(
        Path.Combine(Path.GetTempPath(), $"stemma-check-{Guid.NewGuid():N}")).FullName;

    public void Dispose() => Directory.Delete(_root, recursive: true);

    private void Model(string body)
    {
        Directory.CreateDirectory(Path.Combine(_root, "Architecture"));
        File.WriteAllText(Path.Combine(_root, "Architecture", "Architecture.cs"), $$"""
            using Stemma.Model;
            namespace Probe;
            public static class Architecture
            {
                public static Model Build()
                {
            {{body}}
                }
            }
            """);
    }

    private void View(string name, string body)
    {
        Directory.CreateDirectory(Path.Combine(_root, "Views"));
        File.WriteAllText(Path.Combine(_root, "Views", $"{name}.cs"), $$"""
            using Stemma.Model;
            namespace Probe;
            public static class {{name}}
            {
                public static View Define() => {{body}};
            }
            """);
    }

    private IReadOnlyList<CheckFinding> Run() => WorkspaceCheck.Run(_root);

    private static readonly string TwoModules = """
                    var a = new Module("mod_a", "A");
                    var b = new Module("mod_b", "B");
                    return Model.Of(a, b);
        """;

    [Fact]
    public void A_directory_that_is_not_a_workspace_says_so_rather_than_reporting_nothing_wrong()
    {
        Run().Should().ContainSingle(f => f.Rule == "workspace/no-model" && f.Severity == CheckSeverity.Error);
    }

    [Fact]
    public void A_model_with_no_Build_method_is_an_error_naming_what_the_engine_looks_for()
    {
        Directory.CreateDirectory(Path.Combine(_root, "Architecture"));
        File.WriteAllText(Path.Combine(_root, "Architecture", "Architecture.cs"), "public static class Architecture { }");
        Run().Should().Contain(f => f.Rule == "model/unreadable");
    }

    [Fact]
    public void A_clean_workspace_reports_nothing()
    {
        Model(TwoModules);
        Run().Where(f => f.Severity == CheckSeverity.Error).Should().BeEmpty();
    }

    [Fact]
    public void A_link_to_an_id_that_does_not_exist_is_an_error_because_the_edge_silently_vanishes()
    {
        Model("""
                    var a = new Module("mod_a", "A");
                    var f = new DataFlow("flow_1", "mod_a", "mod_ghost", "payload");
                    return Model.Of(a, f);
        """);
        Run().Should().Contain(f => f.Rule == "link/dangling-endpoint" && f.Message.Contains("mod_ghost"));
    }

    [Fact]
    public void A_dangling_contextId_is_an_error()
    {
        Model("""
                    var a = new Module("mod_a", "A", "ctx_ghost");
                    return Model.Of(a);
        """);
        Run().Should().Contain(f => f.Rule == "element/dangling-reference" && f.Message.Contains("ctx_ghost"));
    }

    [Fact]
    public void A_dangling_aboutId_is_an_error_too()
    {
        Model("""
                    var q = new Question("q_1", "Why?", "mod_ghost");
                    return Model.Of(q);
        """);
        Run().Should().Contain(f => f.Rule == "element/dangling-reference" && f.Message.Contains("mod_ghost"));
    }

    [Fact]
    public void A_duplicate_id_is_an_error_because_which_one_wins_is_arbitrary()
    {
        Model("""
                    var a = new Module("mod_a", "A");
                    var b = new Module("mod_a", "Also A");
                    return Model.Of(a, b);
        """);
        Run().Should().Contain(f => f.Rule == "model/duplicate-id");
    }

    [Fact]
    public void A_view_naming_an_element_that_does_not_exist_is_an_error()
    {
        Model(TwoModules);
        View("Broken", """new(Id: "view_broken", Name: "Broken", BaseView: "all", ElementIds: new[] { "mod_a", "mod_ghost" })""");
        Run().Should().Contain(f => f.Rule == "view/dangling-member" && f.Message.Contains("mod_ghost"));
    }

    [Fact]
    public void A_view_that_resolves_to_nothing_is_an_error_not_a_shrug()
    {
        // Rendering it would report "empty", which is correct but late: the workspace is wrong now.
        Model(TwoModules);
        View("Nothing", """new(Id: "view_nothing", Name: "Nothing", BaseView: "all", ElementIds: new[] { "mod_ghost" })""");
        Run().Should().Contain(f => f.Rule == "view/empty");
    }

    [Fact]
    public void A_view_with_one_end_of_a_link_is_reported_as_a_note()
    {
        // The diagram renders happily and is missing an arrow the author believes is there. Not an
        // error — it is often deliberate — but never something to discover from the picture.
        Model("""
                    var a = new Module("mod_a", "A");
                    var b = new Module("mod_b", "B");
                    var f = new DataFlow("flow_1", "mod_a", "mod_b", "payload");
                    return Model.Of(a, b, f);
        """);
        View("Half", """new(Id: "view_half", Name: "Half", BaseView: "all", ElementIds: new[] { "mod_a" })""");
        Run().Should().Contain(f => f.Rule == "view/half-link" && f.Severity == CheckSeverity.Info);
    }

    [Fact]
    public void A_crowded_view_is_a_warning_rather_than_an_error()
    {
        var ids = string.Join("\n", Enumerable.Range(0, WorkspaceCheck.BusyViewThreshold + 2)
            .Select(i => $"            var m{i} = new Module(\"mod_{i}\", \"M{i}\");"));
        var all = string.Join(", ", Enumerable.Range(0, WorkspaceCheck.BusyViewThreshold + 2).Select(i => $"m{i}"));
        Model($"{ids}\n            return Model.Of({all});");
        View("Busy", $$"""new(Id: "view_busy", Name: "Busy", BaseView: "all", ElementIds: new[] { {{string.Join(", ", Enumerable.Range(0, WorkspaceCheck.BusyViewThreshold + 2).Select(i => $"\"mod_{i}\""))}} })""");

        var findings = Run();
        findings.Should().Contain(f => f.Rule == "view/busy" && f.Severity == CheckSeverity.Warning);
        findings.Where(f => f.Severity == CheckSeverity.Error).Should().BeEmpty("being busy is a rule of thumb, not a defect");
    }

    [Fact]
    public void Every_finding_names_its_rule_and_says_something_actionable()
    {
        // These are read by something that cannot look at the canvas, so "invalid model" is useless.
        Model("""
                    var a = new Module("mod_a", "A", "ctx_ghost");
                    return Model.Of(a);
        """);
        foreach (var f in Run())
        {
            f.Rule.Should().NotBeNullOrWhiteSpace();
            f.Rule.Should().Contain("/", "rules are namespaced so a caller can filter by area");
            f.Message.Should().NotBeNullOrWhiteSpace();
            f.Message.Length.Should().BeGreaterThan(20);
        }
    }
}
