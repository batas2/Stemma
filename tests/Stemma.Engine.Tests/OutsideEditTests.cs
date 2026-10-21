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

    private const string PulledView = """
        using Stemma.Model;

        namespace Scratch;

        public static class Pulled
        {
            public static View Define() => new(
                Id: "view_pulled",
                Name: "Pulled",
                BaseView: "all",
                ElementIds: new[] { "ctx_001" });
        }
        """;

    private static bool Holds(StemmaEngine engine, string path) =>
        engine.Solution.Projects.SelectMany(p => p.Documents)
            .Any(d => string.Equals(d.FilePath, path, StringComparison.OrdinalIgnoreCase));

    private static async Task<bool> EventuallyAsync(Func<bool> condition)
    {
        var deadline = DateTime.UtcNow + TimeSpan.FromSeconds(10);
        while (DateTime.UtcNow < deadline)
        {
            if (condition()) return true;
            await Task.Delay(100);
        }
        return false;
    }

    /// <summary>
    /// A pull adds files and deletes them, not only edits them. A view that arrived while the canvas
    /// was open was saved into a second file declaring the same id, because the engine never saw the
    /// first; a deleted file stayed in the engine, and when it came back with the same text it was
    /// taken for the echo of Stemma's own write.
    /// </summary>
    private static async Task Files_added_and_deleted_outside_are_taken_in(string root)
    {
        await using var engine = await StemmaEngine.OpenAsync(root);
        engine.StartWatching();
        var broadcasts = 0;
        engine.ExternalChange += _ => Interlocked.Increment(ref broadcasts);
        await Task.Delay(TimeSpan.FromSeconds(1));
        var views = Path.Combine(root, "Views");
        Directory.CreateDirectory(views);
        var pulled = Path.Combine(views, "Pulled.cs");

        await File.WriteAllTextAsync(pulled, PulledView);
        (await EventuallyAsync(() => Holds(engine, pulled))).Should().BeTrue("a file added outside is part of the model");
        (await File.ReadAllTextAsync(pulled)).Should().Be(PulledView, "taking a file in does not change it");

        var saved = await engine.SaveViewAsync("op", new ArchView("view_pulled", "Pulled", "all", ["ctx_001", "ctx_002"]));
        saved.Should().BeOfType<OperationApplied>();
        Directory.GetFiles(views).Select(Path.GetFileName).Should().Equal(["Pulled.cs"], "the view is edited where it is, not written again");
        var edited = await File.ReadAllTextAsync(pulled);
        edited.Should().Be(PulledView.Replace("new[] { \"ctx_001\" }", "new[] { \"ctx_001\", \"ctx_002\" }"));

        var before = broadcasts;
        File.Delete(pulled);
        (await EventuallyAsync(() => !Holds(engine, pulled))).Should().BeTrue("a file deleted outside leaves the model");
        (await EventuallyAsync(() => broadcasts > before)).Should().BeTrue("and the canvas is told");
        File.Exists(pulled).Should().BeFalse("nothing writes it back");

        // Back with exactly the text the engine last held: still a change, not an echo.
        before = broadcasts;
        await File.WriteAllTextAsync(pulled, edited);
        (await EventuallyAsync(() => Holds(engine, pulled))).Should().BeTrue("a file that comes back is part of the model again");
        (await EventuallyAsync(() => broadcasts > before)).Should().BeTrue("and the canvas is told");
    }

    [Fact]
    public async Task Files_added_and_deleted_outside_a_model_only_workspace_are_taken_in()
    {
        var (root, _) = await CreateModelOnlyAsync();
        try { await Files_added_and_deleted_outside_are_taken_in(root); }
        finally { Directory.Delete(root, recursive: true); }
    }

    [Fact]
    public async Task Files_added_and_deleted_outside_a_project_workspace_are_taken_in()
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
        var projectFile = Directory.GetFiles(ws.RootPath, "*.csproj").Single();
        var projectBytes = await File.ReadAllBytesAsync(projectFile);

        await Files_added_and_deleted_outside_are_taken_in(ws.RootPath);

        (await File.ReadAllBytesAsync(projectFile)).Should().Equal(projectBytes, "the project globs its sources; it gains no Compile item");
    }

    [Fact]
    public async Task A_view_written_a_moment_ago_is_edited_where_it_is_before_the_watcher_has_seen_it()
    {
        // No watcher: this is the half second between a pull and the poll that would notice it, which
        // is all it takes to reload the canvas and drag a box into the new view.
        var (root, _) = await CreateModelOnlyAsync();
        try
        {
            await using var engine = await StemmaEngine.OpenAsync(root);
            var views = Path.Combine(root, "Views");
            Directory.CreateDirectory(views);
            var pulled = Path.Combine(views, "Pulled.cs");
            await File.WriteAllTextAsync(pulled, PulledView);

            var saved = await engine.SaveViewAsync("op", new ArchView("view_pulled", "Pulled", "all", ["ctx_001", "ctx_002"]));

            saved.Should().BeOfType<OperationApplied>();
            Directory.GetFiles(views).Select(Path.GetFileName).Should().Equal(["Pulled.cs"]);
            (await File.ReadAllTextAsync(pulled)).Should()
                .Be(PulledView.Replace("new[] { \"ctx_001\" }", "new[] { \"ctx_001\", \"ctx_002\" }"));
        }
        finally { Directory.Delete(root, recursive: true); }
    }

    [Fact]
    public async Task Several_files_changed_at_once_are_all_taken_in()
    {
        var (root, file) = await CreateModelOnlyAsync();
        var first = Path.Combine(root, "Views", "Pulled.cs");
        var second = Path.Combine(root, "Views", "Second.cs");
        Directory.CreateDirectory(Path.GetDirectoryName(first)!);
        await File.WriteAllTextAsync(first, PulledView);
        await File.WriteAllTextAsync(second, PulledView.Replace("Pulled", "Second").Replace("view_pulled", "view_second"));
        try
        {
            await using var engine = await StemmaEngine.OpenAsync(root);
            engine.StartWatching();
            await Task.Delay(TimeSpan.FromSeconds(1));

            // One pull, three files, well inside one debounce. Only the last path of each burst used
            // to be taken in.
            await File.WriteAllTextAsync(file, Source.Replace("\"Ordering\"", "\"Sales\""));
            await File.WriteAllTextAsync(first, PulledView.Replace("Name: \"Pulled\"", "Name: \"Pulled twice\""));
            await File.WriteAllTextAsync(second, PulledView.Replace("Pulled", "Second").Replace("view_pulled", "view_second")
                .Replace("Name: \"Second\"", "Name: \"Second twice\""));

            (await EngineHasSeenAsync(engine, file, "\"Sales\"")).Should().BeTrue();
            (await EngineHasSeenAsync(engine, first, "\"Pulled twice\"")).Should().BeTrue();
            (await EngineHasSeenAsync(engine, second, "\"Second twice\"")).Should().BeTrue();
        }
        finally { Directory.Delete(root, recursive: true); }
    }

    [Fact]
    public async Task An_edit_to_a_file_deleted_outside_is_refused_and_does_not_bring_it_back()
    {
        // The check before writing skipped a file that was no longer there, and the write then
        // recreated it: a model file deleted by a pull came back with the edit in it.
        var (root, file) = await CreateModelOnlyAsync();
        var payments = Path.Combine(root, "Architecture", "Payments.cs");
        await File.WriteAllTextAsync(payments, """
            using Stemma.Model;

            namespace Scratch;

            public static class PaymentsArchitecture
            {
                public static Model Build()
                {
                    var modPay = new Module("mod_pay", "Pay");
                    return Model.Of(modPay);
                }
            }
            """);
        try
        {
            await using var engine = await StemmaEngine.OpenAsync(root);
            File.Delete(payments);

            var refused = await engine.ApplyAsync(new RenameElementOp("op", "mod_pay", "Payments"));

            refused.Should().BeOfType<OperationFailed>().Which.Reason.Should().Be("ChangedOnDisk");
            File.Exists(payments).Should().BeFalse("a file deleted outside stays deleted");
            (await engine.ReadArchModelAsync())!.Elements.Should().NotContain(e => e.Id == "mod_pay", "and leaves the model");
            (await File.ReadAllTextAsync(file)).Should().Be(Source);
        }
        finally { Directory.Delete(root, recursive: true); }
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
