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
    public void A_model_that_is_mostly_concepts_is_noted_as_a_figure_not_flagged_as_wrong()
    {
        // `Concept` exists so an argument does not have to pretend to be an architecture. Warning
        // about its presence would put the pretence straight back.
        Model("""
                    var a = new Concept("con_a", "A colleague's diff");
                    var b = new Concept("con_b", "An agent's diff");
                    return Model.Of(a, b);
        """);
        var findings = Run();
        findings.Should().Contain(f => f.Rule == "model/is-a-figure" && f.Severity == CheckSeverity.Info);
        findings.Where(f => f.Severity == CheckSeverity.Error).Should().BeEmpty();
    }

    [Fact]
    public void A_view_mixing_concepts_with_structural_kinds_is_a_warning()
    {
        Model("""
                    var m = new Module("mod_a", "Checkout");
                    var c = new Concept("con_a", "The thing nobody owns");
                    return Model.Of(m, c);
        """);
        View("Mixed", """new(Id: "view_mixed", Name: "Mixed", BaseView: "all", ElementIds: new[] { "mod_a", "con_a" })""");
        Run().Should().Contain(f => f.Rule == "view/mixed-register" && f.Severity == CheckSeverity.Warning);
    }

    [Fact]
    public void A_view_of_concepts_alone_is_not_a_mixed_register()
    {
        Model("""
                    var a = new Concept("con_a", "One");
                    var b = new Concept("con_b", "Two");
                    return Model.Of(a, b);
        """);
        View("Pure", """new(Id: "view_pure", Name: "Pure", BaseView: "all", ElementIds: new[] { "con_a", "con_b" })""");
        Run().Should().NotContain(f => f.Rule == "view/mixed-register");
    }

    // ---- free-form shapes ---------------------------------------------------------------------

    private void Sidecar(string viewBody) =>
        File.WriteAllText(Path.Combine(_root, "stemma.layout.json"),
            $$"""{ "version": 1, "views": { "custom:view_v": {{viewBody}} } }""");

    [Fact]
    public void An_arrow_anchored_to_a_missing_element_is_an_error()
    {
        // It does not crash and it does not disappear: it detaches to its last known coordinates,
        // so the diagram looks like someone drew it carelessly rather than like a broken reference.
        Model(TwoModules);
        Sidecar("""{ "shapes": [ { "id": "sh_1", "kind": "arrow", "fromX": 0, "fromY": 0, "toX": 10, "toY": 10, "toAnchor": { "kind": "element", "id": "mod_ghost" } } ] }""");
        Run().Should().Contain(f => f.Rule == "shape/dangling-anchor" && f.Message.Contains("mod_ghost"));
    }

    [Fact]
    public void An_arrow_anchored_to_a_real_element_is_fine()
    {
        Model(TwoModules);
        Sidecar("""{ "shapes": [ { "id": "sh_1", "kind": "arrow", "fromX": 0, "fromY": 0, "toX": 10, "toY": 10, "toAnchor": { "kind": "element", "id": "mod_a" } } ] }""");
        Run().Should().NotContain(f => f.Rule == "shape/dangling-anchor");
    }

    [Fact]
    public void A_free_anchor_is_not_a_reference_and_is_not_checked()
    {
        Model(TwoModules);
        Sidecar("""{ "shapes": [ { "id": "sh_1", "kind": "arrow", "fromX": 0, "fromY": 0, "toX": 10, "toY": 10, "toAnchor": { "kind": "free", "x": 5, "y": 5 } } ] }""");
        Run().Should().NotContain(f => f.Rule == "shape/dangling-anchor");
    }

    [Fact]
    public void An_arrow_anchored_to_another_shape_resolves_against_the_shapes_in_that_view()
    {
        Model(TwoModules);
        Sidecar("""{ "shapes": [ { "id": "sh_box", "kind": "rect", "x": 0, "y": 0, "w": 10, "h": 10 }, { "id": "sh_1", "kind": "arrow", "fromX": 0, "fromY": 0, "toX": 10, "toY": 10, "toAnchor": { "kind": "shape", "id": "sh_box" } } ] }""");
        Run().Should().NotContain(f => f.Rule == "shape/dangling-anchor");
    }

    [Fact]
    public void A_shape_kind_the_canvas_cannot_draw_is_an_error()
    {
        Model(TwoModules);
        Sidecar("""{ "shapes": [ { "id": "sh_1", "kind": "hexagon" } ] }""");
        Run().Should().Contain(f => f.Rule == "shape/unknown-kind" && f.Message.Contains("hexagon"));
    }

    [Fact]
    public void A_shape_without_an_id_is_an_error_because_nothing_can_address_it()
    {
        Model(TwoModules);
        Sidecar("""{ "shapes": [ { "kind": "label", "text": "human" } ] }""");
        Run().Should().Contain(f => f.Rule == "shape/no-id");
    }

    [Fact]
    public void An_empty_label_is_a_warning_because_it_draws_nothing()
    {
        Model(TwoModules);
        Sidecar("""{ "shapes": [ { "id": "sh_1", "kind": "label", "text": "  " } ] }""");
        Run().Should().Contain(f => f.Rule == "shape/empty-label" && f.Severity == CheckSeverity.Warning);
    }

    [Fact]
    public void A_sidecar_that_does_not_parse_is_reported_rather_than_thrown()
    {
        // The canvas silently ignores an unparseable sidecar, which means every position and
        // annotation in it is gone and nothing says so.
        Model(TwoModules);
        File.WriteAllText(Path.Combine(_root, "stemma.layout.json"), "{ not json");
        Run().Should().Contain(f => f.Rule == "sidecar/unreadable");
    }

    [Fact]
    public void A_workspace_with_no_sidecar_is_not_a_finding()
    {
        Model(TwoModules);
        Run().Should().NotContain(f => f.Rule.StartsWith("shape/") || f.Rule.StartsWith("sidecar/"));
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

    // ---- layout constraints -------------------------------------------------------------------
    //
    // The solver used to produce coordinates that were not numbers when a `gap` had the wrong shape,
    // and the headless render died on a JSON type error naming neither the file nor the field. It
    // now falls back to its default spacing, which turns a dead render into a quietly different
    // picture — so this is the layer that has to say something.

    private void Constraint(string layout) => Sidecar($$"""{ "layout": {{layout}} }""");

    [Fact]
    public void A_row_gap_written_as_a_grid_pair_is_an_error()
    {
        Model(TwoModules);
        Constraint("""{ "kind": "row", "ids": ["mod_a", "mod_b"], "gap": [60, 40] }""");

        Run().Should().ContainSingle(f => f.Rule == "constraint/bad-gap")
            .Which.Message.Should().Contain("row").And.Contain("one number");
    }

    [Fact]
    public void A_grid_gap_written_as_a_pair_is_accepted()
    {
        Model(TwoModules);
        Constraint("""{ "kind": "grid", "columns": [["mod_a"], ["mod_b"]], "gap": [60, 40] }""");

        Run().Should().NotContain(f => f.Rule == "constraint/bad-gap");
    }

    [Fact]
    public void A_single_number_gap_is_accepted_for_every_kind()
    {
        // The solver takes it for all four, so reporting it would be a warning about nothing.
        Model(TwoModules);
        Constraint("""{ "kind": "grid", "columns": [["mod_a"], ["mod_b"]], "gap": 40 }""");

        Run().Should().NotContain(f => f.Rule == "constraint/bad-gap");
    }

    [Fact]
    public void A_gap_that_is_not_a_number_at_all_is_an_error()
    {
        Model(TwoModules);
        Constraint("""{ "kind": "row", "ids": ["mod_a", "mod_b"], "gap": "wide" }""");

        Run().Should().Contain(f => f.Rule == "constraint/bad-gap");
    }

    [Fact]
    public void A_stack_step_of_the_wrong_shape_is_an_error()
    {
        Model(TwoModules);
        Constraint("""{ "kind": "stack", "ids": ["mod_a", "mod_b"], "step": "x" }""");

        Run().Should().Contain(f => f.Rule == "constraint/bad-gap");
    }

    [Fact]
    public void A_layout_of_an_unknown_kind_is_an_error()
    {
        Model(TwoModules);
        Constraint("""{ "kind": "radial", "ids": ["mod_a", "mod_b"] }""");

        Run().Should().ContainSingle(f => f.Rule == "constraint/unknown-kind")
            .Which.Message.Should().Contain("radial");
    }

    [Fact]
    public void A_constraint_arranging_a_missing_element_is_an_error()
    {
        Model(TwoModules);
        Constraint("""{ "kind": "row", "ids": ["mod_a", "mod_ghost"], "gap": 40 }""");

        Run().Should().ContainSingle(f => f.Rule == "constraint/dangling-id")
            .Which.ElementId.Should().Be("mod_ghost");
    }

    [Fact]
    public void A_grid_arranging_a_missing_element_is_found_inside_its_columns()
    {
        Model(TwoModules);
        Constraint("""{ "kind": "grid", "columns": [["mod_a"], ["mod_ghost"]] }""");

        Run().Should().ContainSingle(f => f.Rule == "constraint/dangling-id")
            .Which.ElementId.Should().Be("mod_ghost");
    }

    [Fact]
    public void A_row_with_no_ids_array_is_an_error()
    {
        Model(TwoModules);
        Constraint("""{ "kind": "row", "gap": 40 }""");

        Run().Should().Contain(f => f.Rule == "constraint/no-members");
    }

    [Fact]
    public void A_grid_looks_for_columns_rather_than_ids()
    {
        // Naming the wrong member is the other easy mistake, and it places nothing at all.
        Model(TwoModules);
        Constraint("""{ "kind": "grid", "ids": ["mod_a", "mod_b"] }""");

        Run().Should().Contain(f => f.Rule == "constraint/no-members");
    }

    [Fact]
    public void A_correct_constraint_reports_nothing()
    {
        Model(TwoModules);
        Constraint("""{ "kind": "row", "ids": ["mod_a", "mod_b"], "gap": 40, "align": "center" }""");

        Run().Should().NotContain(f => f.Rule.StartsWith("constraint/"));
    }

    [Fact]
    public void A_view_with_no_layout_reports_nothing()
    {
        Model(TwoModules);
        Sidecar("""{ "nodes": { "mod_a": { "x": 0, "y": 0 } } }""");

        Run().Should().NotContain(f => f.Rule.StartsWith("constraint/"));
    }

    // ---- books --------------------------------------------------------------------------------
    //
    // A page points at a view and at elements by id, in a presentation file the engine stores without
    // reading. A deck whose slide outlived the element it points at still presents; this is what says
    // it no longer tells the truth (F-013 AC8).

    private void Books(string books) =>
        File.WriteAllText(Path.Combine(_root, "stemma.layout.json"), $$"""{ "version": 1, "books": {{books}} }""");

    private void ViewOfA() =>
        View("JustA", """new(Id: "view_a", Name: "Just A", BaseView: "all", ElementIds: new[] { "mod_a" })""");

    private IEnumerable<CheckFinding> BookRun() => Run().Where(f => f.Rule.StartsWith("book/"));

    [Fact]
    public void A_book_whose_references_all_hold_reports_nothing()
    {
        Model(TwoModules);
        ViewOfA();
        Books("""
            {
              "book_walk": {
                "name": "The walk",
                "audience": "engineering",
                "x-owner": "squad-pay",
                "order": ["wide", "close"],
                "pages": {
                  "wide": { "title": "Everything", "view": "moduleMap", "narrative": "Start wide.", "focus": ["mod_a", "mod_b"] },
                  "close": { "title": "Just A", "view": "view_a", "focus": ["mod_a"], "frame": "focus", "others": "hide", "x-speaker": "B" },
                  "loose": { "title": "Not in the order", "view": "dependencyGraph" }
                }
              },
              "book_empty": { "name": "Not written yet", "pages": {} }
            }
            """);

        BookRun().Should().BeEmpty();
    }

    [Fact]
    public void A_page_showing_a_view_that_does_not_exist_is_an_error()
    {
        Model(TwoModules);
        Books("""{ "book_walk": { "name": "W", "pages": { "p1": { "title": "One", "view": "view_ghost" } } } }""");

        var finding = BookRun().Should().ContainSingle().Which;
        finding.Rule.Should().Be("book/missing-view");
        finding.Severity.Should().Be(CheckSeverity.Error);
        finding.Message.Should().Contain("book_walk").And.Contain("p1").And.Contain("view_ghost");
    }

    [Fact]
    public void A_page_naming_a_view_by_its_layout_key_is_told_the_id_to_write()
    {
        // `custom:view_a` is how the same view is keyed under `views`, three screens up the same file.
        Model(TwoModules);
        ViewOfA();
        Books("""{ "book_walk": { "name": "W", "pages": { "p1": { "title": "One", "view": "custom:view_a" } } } }""");

        BookRun().Should().ContainSingle(f => f.Rule == "book/missing-view")
            .Which.Message.Should().Contain("write 'view_a'");
    }

    [Fact]
    public void A_page_pointing_at_an_element_that_does_not_exist_is_an_error()
    {
        Model(TwoModules);
        Books("""{ "book_walk": { "name": "W", "pages": { "p1": { "title": "One", "view": "moduleMap", "focus": ["mod_a", "mod_ghost"] } } } }""");

        var finding = BookRun().Should().ContainSingle().Which;
        finding.Rule.Should().Be("book/dangling-focus");
        finding.Severity.Should().Be(CheckSeverity.Error);
        finding.ElementId.Should().Be("mod_ghost");
        finding.Message.Should().Contain("book_walk").And.Contain("p1");
    }

    [Fact]
    public void A_page_pointing_at_an_element_its_view_does_not_draw_is_a_warning()
    {
        // The element exists, so the page is not broken; the view just has nothing to light up.
        Model(TwoModules);
        ViewOfA();
        Books("""{ "book_walk": { "name": "W", "pages": { "p1": { "title": "One", "view": "view_a", "focus": ["mod_a", "mod_b"] } } } }""");

        var finding = BookRun().Should().ContainSingle().Which;
        finding.Rule.Should().Be("book/focus-outside-view");
        finding.Severity.Should().Be(CheckSeverity.Warning);
        finding.ElementId.Should().Be("mod_b");
        finding.Message.Should().Contain("view_a");
    }

    [Fact]
    public void An_order_naming_a_page_that_does_not_exist_is_a_warning()
    {
        Model(TwoModules);
        Books("""{ "book_walk": { "name": "W", "order": ["p1", "p_gone"], "pages": { "p1": { "title": "One", "view": "moduleMap" } } } }""");

        var finding = BookRun().Should().ContainSingle().Which;
        finding.Rule.Should().Be("book/dangling-order");
        finding.Severity.Should().Be(CheckSeverity.Warning);
        finding.Message.Should().Contain("book_walk").And.Contain("p_gone");
    }

    [Theory]
    [InlineData("""[]""")]
    [InlineData("""{ "book_walk": "W" }""")]
    [InlineData("""{ "book_walk": { "name": "W" } }""")]
    [InlineData("""{ "book_walk": { "name": "W", "pages": [] } }""")]
    [InlineData("""{ "book_walk": { "name": "W", "pages": { "p1": "One" } } }""")]
    // A page without a string title or view is not checked further, so its dangling focus is not reported twice over.
    [InlineData("""{ "book_walk": { "name": "W", "pages": { "p1": { "title": 1, "view": "moduleMap", "focus": ["mod_ghost"] } } } }""")]
    [InlineData("""{ "book_walk": { "name": "W", "pages": { "p1": { "title": "One", "focus": ["mod_ghost"] } } } }""")]
    [InlineData("""{ "book_walk": { "name": "W", "pages": { "p1": { "title": "One", "view": "moduleMap", "focus": "mod_a" } } } }""")]
    [InlineData("""{ "book_walk": { "name": "W", "order": "p1", "pages": { "p1": { "title": "One", "view": "moduleMap" } } } }""")]
    public void A_book_the_canvas_cannot_read_as_written_is_a_warning_rather_than_a_crash(string books)
    {
        Model(TwoModules);
        Books(books);

        BookRun().Should().ContainSingle()
            .Which.Should().Match<CheckFinding>(f => f.Rule == "book/malformed" && f.Severity == CheckSeverity.Warning);
    }

    [Fact]
    public void Books_left_in_the_old_yaml_file_are_said_to_be_unread()
    {
        Model(TwoModules);
        Directory.CreateDirectory(Path.Combine(_root, "Concepts"));
        File.WriteAllText(Path.Combine(_root, "Concepts", "view-book.stemma.yaml"), "version: 1\nbooks:\n");

        var finding = Run().Should().ContainSingle(f => f.Rule.StartsWith("book/")).Which;
        finding.Rule.Should().Be("book/legacy-file");
        finding.Severity.Should().Be(CheckSeverity.Warning);
        finding.Message.Should().Contain("stemma.layout.json");
    }

    [Fact]
    public void A_sidecar_with_no_books_says_nothing_about_books()
    {
        Model(TwoModules);
        Sidecar("""{ "nodes": { "mod_a": { "x": 0, "y": 0 } } }""");
        BookRun().Should().BeEmpty();

        // Unreadable is already one finding; books do not add a second.
        File.WriteAllText(Path.Combine(_root, "stemma.layout.json"), """{ "books": { <<<<<<< HEAD""");
        BookRun().Should().BeEmpty();
        Run().Should().ContainSingle(f => f.Rule == "sidecar/unreadable");
    }
}
