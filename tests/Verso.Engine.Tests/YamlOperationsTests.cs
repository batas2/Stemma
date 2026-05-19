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

    private const string SeedWithReferences =
        "version: 1\nconcepts:\n  - id: agg_order\n    kind: AggregateRoot\n    name: Order\n    layer: data\n\n  - id: ent_line\n    kind: DomainEntity\n    name: Line\n    layer: data\n    parent: agg_order\nrelations:\n  - id: rel_lines\n    kind: composes\n    from: agg_order\n    to: ent_line\n";

    [Fact]
    public void RenameConceptId_updates_target_id_relations_and_parent_references()
    {
        var (dir, adapter) = NewWorkspace(SeedWithReferences);
        try
        {
            var touched = YamlMutations.RenameConceptId(adapter, "agg_order", "agg_purchase_order");
            touched.Should().BeGreaterThanOrEqualTo(3); // id + relation.from + entity.parent

            var file = adapter.Files["data-model.verso.yaml"];
            adapter.Save(file);
            var saved = File.ReadAllText(file.FilePath);

            saved.Should().Contain("  - id: agg_purchase_order");
            saved.Should().NotContain("  - id: agg_order");
            saved.Should().Contain("    parent: agg_purchase_order");
            saved.Should().Contain("    from: agg_purchase_order");
        }
        finally { Directory.Delete(dir, true); }
    }

    [Fact]
    public void RenameConceptId_rejects_collision_with_existing_id()
    {
        var (dir, adapter) = NewWorkspace(SeedWithReferences);
        try
        {
            var act = () => YamlMutations.RenameConceptId(adapter, "agg_order", "ent_line");
            act.Should().Throw<InvalidOperationException>().WithMessage("*ent_line*already in use*");
        }
        finally { Directory.Delete(dir, true); }
    }

    [Fact]
    public void RenameConceptId_unknown_id_throws()
    {
        var (dir, adapter) = NewWorkspace(SeedFixture);
        try
        {
            var act = () => YamlMutations.RenameConceptId(adapter, "agg_missing", "agg_other");
            act.Should().Throw<InvalidOperationException>().WithMessage("*agg_missing*not found*");
        }
        finally { Directory.Delete(dir, true); }
    }

    [Fact]
    public void RenameConceptId_noop_when_old_equals_new()
    {
        var (dir, adapter) = NewWorkspace(SeedWithReferences);
        try
        {
            var touched = YamlMutations.RenameConceptId(adapter, "agg_order", "agg_order");
            touched.Should().Be(0);
        }
        finally { Directory.Delete(dir, true); }
    }

    [Fact]
    public void RenameConceptId_propagates_across_multiple_files()
    {
        var dir = Path.Combine(Path.GetTempPath(), "verso-yaml-op-" + Guid.NewGuid());
        var conceptsDir = Path.Combine(dir, "Concepts");
        Directory.CreateDirectory(conceptsDir);
        File.WriteAllText(Path.Combine(conceptsDir, "data-model.verso.yaml"),
            "version: 1\nconcepts:\n  - id: agg_order\n    kind: AggregateRoot\n    name: Order\n");
        File.WriteAllText(Path.Combine(conceptsDir, "resources.verso.yaml"),
            "version: 1\nconcepts:\n  - id: res_order\n    kind: Resource\n    name: OrderResource\n    aggregate: agg_order\n");
        try
        {
            var adapter = YamlAdapter.Load(dir);
            YamlMutations.RenameConceptId(adapter, "agg_order", "agg_purchase_order");
            foreach (var f in adapter.Files.Values) adapter.Save(f);

            var dataModel = File.ReadAllText(Path.Combine(conceptsDir, "data-model.verso.yaml"));
            var resources = File.ReadAllText(Path.Combine(conceptsDir, "resources.verso.yaml"));
            dataModel.Should().Contain("  - id: agg_purchase_order");
            resources.Should().Contain("    aggregate: agg_purchase_order");
            resources.Should().NotContain("agg_order");
        }
        finally { Directory.Delete(dir, true); }
    }
}
