using FluentAssertions;
using Stemma.Web.Services;
using Xunit;

namespace Stemma.Web.Tests;

/// <summary>
/// What a brand-new workspace has to contain before anyone touches it.
///
/// The scaffold is the first thing a new user meets and the only thing an agent authoring a
/// workspace from a document has to go on, so the assertions here are about the *contract* of the
/// folder — a brief at the root, a clean working tree, a model that names itself — rather than
/// about the exact prose.
/// </summary>
public class WorkspaceScaffoldTests : IDisposable
{
    private readonly string _root = Path.Combine(Path.GetTempPath(), $"stemma-scaffold-{Guid.NewGuid():N}");

    public void Dispose()
    {
        if (Directory.Exists(_root)) Directory.Delete(_root, recursive: true);
    }

    private Task<WorkspaceScaffold.Result> CreateAsync(string name = "Payments Platform") =>
        WorkspaceScaffold.CreateAsync(name, _root);

    private string Read(string relative) => File.ReadAllText(Path.Combine(_root, relative));

    // ---- F-007 AC6: the brief ----------------------------------------------------------------

    [Fact]
    public async Task Drops_a_brief_at_the_root()
    {
        await CreateAsync();

        File.Exists(Path.Combine(_root, "STEMMA.md")).Should().BeTrue(
            "an agent editing the workspace by hand lands at the root and needs the rules there");
    }

    [Fact]
    public async Task Brief_names_the_three_files_that_make_a_workspace()
    {
        await CreateAsync();
        var brief = Read("STEMMA.md");

        brief.Should().Contain("Architecture/Architecture.cs");
        brief.Should().Contain("stemma.layout.json");
        brief.Should().Contain("Views/");
    }

    [Fact]
    public async Task Brief_carries_the_rules_nothing_else_enforces()
    {
        await CreateAsync();
        var brief = Read("STEMMA.md");

        // Ids are strings the compiler never checks, so a typo silently deletes a node or an edge.
        brief.Should().Contain("stemma validate");
        // The two failure modes that produce a picture which looks finished and is wrong.
        brief.Should().Contain("both of its endpoints are in the view");
        brief.Should().Contain("Seven boxes");
        // The vocabulary decision that is easiest to get wrong for a diagram that is an argument.
        brief.Should().Contain("Concept");
    }

    [Fact]
    public async Task Readme_points_at_the_brief()
    {
        await CreateAsync();

        Read("README.md").Should().Contain("STEMMA.md",
            "the README is what a human opens first; the brief is what they need before editing");
    }

    [Fact]
    public async Task Never_overwrites_a_brief_that_is_already_there()
    {
        Directory.CreateDirectory(_root);
        await File.WriteAllTextAsync(Path.Combine(_root, "STEMMA.md"), "House rules for this model.");

        await CreateAsync();

        Read("STEMMA.md").Should().Be("House rules for this model.",
            "scaffolding into an existing folder must not silently replace the author's own notes");
    }

    // ---- The rest of the folder contract -------------------------------------------------------

    [Fact]
    public async Task Model_is_created_under_a_namespace_derived_from_the_name()
    {
        await CreateAsync("Payments Platform");

        Read(Path.Combine("Architecture", "Architecture.cs"))
            .Should().Contain("namespace PaymentsPlatform;");
    }

    [Fact]
    public async Task Working_tree_is_clean_from_the_first_load()
    {
        await CreateAsync();

        // Loading the workspace writes obj/ if anything ever runs MSBuild over it; without this the
        // tool whose pitch is "Git-native" hands the user a folder full of build output (F-003 AC4).
        var gitignore = Read(".gitignore");
        gitignore.Should().Contain("obj/");
        gitignore.Should().Contain("bin/");
    }

    [Fact]
    public async Task Reports_where_it_put_the_model()
    {
        var result = await CreateAsync();

        result.RootPath.Should().Be(Path.GetFullPath(_root));
    }

    [Fact]
    public async Task Scaffolding_twice_over_the_same_folder_is_a_no_op()
    {
        await CreateAsync();
        var first = Read(Path.Combine("Architecture", "Architecture.cs"));

        await CreateAsync("A Different Name");

        Read(Path.Combine("Architecture", "Architecture.cs")).Should().Be(first,
            "opening a folder that is already a model must never rewrite it");
    }

    // ---- Naming --------------------------------------------------------------------------------

    [Theory]
    [InlineData("Payments Platform", "Payments-Platform")]
    [InlineData("  spaced  ", "spaced")]
    [InlineData("a/b:c", "abc")]
    [InlineData("!!!", "model")]
    public void Slug_is_folder_safe(string name, string expected) =>
        WorkspaceScaffold.Slug(name).Should().Be(expected);

    [Theory]
    [InlineData("Payments Platform", "PaymentsPlatform")]
    [InlineData("order-service", "OrderService")]
    [InlineData("2026 review", "_2026Review")]
    [InlineData("!!!", "Model")]
    public void Identifier_is_a_legal_namespace(string name, string expected) =>
        WorkspaceScaffold.Identifier(name).Should().Be(expected);
}
