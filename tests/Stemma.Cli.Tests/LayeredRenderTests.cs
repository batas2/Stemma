using System.Text.Json;
using FluentAssertions;
using Xunit;

namespace Stemma.Cli.Tests;

/// <summary>
/// The layered layout and the layout lint, asserted on what a render writes (F-021, F-022). The audit
/// that motivated both saw a seventeen-box view render as one long row and a back edge vanish under the
/// card it passed — with the render exiting zero each time — so these read the manifest and the exit
/// code, not a call.
/// </summary>
[Trait("Category", "Render")]
public class LayeredRenderTests : IDisposable
{
    private readonly string _dir = Directory.CreateTempSubdirectory("stemma-layered").FullName;

    public void Dispose() => Directory.Delete(_dir, recursive: true);

    private string Out(string name) => Path.Combine(_dir, "out", name);

    private static JsonElement Lint(string output)
    {
        var json = output[output.IndexOf('{')..];
        return JsonDocument.Parse(json).RootElement.GetProperty("lint").Clone();
    }

    private static readonly (string, string, string, string)[] Chain =
    [
        ("rel_ab", "con_a", "con_b", "asks"),
        ("rel_bc", "con_b", "con_c", "forwards"),
        ("rel_db", "con_d", "con_b", "also asks"),
    ];

    [RenderFact]
    public void A_view_nobody_arranged_is_laid_out_in_layers_with_nothing_for_the_lint_to_say()
    {
        var ws = RenderHarness.WorkspaceWithLinks(Path.Combine(_dir, "unarranged"), "view_u",
            ["con_a", "con_d", "con_b", "con_c"], Chain, """{ "version": 1 }""");

        var (exit, output) = RenderHarness.Render("--workspace", ws, "--view", "view_u", "--out", Out("u.png"), "--scale", "1", "--json", "--fail-on-lint");

        exit.Should().Be(0, "a layered layout of a small chain has no overlaps, no edge through a box: {0}", output);
        Lint(output).EnumerateArray().Where(f => f.GetProperty("severity").GetString() == "warning").Should().BeEmpty();
        var size = PngFacts.Size(Out("u.png"))!.Value;
        size.Height.Should().BeGreaterThan(size.Width, "three layers top to bottom make a tall picture; one row would be wide");

        using var manifest = JsonDocument.Parse(File.ReadAllText(Path.Combine(_dir, "out", "u.manifest.json")));
        manifest.RootElement.GetProperty("geometry").GetProperty("nodes").GetArrayLength().Should().Be(4);
        manifest.RootElement.GetProperty("geometry").GetProperty("edges").GetArrayLength().Should().Be(3);
        File.ReadAllText(Path.Combine(ws, "stemma.layout.json")).Should().Be("""{ "version": 1 }""", "laying out a view by default writes nothing");
    }

    [RenderFact]
    public void Gives_the_same_geometry_twice()
    {
        var ws = RenderHarness.WorkspaceWithLinks(Path.Combine(_dir, "twice"), "view_t",
            ["con_a", "con_d", "con_b", "con_c"], Chain, """{ "version": 1, "views": { "custom:view_t": { "layout": { "kind": "layered", "direction": "right" } } } }""");

        RenderHarness.Render("--workspace", ws, "--view", "view_t", "--out", Out("t1.png"), "--scale", "1").ExitCode.Should().Be(0);
        RenderHarness.Render("--workspace", ws, "--view", "view_t", "--out", Out("t2.png"), "--scale", "1").ExitCode.Should().Be(0);

        string Geometry(string name) => JsonDocument.Parse(File.ReadAllText(Path.Combine(_dir, "out", name))).RootElement.GetProperty("geometry").GetRawText();
        Geometry("t2.manifest.json").Should().Be(Geometry("t1.manifest.json"), "a layered layout is a constraint: the same input gives the same picture");
    }

    [RenderFact]
    public void An_app_render_that_fills_the_viewport_does_not_capture_the_minimap()
    {
        // B-027: a grid in the viewport's own proportions fills it, so the content box reaches the
        // bottom-right corner, where the minimap sits. The minimap draws its nodes in indigo
        // (99, 102, 241); the cards do not.
        var ids = Enumerable.Range(1, 36).Select(i => $"con_{i:00}").ToList();
        var columns = string.Join(", ", ids.Chunk(6).Select(c => "[" + string.Join(", ", c.Select(i => $"\"{i}\"")) + "]"));
        var ws = RenderHarness.Workspace(Path.Combine(_dir, "wide"), "view_w", ids,
            $$"""{ "version": 1, "views": { "custom:view_w": { "layout": { "kind": "grid", "columns": [{{columns}}], "gap": [60, 120] } } } }""");

        var (exit, output) = RenderHarness.Render("--workspace", ws, "--view", "view_w", "--out", Out("w.png"), "--scale", "1", "--profile", "app", "--opaque");

        exit.Should().Be(0, "render reported: {0}", output);
        var png = PngPixels.Read(Out("w.png"));
        var indigo = 0;
        for (var y = Math.Max(0, png.Height - 200); y < png.Height; y++)
            for (var x = Math.Max(0, png.Width - 260); x < png.Width; x++)
            {
                var (r, g, b, _) = png.At(x, y);
                if (Math.Abs(r - 99) < 12 && Math.Abs(g - 102) < 12 && Math.Abs(b - 241) < 12) indigo++;
            }
        indigo.Should().Be(0, "the minimap is a panel for a person and has no place in a rendered picture");
    }

    [RenderFact]
    public void Reports_the_back_edge_a_row_hides_and_fails_when_asked()
    {
        // The audit's probe: a → b → c in a row and c → a drawn straight back through b.
        var ws = RenderHarness.WorkspaceWithLinks(Path.Combine(_dir, "row"), "view_r",
            ["con_a", "con_b", "con_c"],
            [("rel_ab", "con_a", "con_b", "a to b"), ("rel_bc", "con_b", "con_c", "b to c"), ("rel_ca", "con_c", "con_a", "c to a")],
            """{ "version": 1, "views": { "custom:view_r": { "layout": { "kind": "row", "ids": ["con_a", "con_b", "con_c"], "gap": 120 } } } }""");

        var (exit, output) = RenderHarness.Render("--workspace", ws, "--view", "view_r", "--out", Out("r.png"), "--scale", "1", "--json", "--fail-on-lint");

        exit.Should().Be(1, "--fail-on-lint and a warning: {0}", output);
        File.Exists(Out("r.png")).Should().BeTrue("the image is written either way, so the agent can look at what failed");
        Lint(output).EnumerateArray().Should().Contain(f =>
            f.GetProperty("rule").GetString() == "layout/edge-through-node"
            && f.GetProperty("ids")[0].GetString() == "rel_ca" && f.GetProperty("ids")[1].GetString() == "con_b");
    }
}
