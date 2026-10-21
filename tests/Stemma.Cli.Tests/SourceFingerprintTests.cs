using FluentAssertions;
using Stemma.Cli;
using Xunit;

namespace Stemma.Cli.Tests;

/// <summary>
/// The fingerprint has two jobs that pull against each other: notice when the picture has stopped
/// matching the model, and *not* notice anything else. A check that cries wolf gets turned off, and
/// a check that misses a rename is decoration.
/// </summary>
public sealed class SourceFingerprintTests : IDisposable
{
    private readonly string _root = Directory.CreateDirectory(
        Path.Combine(Path.GetTempPath(), $"stemma-fp-{Guid.NewGuid():N}")).FullName;

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

    private void View(string ids)
    {
        Directory.CreateDirectory(Path.Combine(_root, "Views"));
        File.WriteAllText(Path.Combine(_root, "Views", "V.cs"), $$"""
            using Stemma.Model;
            namespace Probe;
            public static class V
            {
                public static View Define() => new(Id: "view_v", Name: "V", BaseView: "all", ElementIds: new[] { {{ids}} });
            }
            """);
    }

    private void Sidecar(string viewBody) =>
        File.WriteAllText(Path.Combine(_root, "stemma.layout.json"),
            $$"""{ "version": 1, "views": { "custom:view_v": {{viewBody}} } }""");

    private string Hash() => SourceFingerprint.For(_root, "view_v", "publication", "dual-theme").Hash;

    private const string TwoModules = """
                    var a = new Module("mod_a", "A");
                    var b = new Module("mod_b", "B");
                    return Model.Of(a, b);
        """;

    private void Baseline()
    {
        Model(TwoModules);
        View("\"mod_a\", \"mod_b\"");
    }

    [Fact]
    public void The_same_inputs_give_the_same_value()
    {
        Baseline();
        Hash().Should().Be(Hash());
    }

    [Fact]
    public void A_renamed_element_changes_it_even_though_every_count_is_unchanged()
    {
        // The case a count-based check misses entirely, and the one that most often makes a
        // published diagram wrong.
        Baseline();
        var before = Hash();
        Model(TwoModules.Replace("\"A\"", "\"A, renamed\""));
        Hash().Should().NotBe(before);
    }

    [Fact]
    public void Changing_which_elements_a_view_contains_changes_it()
    {
        Baseline();
        var before = Hash();
        View("\"mod_a\"");
        Hash().Should().NotBe(before);
    }

    [Fact]
    public void Re_pointing_a_link_changes_it()
    {
        Model("""
                    var a = new Module("mod_a", "A");
                    var b = new Module("mod_b", "B");
                    var c = new Module("mod_c", "C");
                    var f = new DataFlow("flow_1", "mod_a", "mod_b", "payload");
                    return Model.Of(a, b, c, f);
        """);
        View("\"mod_a\", \"mod_b\", \"mod_c\"");
        var before = Hash();

        Model("""
                    var a = new Module("mod_a", "A");
                    var b = new Module("mod_b", "B");
                    var c = new Module("mod_c", "C");
                    var f = new DataFlow("flow_1", "mod_a", "mod_c", "payload");
                    return Model.Of(a, b, c, f);
        """);
        Hash().Should().NotBe(before);
    }

    [Fact]
    public void Declaration_order_does_not_change_it()
    {
        // Reordering two `var` lines is not a change to the architecture, and a check that failed on
        // it would be turned off within a week.
        Baseline();
        var before = Hash();
        Model("""
                    var b = new Module("mod_b", "B");
                    var a = new Module("mod_a", "A");
                    return Model.Of(b, a);
        """);
        Hash().Should().Be(before);
    }

    [Fact]
    public void The_layout_counts_because_it_decides_where_the_boxes_are()
    {
        Baseline();
        Sidecar("""{ "nodes": { "mod_a": { "x": 0, "y": 0 } } }""");
        var before = Hash();
        Sidecar("""{ "nodes": { "mod_a": { "x": 500, "y": 0 } } }""");
        Hash().Should().NotBe(before);
    }

    [Fact]
    public void A_layout_constraint_counts_too()
    {
        Baseline();
        Sidecar("""{ "layout": { "kind": "row", "ids": ["mod_a", "mod_b"] } }""");
        var before = Hash();
        Sidecar("""{ "layout": { "kind": "column", "ids": ["mod_a", "mod_b"] } }""");
        Hash().Should().NotBe(before);
    }

    [Fact]
    public void The_profile_and_the_palette_count_because_they_change_the_ink()
    {
        Baseline();
        SourceFingerprint.For(_root, "view_v", "publication", "dual-theme").Hash
            .Should().NotBe(SourceFingerprint.For(_root, "view_v", "publication", "print").Hash);
        SourceFingerprint.For(_root, "view_v", "app", "dual-theme").Hash
            .Should().NotBe(SourceFingerprint.For(_root, "view_v", "publication", "dual-theme").Hash);
    }

    [Fact]
    public void An_unreadable_sidecar_does_not_throw_because_the_canvas_tolerates_one()
    {
        Baseline();
        File.WriteAllText(Path.Combine(_root, "stemma.layout.json"), "{ not json");
        var act = () => Hash();
        act.Should().NotThrow();
    }

    [Fact]
    public void A_workspace_with_no_model_still_produces_a_value_rather_than_failing()
    {
        var act = () => SourceFingerprint.For(_root, "view_v", "publication", "dual-theme");
        act.Should().NotThrow();
        SourceFingerprint.For(_root, "view_v", "publication", "dual-theme").Elements.Should().Be(0);
    }

    [Fact]
    public void A_change_in_any_model_file_changes_it()
    {
        // Only Architecture.cs was read, so renaming an element declared in another model file left
        // the hash alone and `render --check` called a stale picture current.
        Baseline();
        void Payments(string name) => File.WriteAllText(Path.Combine(_root, "Architecture", "Payments.cs"), $$"""
            using Stemma.Model;
            namespace Probe;
            public static class Payments
            {
                public static Model Build()
                {
                    var c = new Module("mod_c", "{{name}}");
                    return Model.Of(c);
                }
            }
            """);
        Payments("Payments");
        var before = SourceFingerprint.For(_root, "view_v", "publication", "dual-theme");

        Payments("Settlement");

        before.Elements.Should().Be(3);
        Hash().Should().NotBe(before.Hash);
    }

    [Fact]
    public void Counts_are_reported_alongside_the_hash_so_a_failure_can_say_what_moved()
    {
        Baseline();
        var fp = SourceFingerprint.For(_root, "view_v", "publication", "dual-theme");
        fp.Elements.Should().Be(2);
        fp.ViewMembers.Should().Be(2);
        fp.Hash.Should().HaveLength(16, "long enough to not collide, short enough to read in a diff");
    }
}
