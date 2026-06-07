using System.Text.Json;
using FluentAssertions;
using Verso.Engine.Workspace;
using Xunit;

namespace Verso.Engine.Tests;

public class LayoutSidecarTests
{
    private static string TempDir() => Directory.CreateDirectory(
        Path.Combine(Path.GetTempPath(), $"verso-layout-{Guid.NewGuid():N}")).FullName;

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
