using FluentAssertions;
using Stemma.Engine.ArchModel;
using Stemma.Engine.Operations;
using Stemma.Engine.Workspace;
using Xunit;

namespace Stemma.Engine.Tests;

/// <summary>
/// A view is a file somebody may have written by hand — with a doc comment saying what question it
/// answers, its ids one per line, a trailing comma — and saving it from the canvas must treat it the
/// way an operation treats Architecture.cs: change the ids, the name or the lens in place, and
/// nothing else. Finding a view is done by reading the files, never by searching their text, since
/// a narrative comment in one view can quote another view's id.
/// </summary>
public sealed class ViewWriteTests
{
    private const string Model = """
        using Stemma.Model;

        namespace Scratch;

        public static class Architecture
        {
            public static Model Build()
            {
                var a = new Module("mod_a", "A");
                var b = new Module("mod_b", "B");
                var c = new Module("mod_c", "C");
                return Model.Of(a, b, c);
            }
        }
        """;

    private const string Shape = """
        using Stemma.Model;

        namespace Scratch;

        /// <summary>
        /// What ships. Deliberately the smallest view in the workspace.
        /// </summary>
        public static class Shape
        {
            public static View Define() => new(
                Id: "view_shape",
                Name: "What ships",
                BaseView: "all",
                ElementIds: new[]
                {
                    "mod_a",
                    "mod_b", // the one people forget
                });
        }
        """;

    private static async Task<string> CreateAsync(params (string Path, string Text)[] views)
    {
        var root = Path.Combine(Path.GetTempPath(), $"stemma-views-{Guid.NewGuid():N}");
        Directory.CreateDirectory(Path.Combine(root, "Architecture"));
        Directory.CreateDirectory(Path.Combine(root, "Views"));
        await File.WriteAllTextAsync(Path.Combine(root, "Architecture", "Architecture.cs"), Model);
        foreach (var (path, text) in views) await File.WriteAllTextAsync(Path.Combine(root, "Views", path), text);
        return root;
    }

    private static void Applied(OperationResult r)
    {
        if (r is OperationFailed f) throw new Xunit.Sdk.XunitException($"{f.Reason}: {f.Message}");
    }

    [Fact]
    public async Task Saving_a_view_edits_its_member_list_and_nothing_else()
    {
        var root = await CreateAsync(("Shape.cs", Shape));
        try
        {
            await using var engine = await StemmaEngine.OpenAsync(root);
            Applied(await engine.SaveViewAsync("op", new ArchView("view_shape", "What ships", "all", ["mod_b", "mod_c"])));

            (await File.ReadAllTextAsync(Path.Combine(root, "Views", "Shape.cs"))).Should().Be(Shape.Replace(
                """
                            "mod_a",
                            "mod_b", // the one people forget

                """,
                """
                            "mod_b", // the one people forget
                            "mod_c",

                """));
        }
        finally { Directory.Delete(root, recursive: true); }
    }

    [Fact]
    public async Task Renaming_a_view_changes_its_name_and_keeps_its_file()
    {
        var root = await CreateAsync(("Shape.cs", Shape));
        try
        {
            await using var engine = await StemmaEngine.OpenAsync(root);
            Applied(await engine.SaveViewAsync("op", new ArchView("view_shape", "What we ship", "moduleMap", ["mod_a", "mod_b"])));

            Directory.GetFiles(Path.Combine(root, "Views")).Select(Path.GetFileName).Should().Equal("Shape.cs");
            (await File.ReadAllTextAsync(Path.Combine(root, "Views", "Shape.cs"))).Should().Be(Shape
                .Replace("Name: \"What ships\"", "Name: \"What we ship\"")
                .Replace("BaseView: \"all\"", "BaseView: \"moduleMap\""));
        }
        finally { Directory.Delete(root, recursive: true); }
    }

    [Fact]
    public async Task A_new_view_gets_a_file_of_its_own_without_replacing_one()
    {
        // Two views can be called the same thing; the second must not take the first one's file.
        var whatShips = Shape.Replace("class Shape", "class WhatShips");
        var root = await CreateAsync(("WhatShips.cs", whatShips));
        try
        {
            await using var engine = await StemmaEngine.OpenAsync(root);
            Applied(await engine.SaveViewAsync("op", new ArchView("view_new", "What ships", "all", ["mod_c"])));

            (await File.ReadAllTextAsync(Path.Combine(root, "Views", "WhatShips.cs"))).Should().Be(whatShips);
            var views = ViewsAdapter.ReadAllFrom(await engine.CollectAllDocumentsAsync());
            views.Select(v => v.Id).Should().BeEquivalentTo(["view_shape", "view_new"]);
            views.Single(v => v.Id == "view_new").ElementIds.Should().Equal("mod_c");
        }
        finally { Directory.Delete(root, recursive: true); }
    }

    [Fact]
    public async Task Removing_a_view_deletes_only_the_file_that_declares_it()
    {
        // A sorts first and quotes B's id in a comment, which is what a text search would match.
        var a = Shape.Replace("view_shape", "view_a").Replace("class Shape", "class A")
            .Replace("/// What ships.", "/// What ships. The detail is in \"view_b\".");
        var b = Shape.Replace("view_shape", "view_b").Replace("class Shape", "class B");
        var root = await CreateAsync(("A.cs", a), ("B.cs", b));
        try
        {
            await using var engine = await StemmaEngine.OpenAsync(root);
            Applied(await engine.RemoveViewAsync("op", "view_b"));

            Directory.GetFiles(Path.Combine(root, "Views")).Select(Path.GetFileName).Should().Equal("A.cs");
            (await File.ReadAllTextAsync(Path.Combine(root, "Views", "A.cs"))).Should().Be(a);
        }
        finally { Directory.Delete(root, recursive: true); }
    }

    [Fact]
    public async Task Removing_a_view_that_does_not_exist_says_so()
    {
        var root = await CreateAsync(("Shape.cs", Shape));
        try
        {
            await using var engine = await StemmaEngine.OpenAsync(root);
            (await engine.RemoveViewAsync("op", "view_nope")).Should().BeOfType<OperationFailed>()
                .Which.Reason.Should().Be("ViewNotFound");
        }
        finally { Directory.Delete(root, recursive: true); }
    }

    [Fact]
    public async Task A_new_view_in_a_project_workspace_leaves_the_project_file_alone()
    {
        // SDK-style projects compile Views/*.cs by glob. An explicit <Compile Include> added for the
        // new file would make it a duplicate item, and the next build would fail.
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
        await using var ws = await TestArchWorkspace.CreateAsync(csproj, Model);
        var projectFile = Path.Combine(ws.RootPath, "Sample.csproj");
        await using var engine = await StemmaEngine.OpenAsync(ws.RootPath);

        Applied(await engine.SaveViewAsync("op", new ArchView("view_new", "Checkout path", "all", ["mod_a"])));

        (await File.ReadAllTextAsync(projectFile)).Should().Be(csproj);
        File.Exists(Path.Combine(ws.RootPath, "Views", "CheckoutPath.cs")).Should().BeTrue();
        ViewsAdapter.ReadAllFrom(await engine.CollectAllDocumentsAsync()).Should().ContainSingle(v => v.Id == "view_new");
    }

    [Fact]
    public async Task A_new_view_in_a_project_in_a_subfolder_does_not_replace_a_file_there()
    {
        // The project is not at the root: a solution holds it. A new view is written into the project's
        // Views/, and that is where an existing file of the same name has to be seen.
        var modelProj = Path.GetFullPath(Path.Combine(AppContext.BaseDirectory, "..", "..", "..", "..", "..", "src", "Stemma.Model", "Stemma.Model.csproj"));
        var root = Path.Combine(Path.GetTempPath(), $"stemma-subproj-{Guid.NewGuid():N}");
        var projectDir = Path.Combine(root, "src", "Shop");
        Directory.CreateDirectory(Path.Combine(projectDir, "Architecture"));
        Directory.CreateDirectory(Path.Combine(projectDir, "Views"));
        await File.WriteAllTextAsync(Path.Combine(projectDir, "Shop.csproj"), $"""
            <Project Sdk="Microsoft.NET.Sdk">
              <PropertyGroup><TargetFramework>net10.0</TargetFramework><Nullable>enable</Nullable></PropertyGroup>
              <ItemGroup><ProjectReference Include="{modelProj}" /></ItemGroup>
            </Project>
            """);
        await File.WriteAllTextAsync(Path.Combine(root, "Shop.sln"), """

            Microsoft Visual Studio Solution File, Format Version 12.00
            Project("{FAE04EC0-301F-11D3-BF4B-00C04F79EFBC}") = "Shop", "src\Shop\Shop.csproj", "{6E5C1D5A-1D2B-4C3A-9B8E-1A2B3C4D5E6F}"
            EndProject
            Global
            EndGlobal
            """);
        await File.WriteAllTextAsync(Path.Combine(projectDir, "Architecture", "Architecture.cs"), Model);
        var existing = """
            using Stemma.Model;

            namespace Sample;

            // Someone's view, under a class name that differs from its file's.
            public static class CheckoutView
            {
                public static View Define() => new(Id: "view_checkout", Name: "Checkout", BaseView: "all", ElementIds: new[] { "mod_a" });
            }
            """;
        var existingPath = Path.Combine(projectDir, "Views", "Checkout.cs");
        await File.WriteAllTextAsync(existingPath, existing);
        try
        {
            await using var engine = await StemmaEngine.OpenAsync(root);

            Applied(await engine.SaveViewAsync("op", new ArchView("view_new", "Checkout", "all", ["mod_a"])));

            (await File.ReadAllTextAsync(existingPath)).Should().Be(existing);
            File.Exists(Path.Combine(projectDir, "Views", "Checkout2.cs")).Should().BeTrue();
            ViewsAdapter.ReadAllFrom(await engine.CollectAllDocumentsAsync()).Select(v => v.Id)
                .Should().Contain(["view_checkout", "view_new"]);
        }
        finally { try { Directory.Delete(root, recursive: true); } catch (IOException) { } }
    }

    [Fact]
    public async Task A_view_name_with_quotes_and_a_backslash_is_written_as_a_valid_literal()
    {
        var root = await CreateAsync();
        try
        {
            await using var engine = await StemmaEngine.OpenAsync(root);
            const string name = "Before \"the split\" on C:\\ drive";
            Applied(await engine.SaveViewAsync("op", new ArchView("view_q", name, "all", ["mod_a"])));

            var views = ViewsAdapter.ReadAllFrom(await engine.CollectAllDocumentsAsync());
            views.Single().Name.Should().Be(name);
        }
        finally { Directory.Delete(root, recursive: true); }
    }

    [Fact]
    public async Task A_view_can_be_emptied_and_filled_again()
    {
        var root = await CreateAsync(("Shape.cs", Shape));
        try
        {
            await using var engine = await StemmaEngine.OpenAsync(root);
            Applied(await engine.SaveViewAsync("op1", new ArchView("view_shape", "What ships", "all", [])));
            Applied(await engine.SaveViewAsync("op2", new ArchView("view_shape", "What ships", "all", ["mod_c"])));

            var views = ViewsAdapter.ReadAllFrom(await engine.CollectAllDocumentsAsync());
            views.Single().ElementIds.Should().Equal("mod_c");
            (await File.ReadAllTextAsync(Path.Combine(root, "Views", "Shape.cs"))).Should()
                .Contain("/// What ships. Deliberately the smallest view in the workspace.");
        }
        finally { Directory.Delete(root, recursive: true); }
    }

    [Theory]
    // Ids several to a line, each with its comma: the new one continues the last line, where the
    // next id would have been typed. It used to start a line of its own, at column 0.
    [InlineData("\"mod_a\", \"mod_b\",", "\"mod_a\", \"mod_b\", \"mod_c\",")]
    // A note at the end of that line stays at the end of it.
    [InlineData("\"mod_a\", \"mod_b\", // the core", "\"mod_a\", \"mod_b\", \"mod_c\", // the core")]
    public async Task Adding_to_ids_laid_out_several_to_a_line_continues_the_last_line(string before, string after)
    {
        var shape = Shape.Replace(
            """
                        "mod_a",
                        "mod_b", // the one people forget
            """,
            $"            {before}");
        var root = await CreateAsync(("Shape.cs", shape));
        try
        {
            await using var engine = await StemmaEngine.OpenAsync(root);
            Applied(await engine.SaveViewAsync("op", new ArchView("view_shape", "What ships", "all", ["mod_a", "mod_b", "mod_c"])));

            (await File.ReadAllTextAsync(Path.Combine(root, "Views", "Shape.cs"))).Should()
                .Be(shape.Replace($"            {before}", $"            {after}"));
        }
        finally { Directory.Delete(root, recursive: true); }
    }

    [Theory]
    // The folder name was the namespace when the model declares none, and a folder called my-arch
    // wrote `namespace my-arch…;`: the save was refused as breaking the build.
    [InlineData("my-arch")]
    [InlineData("2026 model")]
    [InlineData("class")]
    public async Task A_new_view_in_a_model_without_a_namespace_compiles_whatever_the_folder_is_called(string folder)
    {
        var parent = Path.Combine(Path.GetTempPath(), $"stemma-views-{Guid.NewGuid():N}");
        var root = Path.Combine(parent, folder);
        Directory.CreateDirectory(Path.Combine(root, "Architecture"));
        await File.WriteAllTextAsync(Path.Combine(root, "Architecture", "Architecture.cs"), Model.Replace("namespace Scratch;\n\n", ""));
        try
        {
            await using var engine = await StemmaEngine.OpenAsync(root);

            Applied(await engine.SaveViewAsync("op", new ArchView("view_new", "My view", "all", ["mod_a"])));

            ViewsAdapter.ReadAllFrom(await engine.CollectAllDocumentsAsync()).Should().ContainSingle(v => v.Id == "view_new");
        }
        finally { Directory.Delete(parent, recursive: true); }
    }
}
