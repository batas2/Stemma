using FluentAssertions;
using Verso.Engine.Adapters.Yaml;
using Xunit;

namespace Verso.Engine.Tests;

public sealed class YamlOperationsTests
{
    private static (string Dir, YamlAdapter Adapter) NewWorkspace(string? seed = null)
    {
        var dir = Path.Combine(Path.GetTempPath(), "verso-yaml-op-" + Guid.NewGuid());
        var conceptsDir = Path.Combine(dir, "Concepts");
        Directory.CreateDirectory(conceptsDir);
        if (seed is not null)
            File.WriteAllText(Path.Combine(conceptsDir, "data-model.verso.yaml"), seed);
        return (dir, YamlAdapter.Load(dir));
    }

    private const string SeedFixture =
        "version: 1\n\n# A seed file.\nconcepts:\n  - id: agg_order\n    kind: AggregateRoot\n    name: Order\n    layer: data\n\n  - id: ent_line\n    kind: DomainEntity\n    name: Line\n    layer: data\n";

    [Fact]
    public void AddConcept_appends_to_existing_section_preserving_prior_entries()
    {
        var (dir, adapter) = NewWorkspace(SeedFixture);
        try
        {
            YamlMutations.AddConcept(adapter, "data-model.verso.yaml", "vo_money", "ValueObject", "Money", "data");
            var file = adapter.Files["data-model.verso.yaml"];
            adapter.Save(file);
            var saved = File.ReadAllText(file.FilePath);
            // Existing two entries must survive byte-identically inside the saved file.
            saved.Should().Contain("  - id: agg_order\n    kind: AggregateRoot\n    name: Order\n    layer: data\n");
            saved.Should().Contain("  - id: ent_line\n    kind: DomainEntity\n    name: Line\n    layer: data\n");
            saved.Should().Contain("  - id: vo_money");
            saved.Should().Contain("    name: Money");
        }
        finally { Directory.Delete(dir, true); }
    }

    [Fact]
    public void AddConcept_to_fresh_file_writes_header_and_section()
    {
        var (dir, adapter) = NewWorkspace();
        try
        {
            YamlMutations.AddConcept(adapter, "data-model.verso.yaml", "agg_order", "AggregateRoot", "Order", "data");
            var file = adapter.Files["data-model.verso.yaml"];
            adapter.Save(file);
            var saved = File.ReadAllText(file.FilePath);
            saved.Should().StartWith("version: 1");
            saved.Should().Contain("concepts:\n  - id: agg_order");
        }
        finally { Directory.Delete(dir, true); }
    }

    [Fact]
    public void UpdateConceptProperty_rewrites_only_changed_key_line()
    {
        var (dir, adapter) = NewWorkspace(SeedFixture);
        try
        {
            var file = adapter.Files["data-model.verso.yaml"];
            var entry = file.FindConcept("agg_order")!;
            YamlMutations.UpdateConceptProperty(entry, "layer", "domain");
            adapter.Save(file);
            var saved = File.ReadAllText(file.FilePath);
            saved.Should().Contain("    name: Order\n    layer: domain");
            // The other concept is byte-identical.
            saved.Should().Contain("  - id: ent_line\n    kind: DomainEntity\n    name: Line\n    layer: data\n");
        }
        finally { Directory.Delete(dir, true); }
    }

    [Fact]
    public void RemoveConcept_keeps_surrounding_blank_lines_for_neighbours()
    {
        var (dir, adapter) = NewWorkspace(SeedFixture);
        try
        {
            var file = adapter.Files["data-model.verso.yaml"];
            YamlMutations.RemoveConcept(file, "agg_order");
            adapter.Save(file);
            var saved = File.ReadAllText(file.FilePath);
            saved.Should().NotContain("agg_order");
            saved.Should().Contain("  - id: ent_line\n    kind: DomainEntity\n    name: Line\n");
        }
        finally { Directory.Delete(dir, true); }
    }

    [Fact]
    public void RenameConcept_updates_name_only()
    {
        var (dir, adapter) = NewWorkspace(SeedFixture);
        try
        {
            var file = adapter.Files["data-model.verso.yaml"];
            YamlMutations.RenameConcept(file.FindConcept("agg_order")!, "PurchaseOrder");
            adapter.Save(file);
            var saved = File.ReadAllText(file.FilePath);
            saved.Should().Contain("    name: PurchaseOrder");
            saved.Should().NotContain("    name: Order\n");
            // id stays.
            saved.Should().Contain("  - id: agg_order");
        }
        finally { Directory.Delete(dir, true); }
    }
}
