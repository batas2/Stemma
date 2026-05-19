using FluentAssertions;
using Verso.Engine.Adapters.Yaml;
using Xunit;

namespace Verso.Engine.Tests;

public sealed class YamlCrossAdapterValidatorTests
{
    private static YamlAdapter LoadWith(string yamlText)
    {
        var dir = Path.Combine(Path.GetTempPath(), "verso-cross-" + Guid.NewGuid());
        Directory.CreateDirectory(Path.Combine(dir, "Concepts"));
        File.WriteAllText(Path.Combine(dir, "Concepts", "data-model.verso.yaml"), yamlText);
        return YamlAdapter.Load(dir);
    }

    [Fact]
    public void Dangling_relation_endpoint_surfaces_warning()
    {
        const string yaml =
            "version: 1\nconcepts:\n  - id: agg_order\n    kind: AggregateRoot\n    name: Order\nrelations:\n  - id: rel_a\n    kind: composes\n    from: agg_order\n    to: ent_ghost\n";
        var adapter = LoadWith(yaml);
        var violations = YamlCrossAdapterValidator.Run(adapter, arch: null);
        violations.Should().ContainSingle().Which.Message.Should().Contain("ent_ghost");
    }

    [Fact]
    public void All_endpoints_resolve_when_target_is_a_yaml_concept()
    {
        const string yaml =
            "version: 1\nconcepts:\n  - id: agg_order\n    kind: AggregateRoot\n    name: Order\n  - id: ent_line\n    kind: DomainEntity\n    name: Line\nrelations:\n  - id: rel_a\n    kind: composes\n    from: agg_order\n    to: ent_line\n";
        var adapter = LoadWith(yaml);
        var violations = YamlCrossAdapterValidator.Run(adapter, arch: null);
        violations.Should().BeEmpty();
    }

    [Fact]
    public void Property_pointing_to_unknown_id_surfaces_violation()
    {
        const string yaml =
            "version: 1\nconcepts:\n  - id: ent_line\n    kind: DomainEntity\n    name: Line\n    parent: agg_missing\n";
        var adapter = LoadWith(yaml);
        var violations = YamlCrossAdapterValidator.Run(adapter, arch: null);
        violations.Should().ContainSingle().Which.Message.Should().Contain("agg_missing");
    }
}
