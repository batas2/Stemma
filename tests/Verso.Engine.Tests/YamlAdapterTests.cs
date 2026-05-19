using FluentAssertions;
using Verso.Engine.Adapters.Yaml;
using Xunit;

namespace Verso.Engine.Tests;

public sealed class YamlAdapterTests
{
    private static string FixturePath(string name) =>
        Path.Combine(AppContext.BaseDirectory, "Fixtures", "yaml", name);

    private static string ReadFixture(string name) => File.ReadAllText(FixturePath(name));

    [Fact]
    public void Parse_minimal_reads_version_and_one_concept()
    {
        var text = ReadFixture("minimal.verso.yaml");
        var file = YamlConceptReader.Parse(FixturePath("minimal.verso.yaml"), text);
        file.Version.Should().Be(1);
        file.Concepts.Should().HaveCount(1);
        file.Concepts[0].Id.Should().Be("agg_order");
        file.Concepts[0].Kind.Should().Be("AggregateRoot");
        file.Concepts[0].Name.Should().Be("Order");
    }

    [Fact]
    public void Parse_realistic_reads_concepts_and_relations()
    {
        var text = ReadFixture("realistic.verso.yaml");
        var file = YamlConceptReader.Parse(FixturePath("realistic.verso.yaml"), text);
        file.Concepts.Select(c => c.Id).Should().Equal("agg_order", "ent_order_line", "vo_money");
        file.Relations.Select(r => r.Id).Should().Equal("rel_order_lines", "rel_line_price");
        file.Concepts[0].Properties.Should().ContainEquivalentOf(new KeyValuePair<string, string>("domain", "ordering"));
        file.Relations[0].From.Should().Be("agg_order");
        file.Relations[0].To.Should().Be("ent_order_line");
    }

    [Fact]
    public void Parse_pathological_keeps_block_bytes_for_each_entry()
    {
        var text = ReadFixture("pathological.verso.yaml");
        var file = YamlConceptReader.Parse(FixturePath("pathological.verso.yaml"), text);
        file.Concepts.Should().HaveCount(3);
        file.Concepts[2].Name.Should().Be("Project / folder");
        // The mid-section comment is captured in one entry's OriginalBlock (trailing trivia of
        // the preceding concept). Round-trip is the actual contract — see byte-identical test.
        file.Concepts.Any(c => c.OriginalBlock.Contains("# Mid-section comment block")).Should().BeTrue();
    }

    [Theory]
    [InlineData("minimal.verso.yaml")]
    [InlineData("realistic.verso.yaml")]
    [InlineData("pathological.verso.yaml")]
    public void Roundtrip_unmodified_file_is_byte_identical(string fixture)
    {
        var text = ReadFixture(fixture);
        var file = YamlConceptReader.Parse(FixturePath(fixture), text);
        var rendered = YamlConceptWriter.Render(file);
        rendered.Should().Be(text);
    }

    [Fact]
    public void Load_rejects_file_without_version_key()
    {
        var dir = Path.Combine(Path.GetTempPath(), "verso-yaml-" + Guid.NewGuid());
        Directory.CreateDirectory(Path.Combine(dir, "Concepts"));
        File.WriteAllText(Path.Combine(dir, "Concepts", "data-model.verso.yaml"), "concepts: []\n");
        try
        {
            Action act = () => YamlAdapter.Load(dir);
            act.Should().Throw<YamlSchemaException>();
        }
        finally
        {
            Directory.Delete(dir, true);
        }
    }
}
