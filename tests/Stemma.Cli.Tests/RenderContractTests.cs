using System.Text.Json;
using FluentAssertions;
using Xunit;

namespace Stemma.Cli.Tests;

/// <summary>
/// The two things a headless render promises: it draws the arrangement the file states, and the
/// image it writes is the image the manifest describes. Both were broken at once (B-002, B-003) and
/// both renders exited zero, which is why these assert on the artefact and never on a call.
/// </summary>
[Trait("Category", "Render")]
public class RenderContractTests : IDisposable
{
    private readonly string _dir = Directory.CreateTempSubdirectory("stemma-render").FullName;

    public void Dispose() => Directory.Delete(_dir, recursive: true);

    private string Out(string name) => Path.Combine(_dir, "out", name);

    [RenderFact]
    public void Honours_authored_node_positions_under_custom_layout_mode()
    {
        // B-002's isolate: two boxes 400 units apart vertically, declared authoritative. The bug
        // rendered them side by side at 1098x138 — a 400-unit gap cannot fit in 138 pixels.
        var ws = RenderHarness.Workspace(Path.Combine(_dir, "custom"), "view_t", ["con_a", "con_b"], """
            {
              "version": 1,
              "views": {
                "custom:view_t": {
                  "layoutMode": "custom",
                  "nodes": { "con_a": { "x": 0, "y": 0 }, "con_b": { "x": 0, "y": 400 } }
                }
              }
            }
            """);

        var (exit, output) = RenderHarness.Render("--workspace", ws, "--view", "view_t", "--out", Out("custom.png"), "--scale", "1");

        exit.Should().Be(0, "render reported: {0}", output);
        var size = PngFacts.Size(Out("custom.png"));
        size.Should().NotBeNull();
        size!.Value.Height.Should().BeGreaterThan(size.Value.Width,
            "two nodes stacked 400 units apart make a tall image; a wide one means the authored positions were discarded");
        size.Value.Height.Should().BeGreaterThan(400, "the authored gap alone is 400 units at scale 1");
    }

    [RenderFact]
    public void Honours_an_absolute_position_alongside_a_constraint()
    {
        // The protocol reference's §5.2 pattern: a constraint governs most of the view and one
        // element sits deliberately outside it. This is the documented mixture, and the one most
        // likely to break again — a fix that made the constraint win everywhere would pass the test
        // above and fail here.
        var ws = RenderHarness.Workspace(Path.Combine(_dir, "mixed"), "view_m",
            ["con_a", "con_b", "con_c", "con_d", "con_far"], """
            {
              "version": 1,
              "views": {
                "custom:view_m": {
                  "layoutMode": "custom",
                  "layout": { "kind": "row", "ids": ["con_a", "con_b", "con_c", "con_d"], "gap": 60 },
                  "nodes": { "con_far": { "x": 0, "y": 700 } }
                }
              }
            }
            """);

        var (exit, output) = RenderHarness.Render("--workspace", ws, "--view", "view_m", "--out", Out("mixed.png"), "--scale", "1");

        exit.Should().Be(0, "render reported: {0}", output);
        var size = PngFacts.Size(Out("mixed.png"));
        size.Should().NotBeNull();
        size!.Value.Height.Should().BeGreaterThan(600,
            "the element outside the constraint is authored at y=700; a short image means the row swallowed it");
    }

    [RenderFact]
    public void Writes_a_transparent_png_by_default_and_says_so()
    {
        var ws = Fixture("view_clear");

        var (exit, output) = RenderHarness.Render("--workspace", ws, "--view", "view_clear", "--out", Out("clear.png"), "--scale", "1");

        exit.Should().Be(0, "render reported: {0}", output);
        PngFacts.HasAlpha(Out("clear.png")).Should().BeTrue(
            "transparency is the default, and B-003 wrote an opaque file while reporting success");
        Manifest("clear").GetProperty("transparent").GetBoolean().Should().BeTrue();
    }

    [RenderFact]
    public void Bakes_a_background_when_asked_and_says_so()
    {
        // Without this, a fix that made everything unconditionally transparent passes the test above.
        var ws = Fixture("view_opaque");

        var (exit, output) = RenderHarness.Render("--workspace", ws, "--view", "view_opaque", "--out", Out("opaque.png"), "--scale", "1", "--opaque");

        exit.Should().Be(0, "render reported: {0}", output);
        PngFacts.HasAlpha(Out("opaque.png")).Should().BeFalse();
        Manifest("opaque").GetProperty("transparent").GetBoolean().Should().BeFalse();
    }

    [RenderFact]
    public void Records_the_transparency_the_file_actually_has()
    {
        // The invariant B-003 broke, stated directly: the manifest is provenance, so it describes
        // the file beside it rather than the flags it was invoked with.
        var ws = Fixture("view_record");

        RenderHarness.Render("--workspace", ws, "--view", "view_record", "--out", Out("record.png"), "--scale", "1").ExitCode.Should().Be(0);

        var manifest = Manifest("record");
        manifest.GetProperty("transparent").GetBoolean().Should().Be(PngFacts.HasAlpha(Out("record.png"))!.Value);
        manifest.GetProperty("files")[0].GetProperty("hasAlpha").GetBoolean()
            .Should().Be(PngFacts.HasAlpha(Out("record.png"))!.Value);
    }

    private string Fixture(string viewId) =>
        RenderHarness.Workspace(Path.Combine(_dir, viewId), viewId, ["con_a", "con_b"], $$"""
            {
              "version": 1,
              "views": {
                "custom:{{viewId}}": {
                  "layout": { "kind": "row", "ids": ["con_a", "con_b"], "gap": 60 }
                }
              }
            }
            """);

    private JsonElement Manifest(string name) =>
        JsonDocument.Parse(File.ReadAllText(Out($"{name}.manifest.json"))).RootElement.Clone();
}
