using System.Text;
using FluentAssertions;
using Stemma.Engine.ArchModel;
using Stemma.Engine.Operations;
using Stemma.Engine.Workspace;
using Xunit;

namespace Stemma.Engine.Tests;

/// <summary>
/// The file belongs to whoever saved it last. A `git pull`, an IDE save or a colleague's agent can
/// write to Architecture.cs while Stemma has it open, and Stemma's job is to notice — never to
/// answer by writing the file itself, and never to write over a version it has not seen.
/// </summary>
public sealed class OutsideEditTests
{
    private const string Source = """
        using Stemma.Model;

        namespace Scratch;

        public static class Architecture
        {
            public static Model Build()
            {
                var ctx = new BoundedContext("ctx_001", "Ordering");
                return Model.Of(ctx);
            }
        }
        """;

    private static readonly byte[] Bom = [0xEF, 0xBB, 0xBF];

    private static async Task<(string Root, string File)> CreateModelOnlyAsync()
    {
        var root = Path.Combine(Path.GetTempPath(), $"stemma-outside-{Guid.NewGuid():N}");
        Directory.CreateDirectory(Path.Combine(root, "Architecture"));
        var file = Path.Combine(root, "Architecture", "Architecture.cs");
        await File.WriteAllTextAsync(file, Source);
        return (root, file);
    }

    private static async Task<bool> EngineHasSeenAsync(StemmaEngine engine, string file, string text)
    {
        var deadline = DateTime.UtcNow + TimeSpan.FromSeconds(10);
        while (DateTime.UtcNow < deadline)
        {
            var doc = engine.Solution.Projects.SelectMany(p => p.Documents)
                .Single(d => string.Equals(d.FilePath, file, StringComparison.OrdinalIgnoreCase));
            if ((await doc.GetTextAsync()).ToString().Contains(text)) return true;
            await Task.Delay(100);
        }
        return false;
    }

    private static async Task An_outside_edit_is_taken_in_once_and_left_alone(string root, string file, bool writesBack)
    {
        await using var engine = await StemmaEngine.OpenAsync(root);
        engine.StartWatching();
        var broadcasts = 0;
        engine.ExternalChange += _ => Interlocked.Increment(ref broadcasts);
        await Task.Delay(TimeSpan.FromSeconds(1));

        // Saved by an editor that writes a BOM, which is the case a re-encoding write-back loses.
        var written = Bom.Concat(Encoding.UTF8.GetBytes(Source.Replace("\"Ordering\"", "\"Sales\""))).ToArray();
        await File.WriteAllBytesAsync(file, written);
        (await EngineHasSeenAsync(engine, file, "\"Sales\"")).Should().BeTrue();
        var modifiedAt = File.GetLastWriteTimeUtc(file);

        await Task.Delay(TimeSpan.FromSeconds(4)); // several watcher polls

        (await File.ReadAllBytesAsync(file)).Should().Equal(written, "taking an edit in must not change the file");
        if (!writesBack)
            File.GetLastWriteTimeUtc(file).Should().Be(modifiedAt, "nothing should have written to the file at all");
        broadcasts.Should().Be(1, "one outside edit is one change, not one per second");
    }

    [Fact]
    public async Task An_outside_edit_to_a_model_only_workspace_is_taken_in_once_and_left_alone()
    {
        var (root, file) = await CreateModelOnlyAsync();
        try { await An_outside_edit_is_taken_in_once_and_left_alone(root, file, writesBack: false); }
        finally { Directory.Delete(root, recursive: true); }
    }

    [Fact]
    public async Task An_outside_edit_to_a_project_workspace_is_taken_in_once_and_left_alone()
    {
        var modelProj = Path.GetFullPath(Path.Combine(AppContext.BaseDirectory, "..", "..", "..", "..", "..", "src", "Stemma.Model", "Stemma.Model.csproj"));
        var csproj = $"""
            <Project Sdk="Microsoft.NET.Sdk">
              <PropertyGroup>
                <TargetFramework>net10.0</TargetFramework>
                <Nullable>enable</Nullable>
              </PropertyGroup>
              <ItemGroup>
                <ProjectReference Include="{modelProj}" />
              </ItemGroup>
            </Project>
            """;
        await using var ws = await TestArchWorkspace.CreateAsync(csproj, Source);
        // MSBuildWorkspace cannot take text in without persisting it, so this path writes the same
        // bytes back once. What it must not do is change them, or do it again.
        await An_outside_edit_is_taken_in_once_and_left_alone(ws.RootPath, ws.ArchPath, writesBack: true);
    }

    [Fact]
    public async Task An_edit_never_writes_over_a_version_of_the_file_it_has_not_seen()
    {
        // No watcher, so the engine cannot have noticed: this is the window between someone's save
        // and the poll that would have picked it up.
        var (root, file) = await CreateModelOnlyAsync();
        try
        {
            await using var engine = await StemmaEngine.OpenAsync(root);
            var outside = Source.Replace("var ctx =", "// added in the IDE\n        var ctx =");
            await File.WriteAllTextAsync(file, outside);

            var refused = await engine.ApplyAsync(new AddElementOp("op1", ArchElementKind.Module, "Pricing", ContextId: "ctx_001"));

            refused.Should().BeOfType<OperationFailed>().Which.Reason.Should().Be("ChangedOnDisk");
            (await File.ReadAllTextAsync(file)).Should().Be(outside, "the save the engine had not seen must survive");

            // Having refused, the engine has read the file, so the same edit now lands on top of it.
            var retried = await engine.ApplyAsync(new AddElementOp("op2", ArchElementKind.Module, "Pricing", ContextId: "ctx_001"));
            retried.Should().BeOfType<OperationApplied>();
            var after = await File.ReadAllTextAsync(file);
            after.Should().Contain("// added in the IDE").And.Contain("\"Pricing\"");
        }
        finally { Directory.Delete(root, recursive: true); }
    }
}
