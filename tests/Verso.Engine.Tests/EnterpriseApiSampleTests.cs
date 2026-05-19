using System.Runtime.CompilerServices;
using FluentAssertions;
using Verso.Engine.Adapters.Yaml;
using Xunit;

namespace Verso.Engine.Tests;

/// <summary>
/// Verifies the EnterpriseApi sample under samples/EnterpriseApi/Concepts/ parses
/// cleanly and round-trips byte-identical through the YAML adapter. Epic 08 / X9.
/// </summary>
public sealed class EnterpriseApiSampleTests
{
    private static string SampleRoot([CallerFilePath] string file = "") =>
        Path.GetFullPath(Path.Combine(Path.GetDirectoryName(file)!, "..", "..", "samples", "EnterpriseApi"));

    [Fact]
    public void Load_returns_three_yaml_files()
    {
        var adapter = YamlAdapter.Load(SampleRoot());
        adapter.Files.Keys.Should().BeEquivalentTo("data-model.verso.yaml", "resources.verso.yaml", "view-book.verso.yaml");
    }

    [Fact]
    public void Data_model_exposes_expected_aggregates_and_value_objects()
    {
        var adapter = YamlAdapter.Load(SampleRoot());
        var data = adapter.Files["data-model.verso.yaml"];
        data.Concepts.Select(c => c.Id).Should().Contain(new[] { "agg_batch", "agg_order", "vo_money", "vo_scorecard_score" });
        data.Concepts.First(c => c.Id == "agg_batch").Kind.Should().Be("AggregateRoot");
        data.Concepts.First(c => c.Id == "ent_order_line").Properties.Should().ContainEquivalentOf(new KeyValuePair<string, string>("parent", "agg_order"));
    }

    [Fact]
    public void Resource_tree_has_nested_chain_from_org_to_request()
    {
        var adapter = YamlAdapter.Load(SampleRoot());
        var res = adapter.Files["resources.verso.yaml"];
        res.Concepts.Should().OnlyContain(c => c.Kind == "Resource");
        var nests = res.Relations.Where(r => r.Kind == "nests").ToList();
        nests.Should().Contain(r => r.From == "res_org" && r.To == "res_tenant");
        nests.Should().Contain(r => r.From == "res_batch" && r.To == "res_request");
    }

    [Fact]
    public void Onboarding_book_has_all_six_pages_in_order()
    {
        var adapter = YamlAdapter.Load(SampleRoot());
        var view = adapter.Files["view-book.verso.yaml"];
        var onboarding = view.Books.First(b => b.Id == "book_onboarding");
        onboarding.Audience.Should().Be("engineering");
        onboarding.Pages.Select(p => p.ViewId).Should().Equal("c4Context", "moduleMap", "dependencyGraph", "dataModel", "resourceTree", "decisionLog");
    }

    [Theory]
    [InlineData("data-model.verso.yaml")]
    [InlineData("resources.verso.yaml")]
    [InlineData("view-book.verso.yaml")]
    public void Sample_round_trips_byte_identical(string fileName)
    {
        var path = Path.Combine(SampleRoot(), "Concepts", fileName);
        var original = File.ReadAllText(path);
        var parsed = YamlConceptReader.Parse(path, original);
        YamlConceptWriter.Render(parsed).Should().Be(original);
    }
}
