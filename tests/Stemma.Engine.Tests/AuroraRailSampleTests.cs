using System.Runtime.CompilerServices;
using System.Text.Json;
using System.Text.RegularExpressions;
using FluentAssertions;
using Microsoft.CodeAnalysis.CSharp;
using Stemma.Engine.Adapters.Yaml;
using Stemma.Engine.ArchModel;
using Stemma.Engine.Workspace;
using Xunit;

namespace Stemma.Engine.Tests;

/// <summary>
/// Guards the reference workspace under <c>samples/AuroraRail</c>. It is the workspace the docs
/// point newcomers at, so it has to stay loadable and internally consistent: the C# compiler does
/// not check the string ids used in flows, dependencies, `AboutId`, views or the layout sidecar,
/// and neither does anything else at runtime. These tests do.
/// </summary>
public sealed class AuroraRailSampleTests
{
    private static string SampleRoot([CallerFilePath] string file = "") =>
        Path.GetFullPath(Path.Combine(Path.GetDirectoryName(file)!, "..", "..", "samples", "AuroraRail"));

    private static ArchModel.ArchModel LoadArch()
    {
        var path = Path.Combine(SampleRoot(), "Architecture", "Architecture.cs");
        var tree = CSharpSyntaxTree.ParseText(File.ReadAllText(path));
        var model = DslReader.TryRead(path, tree.GetRoot());
        model.Should().NotBeNull("the sample must expose a parseable Architecture.Build()");
        return model!;
    }

    /// <summary>The sample minus its project file, in a temp folder that the OS cleans up.</summary>
    private static string CopyAsModelOnlyWorkspace()
    {
        var source = SampleRoot();
        var root = Path.Combine(Path.GetTempPath(), $"stemma-aurorarail-{Guid.NewGuid():N}");
        foreach (var dir in new[] { "Architecture", "Views", "Concepts" })
        {
            Directory.CreateDirectory(Path.Combine(root, dir));
            foreach (var file in Directory.EnumerateFiles(Path.Combine(source, dir)))
                File.Copy(file, Path.Combine(root, dir, Path.GetFileName(file)));
        }
        File.Copy(Path.Combine(source, "stemma.layout.json"), Path.Combine(root, "stemma.layout.json"));
        return root;
    }

    private static IReadOnlyList<ArchView> LoadViews()
    {
        var docs = Directory.EnumerateFiles(Path.Combine(SampleRoot(), "Views"), "*.cs")
            .Select(p => (FilePath: p, Root: (Microsoft.CodeAnalysis.SyntaxNode)CSharpSyntaxTree.ParseText(File.ReadAllText(p)).GetRoot()));
        return ViewsAdapter.ReadAllFrom(SampleRoot(), docs);
    }

    [Fact]
    public void Model_covers_every_element_and_link_kind()
    {
        var arch = LoadArch();

        // `Concept` and `Relation` are excluded on purpose. Aurora Rail is a rail-ticketing
        // platform: it has an architecture, not an argument, and every one of its elements and
        // arrows claims something about a system. Dropping either in to satisfy a coverage
        // assertion would be precisely the register-mixing ADR-0018 and ADR-0019 exist to stop —
        // in the workspace people copy from. The right home for both is a figure-shaped sample,
        // which does not exist yet (F-010).
        var structuralElements = Enum.GetValues<ArchElementKind>().Except([ArchElementKind.Concept]);
        var structuralLinks = Enum.GetValues<ArchLinkKind>().Except([ArchLinkKind.Relation]);
        arch.Elements.Select(e => e.Kind).Distinct().Should().BeEquivalentTo(
            structuralElements,
            "the reference workspace is what people copy from - it should demonstrate the whole structural vocabulary");
        arch.Links.Select(l => l.Kind).Distinct().Should().BeEquivalentTo(structuralLinks);
        arch.Elements.Should().HaveCountGreaterThan(50);
    }

    [Fact]
    public void Lifecycle_and_ownership_tags_are_read_back()
    {
        var arch = LoadArch();

        arch.Tags.Should().HaveCountGreaterThan(10, "tags must be bare `Tag.For(...)` statements to be readable");
        arch.Tags.Should().Contain(t => t.TargetId == "sys_reserva" && t.Lifecycle!.Status == "deprecated");
        arch.Tags.Should().Contain(t => t.TargetId == "mod_apportion" && t.Lifecycle!.Status == "to-be-created");
        arch.Tags.Where(t => t.Ownership is not null).Select(t => t.Ownership!.Squad).Distinct()
            .Should().Contain(new[] { "Platform", "Sell", "Fulfil", "Care", "Insight" });
        arch.Tags.Should().OnlyContain(t => arch.Elements.Any(e => e.Id == t.TargetId)
                                            || arch.Links.Any(l => l.Id == t.TargetId));
    }

    [Fact]
    public void No_link_endpoint_context_or_about_id_dangles()
    {
        var arch = LoadArch();
        var ids = arch.Elements.Select(e => e.Id).ToHashSet(StringComparer.Ordinal);

        arch.Links.SelectMany(l => new[] { l.FromId, l.ToId }).Where(i => !ids.Contains(i))
            .Should().BeEmpty("every flow and dependency endpoint must resolve to a declared element");

        arch.Elements
            .SelectMany(e => new[] { Attr(e, "contextId"), Attr(e, "aboutId"), Attr(e, "systemId") })
            .Where(i => i is not null && !ids.Contains(i))
            .Should().BeEmpty("contextId / aboutId / systemId must resolve too");

        static string? Attr(ArchElement e, string key) =>
            e.Attributes.TryGetValue(key, out var v) && !string.IsNullOrEmpty(v) ? v : null;
    }

    [Fact]
    public void Views_are_declared_and_reference_real_elements()
    {
        var arch = LoadArch();
        var views = LoadViews();
        var ids = arch.Elements.Select(e => e.Id).ToHashSet(StringComparer.Ordinal);

        views.Select(v => v.Id).Should().BeEquivalentTo(
            new[] { "view_buy", "view_strangler", "view_deps", "view_concerns" });
        views.Should().OnlyContain(v => v.ElementIds.Count > 0);
        views.SelectMany(v => v.ElementIds).Where(i => !ids.Contains(i))
            .Should().BeEmpty("a view listing an unknown id renders a silently missing node");
        views.Select(v => v.BaseView).Should().OnlyContain(
            b => b == "moduleMap" || b == "dependencyGraph" || b == "concerns" || b == "all");
    }

    [Fact]
    public void Layout_sidecar_positions_only_known_elements()
    {
        var arch = LoadArch();
        var views = LoadViews();
        var layout = LayoutSidecar.Read(SampleRoot());
        var ids = arch.Elements.Select(e => e.Id).ToHashSet(StringComparer.Ordinal);
        var linkIds = arch.Links.Select(l => l.Id).ToHashSet(StringComparer.Ordinal);

        layout.Views.Keys.Should().Contain(new[] { "moduleMap", "dependencyGraph", "custom:view_buy" });
        layout.Views.Values.SelectMany(v => v.Nodes.Keys).Where(i => !ids.Contains(i))
            .Should().BeEmpty("a stale position is presentation drift - the thing Stemma exists to prevent");
        layout.NodeStyles.Keys.Concat(layout.Notes.Keys).Concat(layout.CustomProps.Keys)
            .Where(i => !ids.Contains(i)).Should().BeEmpty();
        layout.EdgeStyles.Keys.Where(i => !linkIds.Contains(i)).Should().BeEmpty();

        foreach (var view in views)
        {
            var key = $"custom:{view.Id}";
            layout.Views.Should().ContainKey(key, "every saved view ships with a layout");
            layout.Views[key].Nodes.Keys.Should().BeSubsetOf(view.ElementIds);
        }
    }

    [Fact]
    public void Concept_files_load_and_cross_reference_the_model()
    {
        var yaml = YamlAdapter.Load(SampleRoot());
        yaml.Files.Keys.Should().BeEquivalentTo("data-model.stemma.yaml", "resources.stemma.yaml");

        var data = yaml.Files["data-model.stemma.yaml"];
        data.Concepts.Select(c => c.Id).Should().Contain(new[] { "agg_order", "agg_ticket", "vo_money", "vo_barcode" });
        data.Concepts.First(c => c.Id == "agg_order").Kind.Should().Be("AggregateRoot");
        data.Concepts.First(c => c.Id == "ent_order_line").Properties
            .Should().ContainEquivalentOf(new KeyValuePair<string, string>("parent", "agg_order"));

        var res = yaml.Files["resources.stemma.yaml"];
        res.Concepts.Should().OnlyContain(c => c.Kind == "Resource");
        var nests = res.Relations.Where(r => r.Kind == "nests").ToList();
        nests.Should().Contain(r => r.From == "res_root" && r.To == "res_orders");
        nests.Should().Contain(r => r.From == "res_order" && r.To == "res_tickets");

        // The `owner:` properties point into Architecture.cs — that is the cross-adapter contract.
        YamlCrossAdapterValidator.Run(yaml, LoadArch()).Should().BeEmpty();
    }

    [Fact]
    public void Books_tell_three_stories_over_views_and_elements_that_exist()
    {
        // Books are presentation and live in the sidecar (ADR-0022). Read as JSON rather than through
        // `LayoutSidecar`: the client owns the section's shape, and the engine stores it unread.
        var elements = LoadArch().Elements.Select(e => e.Id).ToHashSet(StringComparer.Ordinal);
        var views = LoadViews().ToDictionary(v => v.Id, StringComparer.Ordinal);
        var builtIn = new[] { "moduleMap", "dependencyGraph" };

        using var sidecar = JsonDocument.Parse(File.ReadAllText(Path.Combine(SampleRoot(), "stemma.layout.json")));
        var books = sidecar.RootElement.GetProperty("books").EnumerateObject().ToList();

        books.Select(b => b.Name).Should().BeEquivalentTo(
            "book_ticket_sold", "book_reserva_exit", "book_disruption_day");
        books.Select(b => Text(b.Value, "audience")).Should().BeEquivalentTo("engineering", "leadership", "operations");

        foreach (var book in books)
        {
            var pages = book.Value.GetProperty("pages").EnumerateObject().ToList();
            pages.Should().HaveCountGreaterThanOrEqualTo(3, $"`{book.Name}` tells a story, not a slide");
            Text(book.Value, "name").Should().NotBeEmpty();

            var order = book.Value.GetProperty("order").EnumerateArray().Select(o => o.GetString()).ToList();
            order.Should().OnlyHaveUniqueItems().And.BeEquivalentTo(
                pages.Select(p => p.Name), $"`{book.Name}`'s order must list every page, and nothing else");

            foreach (var page in pages)
            {
                var where = $"{book.Name}/{page.Name}";
                Text(page.Value, "title").Should().NotBeEmpty(where);
                Text(page.Value, "narrative").Should().NotBeEmpty(where);

                var view = Text(page.Value, "view");
                (builtIn.Contains(view) || views.ContainsKey(view)).Should().BeTrue(
                    $"{where} shows `{view}`, and a page pointing at a deleted view is a broken slide in a live presentation");

                var focus = Focus(page.Value);
                focus.Where(id => !elements.Contains(id)).Should().BeEmpty(
                    $"{where} points at elements, and an element that is gone cannot be pointed at");
                if (views.TryGetValue(view, out var declared))
                    focus.Except(declared.ElementIds).Should().BeEmpty(
                        $"{where} can only light what `{view}` draws");
                if (page.Value.TryGetProperty("frame", out var frame))
                    frame.GetString().Should().BeOneOf(new[] { "view", "focus" }, where);
            }

            pages.Select(p => Focus(p.Value).Count).Should().Contain(n => n > 0,
                $"`{book.Name}` should point at something its narrative talks about, not only show whole views");
        }

        static string Text(JsonElement obj, string key) =>
            obj.TryGetProperty(key, out var value) && value.ValueKind == JsonValueKind.String ? value.GetString()! : "";

        static List<string> Focus(JsonElement page) =>
            page.TryGetProperty("focus", out var focus)
                ? focus.EnumerateArray().Select(f => f.GetString()!).ToList()
                : [];
    }

    [Theory]
    [InlineData("data-model.stemma.yaml")]
    [InlineData("resources.stemma.yaml")]
    public void Concept_files_round_trip_byte_identical(string fileName)
    {
        var path = Path.Combine(SampleRoot(), "Concepts", fileName);
        var original = File.ReadAllText(path);
        var parsed = YamlConceptReader.Parse(path, original);
        YamlConceptWriter.Render(parsed).Should().Be(original);
    }

    [Fact]
    public async Task Workspace_opens_through_the_engine_with_only_the_intended_violations()
    {
        // Copied to a temp folder without its .csproj so the engine takes the SDK-free path
        // (ADR-0016). That keeps the test off MSBuild — which would otherwise contend with the
        // build running this very test — and proves the sample opens with no .NET SDK installed.
        var root = CopyAsModelOnlyWorkspace();
        await using var engine = await StemmaEngine.OpenAsync(root);
        var arch = await engine.ReadArchModelAsync();

        arch.Should().NotBeNull("the workspace the README points newcomers at must open");
        arch!.Elements.Should().HaveCount(LoadArch().Elements.Count);

        var violations = Validation.RuleEngine.Default(root).Run(arch);
        violations.Where(v => v.Severity == Validation.Severity.Error).Should().BeEmpty();

        // Two warnings, on purpose, and both the same one: the seat hold and the gateline batch
        // still write into the deprecated mainframe. Those are the two remaining RESERVA write
        // paths the model is about, so the rule catching them is half the point of the sample.
        var warnings = violations.Where(v => v.Severity == Validation.Severity.Warning).ToList();
        warnings.Should().HaveCount(2);
        warnings.Should().OnlyContain(v => v.RuleId == "deprecated-element-no-incoming-flows"
                                           && v.ElementIds.Contains("sys_reserva"));
        warnings.SelectMany(v => v.LinkIds).Should().BeEquivalentTo(
            new[] { "flow_reserva_hold", "flow_gate_batch" });
    }

    [Fact]
    public void Sample_stays_free_of_real_world_identifiers()
    {
        // The repo is public. The showcase is invented on purpose; this keeps it that way.
        var forbidden = new Regex(@"\b(NBX|EcoVadis|Anakin|NetAcc|VitalsEAPI|IqApp)\b", RegexOptions.IgnoreCase);
        var files = Directory.EnumerateFiles(SampleRoot(), "*.*", SearchOption.AllDirectories)
            .Where(p => !p.Contains($"{Path.DirectorySeparatorChar}obj{Path.DirectorySeparatorChar}")
                        && !p.Contains($"{Path.DirectorySeparatorChar}bin{Path.DirectorySeparatorChar}"));

        files.Where(p => forbidden.IsMatch(File.ReadAllText(p))).Should().BeEmpty();
    }
}
