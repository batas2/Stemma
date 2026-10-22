using FluentAssertions;
using Stemma.Cli;
using Xunit;

namespace Stemma.Cli.Tests;

/// <summary>
/// The hook the Claude Code plugin runs after every write (F-026). It must say something exactly when an
/// edit to a workspace left it broken, and otherwise stay out of the agent's way — including for every
/// file that has nothing to do with Stemma.
/// </summary>
public sealed class HookCommandTests : IDisposable
{
    private readonly string _dir = Directory.CreateTempSubdirectory("stemma-hook").FullName;

    public void Dispose() => Directory.Delete(_dir, recursive: true);

    private string Workspace(string architecture)
    {
        Directory.CreateDirectory(Path.Combine(_dir, "Architecture"));
        File.WriteAllText(Path.Combine(_dir, "Architecture", "Architecture.cs"), architecture);
        return _dir;
    }

    private static string Event(string path) =>
        $$"""{ "hook_event_name": "PostToolUse", "tool_name": "Write", "tool_input": { "file_path": {{System.Text.Json.JsonSerializer.Serialize(path)}} } }""";

    private static async Task<(int Exit, string Said)> Run(string json)
    {
        var err = new StringWriter();
        var exit = await HookCommand.RunAsync(["post-edit"], new StringReader(json), err);
        return (exit, err.ToString());
    }

    private const string Broken = """
        using Stemma.Model;
        namespace W;
        public static class Architecture
        {
            public static Model Build()
            {
                var a = new Container("cnt_a", "A", "sys_missing", "service");
                return Model.Of(a);
            }
        }
        """;

    private const string Clean = """
        using Stemma.Model;
        namespace W;
        public static class Architecture
        {
            public static Model Build()
            {
                var s = new SoftwareSystem("sys_s", "S");
                var a = new Container("cnt_a", "A", "sys_s", "service");
                return Model.Of(s, a);
            }
        }
        """;

    [Fact]
    public async Task Says_what_broke_when_an_edit_leaves_the_workspace_with_an_error()
    {
        var ws = Workspace(Broken);
        var (exit, said) = await Run(Event(Path.Combine(ws, "Architecture", "Architecture.cs")));
        exit.Should().Be(2, "exit 2 is how a PostToolUse hook puts its stderr in front of Claude");
        said.Should().Contain("element/dangling-reference").And.Contain("sys_missing");
    }

    [Fact]
    public async Task Is_silent_after_an_edit_that_leaves_the_workspace_clean()
    {
        var ws = Workspace(Clean);
        var (exit, said) = await Run(Event(Path.Combine(ws, "Architecture", "Architecture.cs")));
        exit.Should().Be(0);
        said.Should().BeEmpty();
    }

    [Fact]
    public async Task Checks_an_edit_to_a_view_rules_file_or_the_sidecar_too()
    {
        var ws = Workspace(Broken);
        foreach (var file in new[] { Path.Combine(ws, "Views", "V.cs"), Path.Combine(ws, "Rules", "R.cs"), Path.Combine(ws, "stemma.layout.json") })
            (await Run(Event(file))).Exit.Should().Be(2, file);
    }

    [Fact]
    public async Task Leaves_every_other_file_alone()
    {
        var ws = Workspace(Broken);
        (await Run(Event(Path.Combine(ws, "README.md")))).Exit.Should().Be(0);
        (await Run(Event(Path.Combine(ws, "src", "Program.cs")))).Exit.Should().Be(0);
        (await Run(Event(Path.Combine(Path.GetTempPath(), "Views", "Unrelated.cs")))).Exit.Should().Be(0, "a Views folder with no model beside it is someone else's");
    }

    [Theory]
    [InlineData("")]
    [InlineData("not json")]
    [InlineData("""{ "tool_input": {} }""")]
    [InlineData("""{ "tool_input": { "file_path": 3 } }""")]
    public async Task Never_gets_in_the_way_of_an_event_it_cannot_read(string json)
    {
        (await Run(json)).Exit.Should().Be(0);
    }
}
