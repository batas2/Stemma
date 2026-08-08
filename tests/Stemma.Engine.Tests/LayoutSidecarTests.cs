using System.Text.Json;
using FluentAssertions;
using Stemma.Engine.Workspace;
using Xunit;

namespace Stemma.Engine.Tests;

public class LayoutSidecarTests
{
    private static string TempDir() => Directory.CreateDirectory(
        Path.Combine(Path.GetTempPath(), $"stemma-layout-{Guid.NewGuid():N}")).FullName;

    [Fact]
    public void Read_returns_empty_when_file_missing()
    {
        var dir = TempDir();
        try
        {
            var s = LayoutSidecar.Read(dir);
            s.Version.Should().Be(1);
            s.Views.Should().BeEmpty();
            s.NodeStyles.Should().BeEmpty();
            s.Notes.Should().BeEmpty();
        }
        finally { Directory.Delete(dir, recursive: true); }
    }

    [Fact]
    public void Round_trip_preserves_positions_styles_notes_props_and_annotations()
    {
        var dir = TempDir();
        try
        {
            var s = new LayoutSidecar();
            s.Views["moduleMap"] = new LayoutSidecar.ViewLayout
            {
                Nodes = { ["mod_1"] = new LayoutSidecar.Position { X = 120, Y = 40 } },
            };
            // Rich sections are pass-through JSON owned by the web client.
            s.NodeStyles["mod_1"] = JsonDocument.Parse("""{"fillColor":"#1F4E79","animation":"glow","radius":12}""").RootElement;
            s.EdgeStyles["flow_1"] = JsonDocument.Parse("""{"animated":true,"step":3}""").RootElement;
            s.Notes["mod_1"] = "Owns the **ESMA** grace period. #owner: Perform";
            s.CustomProps["mod_1"] = JsonDocument.Parse("""{"owner":"Perform","status":"NEW"}""").RootElement;
            s.Annotations["moduleMap"] = JsonDocument.Parse("""[{"kind":"frame","label":"Risk Service"}]""").RootElement;

            s.Write(dir);
            File.Exists(LayoutSidecar.PathFor(dir)).Should().BeTrue();

            var r = LayoutSidecar.Read(dir);
            r.Views["moduleMap"].Nodes["mod_1"].X.Should().Be(120);
            r.NodeStyles["mod_1"].GetProperty("fillColor").GetString().Should().Be("#1F4E79");
            r.NodeStyles["mod_1"].GetProperty("animation").GetString().Should().Be("glow");
            r.EdgeStyles["flow_1"].GetProperty("step").GetInt32().Should().Be(3);
            r.Notes["mod_1"].Should().Contain("ESMA");
            r.CustomProps["mod_1"].GetProperty("owner").GetString().Should().Be("Perform");
            r.Annotations["moduleMap"][0].GetProperty("kind").GetString().Should().Be("frame");
        }
        finally { Directory.Delete(dir, recursive: true); }
    }

    /// <summary>
    /// B-001. The sidecar is a pass-through format: the web client owns the schema of everything
    /// rich in it. A member this C# type has never heard of must therefore survive a round trip.
    ///
    /// Named for the invariant rather than for the two members that broke it, and asserted with an
    /// invented section (`sparkles`) alongside the real ones, so it guards the *class* of bug — a
    /// closed nested type silently dropping unmapped members on bind — rather than two instances of
    /// it. `Round_trip_preserves_positions_styles_notes_props_and_annotations` above stayed green
    /// throughout the original defect precisely because it only asserts what the type declares.
    /// </summary>
    [Fact]
    public void Unknown_members_inside_a_view_survive_a_round_trip()
    {
        var dir = TempDir();
        try
        {
            // Exactly what the client PUTs after drawing a shape and docking one edge endpoint —
            // plus sections that do not exist yet, standing in for whatever the canvas invents next.
            var authored = """
            {
              "version": 1,
              "palettes": { "blog": { "stroke": "#767884" } },
              "views": {
                "custom:view_x": {
                  "nodes": { "mod_1": { "x": 10, "y": 20 } },
                  "edges": {
                    "flow_1": {
                      "waypoints": [{ "x": 5, "y": 5 }],
                      "handles": { "source": "right", "target": "left" }
                    }
                  },
                  "shapes": [{ "id": "sh_1", "kind": "label", "text": "human", "z": -1 }],
                  "sparkles": { "anything": true }
                }
              }
            }
            """;
            File.WriteAllText(LayoutSidecar.PathFor(dir), authored);

            // Read → Write is the full server cycle: GET deserialises through these types, and the
            // PUT that follows re-serialises whatever came back.
            LayoutSidecar.Read(dir).Write(dir);
            var onDisk = File.ReadAllText(LayoutSidecar.PathFor(dir));

            using var doc = JsonDocument.Parse(onDisk);
            var view = doc.RootElement.GetProperty("views").GetProperty("custom:view_x");

            view.GetProperty("shapes")[0].GetProperty("text").GetString().Should().Be("human",
                "free-form shapes are the client's to define and the engine's only to persist");
            view.GetProperty("edges").GetProperty("flow_1").GetProperty("handles")
                .GetProperty("source").GetString().Should().Be("right",
                "edge dock anchors live beside waypoints on the same entry");
            view.GetProperty("sparkles").GetProperty("anything").GetBoolean().Should().BeTrue(
                "a section invented after this test was written must survive too");
            doc.RootElement.GetProperty("palettes").GetProperty("blog")
                .GetProperty("stroke").GetString().Should().Be("#767884",
                "the same guarantee applies to unmapped sections at the top level");

            // The modelled members still bind, because a validator walks them by type.
            var typed = LayoutSidecar.Read(dir);
            typed.Views["custom:view_x"].Nodes["mod_1"].Y.Should().Be(20);
            typed.Views["custom:view_x"].Edges!["flow_1"].Waypoints![0].X.Should().Be(5);
        }
        finally { Directory.Delete(dir, recursive: true); }
    }

    [Fact]
    public void Read_tolerates_garbage()
    {
        var dir = TempDir();
        try
        {
            File.WriteAllText(LayoutSidecar.PathFor(dir), "{ not valid json");
            LayoutSidecar.Read(dir).Views.Should().BeEmpty();
        }
        finally { Directory.Delete(dir, recursive: true); }
    }
}
