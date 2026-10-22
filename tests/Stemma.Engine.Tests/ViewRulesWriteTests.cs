using FluentAssertions;
using Microsoft.CodeAnalysis.CSharp;
using Stemma.Engine.ArchModel;
using Stemma.Engine.Operations;
using Stemma.Engine.Workspace;
using Xunit;

namespace Stemma.Engine.Tests;

/// <summary>
/// A view's scope and rules (ADR-0026), saved the way its members are: each argument edited where it
/// stands, in the form the file writes it, and a rule the canvas did not touch left exactly as written.
/// Removing a rule-selected element from a view adds it to <c>Exclude</c>, so the rule stays live; a
/// save that rewrote or dropped the rule would turn a view stated as intent back into a list. Each
/// case compares the whole file.
/// </summary>
public sealed class ViewRulesWriteTests
{
    private const string Model = """
        using Stemma.Model;

        namespace Scratch;

        public static class Architecture
        {
            public static Model Build()
            {
                var shop = new SoftwareSystem("sys_shop", "Shop");
                var web = new Container("cnt_web", "Web Shop", "sys_shop", "spa");
                var store = new Container("cnt_store", "Order Store", "sys_shop");
                var buyer = new Person("per_buyer", "Buyer");
                return Model.Of(shop, web, store, buyer);
            }
        }
        """;

    /// <summary>Named arguments, the rules as <c>new[] { … }</c>, a comment beside the scope.</summary>
    private const string Named = """
        using Stemma.Model;

        namespace Scratch;

        /// <summary>The shop's containers, and whoever talks to them.</summary>
        public static class ShopContainers
        {
            public static View Define() => new(
                Id: "view_shop",
                Name: "Shop containers",
                BaseView: "container",
                Scope: "sys_shop", // the boundary
                Include: new[] { "kind:person" });
        }
        """;

    /// <summary>Positional arguments, the rules as collection expressions, one of them over lines.</summary>
    private const string Positional = """
        using Stemma.Model;

        namespace Scratch;

        public static class ShopContext
        {
            public static View Define() => new("view_ctx", "Shop in context", "systemContext", [], "sys_shop", ["kind:person"], [
                "per_admin",
            ]);
        }
        """;

    private static async Task<string> CreateAsync(string file, string text)
    {
        var root = Path.Combine(Path.GetTempPath(), $"stemma-viewrules-{Guid.NewGuid():N}");
        Directory.CreateDirectory(Path.Combine(root, "Architecture"));
        Directory.CreateDirectory(Path.Combine(root, "Views"));
        await File.WriteAllTextAsync(Path.Combine(root, "Architecture", "Architecture.cs"), Model);
        await File.WriteAllTextAsync(Path.Combine(root, "Views", file), text);
        return root;
    }

    /// <summary>Save <paramref name="view"/> over <paramref name="text"/> through the engine, and return the file.</summary>
    private static async Task<string> SaveAsync(string file, string text, ArchView view)
    {
        var root = await CreateAsync(file, text);
        try
        {
            await using var engine = await StemmaEngine.OpenAsync(root);
            var result = await engine.SaveViewAsync("op", view);
            if (result is OperationFailed f) throw new Xunit.Sdk.XunitException($"{f.Reason}: {f.Message}");
            return await File.ReadAllTextAsync(Path.Combine(root, "Views", file));
        }
        finally { Directory.Delete(root, recursive: true); }
    }

    [Fact]
    public async Task Excluding_an_element_appends_Exclude_by_name_and_keeps_the_scope_and_the_include()
    {
        var saved = await SaveAsync("ShopContainers.cs", Named,
            new ArchView("view_shop", "Shop containers", "container", [], Exclude: ["cnt_store"]));

        saved.Should().Be(Named.Replace(
            "        Include: new[] { \"kind:person\" });",
            "        Include: new[] { \"kind:person\" },\n        Exclude: [\"cnt_store\"]);"));
    }

    [Fact]
    public async Task A_scope_and_an_include_sent_back_as_they_were_change_nothing()
    {
        var saved = await SaveAsync("ShopContainers.cs", Named,
            new ArchView("view_shop", "Shop containers", "container", [], "sys_shop", ["kind:person"], []));

        saved.Should().Be(Named);
    }

    [Fact]
    public async Task Adding_to_a_positional_exclude_lays_the_new_id_out_like_the_last()
    {
        var saved = await SaveAsync("ShopContext.cs", Positional,
            new ArchView("view_ctx", "Shop in context", "systemContext", [], Exclude: ["per_admin", "per_buyer"]));

        saved.Should().Be(Positional.Replace(
            "        \"per_admin\",\n",
            "        \"per_admin\",\n        \"per_buyer\",\n"));
    }

    [Fact]
    public async Task A_positional_scope_and_include_are_edited_where_they_stand()
    {
        var saved = await SaveAsync("ShopContext.cs", Positional,
            new ArchView("view_ctx", "Shop in context", "systemContext", [], "sys_platform", ["kind:person", "kind:softwareSystem"]));

        saved.Should().Be(Positional.Replace(
            "[], \"sys_shop\", [\"kind:person\"], [",
            "[], \"sys_platform\", [\"kind:person\", \"kind:softwareSystem\"], ["));
    }

    [Fact]
    public async Task An_emptied_exclude_written_as_new_array_becomes_an_empty_collection()
    {
        // `new[] { }` has no type to infer, so it cannot be left empty and still compile.
        var text = Named.Replace("Include: new[] { \"kind:person\" });", "Include: new[] { \"kind:person\" },\n        Exclude: new[] { \"cnt_store\" });");

        var saved = await SaveAsync("ShopContainers.cs", text,
            new ArchView("view_shop", "Shop containers", "container", [], Exclude: []));

        saved.Should().Be(text.Replace("Exclude: new[] { \"cnt_store\" }", "Exclude: []"));
    }

    [Fact]
    public async Task An_empty_scope_removes_it_and_the_comment_on_its_line_goes_with_it()
    {
        var saved = await SaveAsync("ShopContainers.cs", Named,
            new ArchView("view_shop", "Shop containers", "all", [], Scope: ""));

        saved.Should().Be(Named
            .Replace("BaseView: \"container\"", "BaseView: \"all\"")
            .Replace("        Scope: \"sys_shop\", // the boundary\n", ""));
    }

    [Fact]
    public async Task Members_added_to_a_rule_based_view_go_into_ElementIds_by_name()
    {
        var saved = await SaveAsync("ShopContainers.cs", Named,
            new ArchView("view_shop", "Shop containers", "container", ["sys_payments"]));

        saved.Should().Be(Named.Replace(
            "        Include: new[] { \"kind:person\" });",
            "        Include: new[] { \"kind:person\" },\n        ElementIds: [\"sys_payments\"]);"));
    }

    [Fact]
    public void Scope_include_and_exclude_are_read_in_either_form_and_absent_ones_are_null()
    {
        static ArchView Read(string text) => ViewsAdapter.TryReadOne(CSharpSyntaxTree.ParseText(text).GetRoot())!;

        var named = Read(Named);
        (named.Scope, named.Include, named.Exclude, named.ElementIds).Should()
            .BeEquivalentTo(("sys_shop", new[] { "kind:person" }, (string[]?)null, Array.Empty<string>()));
        var positional = Read(Positional);
        (positional.Scope, positional.Include, positional.Exclude).Should()
            .BeEquivalentTo(("sys_shop", new[] { "kind:person" }, new[] { "per_admin" }));
    }

    [Fact]
    public void A_new_rule_based_view_is_written_with_its_scope_and_rules_and_no_empty_list()
    {
        var text = ViewsAdapter.Render("Scratch", "ShopContainers",
            new ArchView("view_shop", "Shop containers", "container", [], "sys_shop", ["kind:person"], ["cnt_store"]));

        text.Should().Be("""
            using Stemma.Model;

            namespace Scratch;

            public static class ShopContainers
            {
                public static View Define() => new(
                    Id: "view_shop",
                    Name: "Shop containers",
                    BaseView: "container",
                    Scope: "sys_shop",
                    Include: ["kind:person"],
                    Exclude: ["cnt_store"]);
            }

            """);
    }
}
