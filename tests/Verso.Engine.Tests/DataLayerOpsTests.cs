using FluentAssertions;
using Verso.Engine.Adapters.Yaml;
using Xunit;

namespace Verso.Engine.Tests;

public sealed class DataLayerOpsTests
{
    private static (string Dir, YamlAdapter Adapter) NewWorkspace()
    {
        var dir = Path.Combine(Path.GetTempPath(), "verso-dl-" + Guid.NewGuid());
        Directory.CreateDirectory(Path.Combine(dir, "Concepts"));
        return (dir, YamlAdapter.Load(dir));
    }

    [Fact]
    public void AddAggregateRoot_writes_data_model_file_with_correct_kind()
    {
        var (dir, adapter) = NewWorkspace();
        try
        {
            DataLayerOps.AddAggregateRoot(adapter, "agg_order", "Order", contextId: "ctx_ordering");
            adapter.Save(adapter.Files[DataLayerOps.DataModelFile]);
            var saved = File.ReadAllText(Path.Combine(dir, "Concepts", DataLayerOps.DataModelFile));
            saved.Should().Contain("    kind: AggregateRoot");
            saved.Should().Contain("    name: Order");
            saved.Should().Contain("    contextId: ctx_ordering");
        }
        finally { Directory.Delete(dir, true); }
    }

    [Fact]
    public void AddDomainEntity_links_entity_to_aggregate_via_parent_property()
    {
        var (dir, adapter) = NewWorkspace();
        try
        {
            DataLayerOps.AddAggregateRoot(adapter, "agg_order", "Order");
            DataLayerOps.AddDomainEntity(adapter, "ent_line", "OrderLine", parentAggregateId: "agg_order");
            adapter.Save(adapter.Files[DataLayerOps.DataModelFile]);
            var saved = File.ReadAllText(Path.Combine(dir, "Concepts", DataLayerOps.DataModelFile));
            saved.Should().Contain("    kind: DomainEntity");
            saved.Should().Contain("    parent: agg_order");
        }
        finally { Directory.Delete(dir, true); }
    }

    [Fact]
    public void AddResource_writes_to_resources_file_with_actions_csv()
    {
        var (dir, adapter) = NewWorkspace();
        try
        {
            DataLayerOps.AddResource(adapter, "res_root", "Org", actions: new[] { "read", "write" });
            adapter.Save(adapter.Files[DataLayerOps.ResourcesFile]);
            var saved = File.ReadAllText(Path.Combine(dir, "Concepts", DataLayerOps.ResourcesFile));
            saved.Should().Contain("    kind: Resource");
            saved.Should().Contain("    actions: read,write");
        }
        finally { Directory.Delete(dir, true); }
    }

    [Fact]
    public void MoveEntityToAggregate_updates_parent_property_only()
    {
        var (dir, adapter) = NewWorkspace();
        try
        {
            DataLayerOps.AddAggregateRoot(adapter, "agg_a", "A");
            DataLayerOps.AddAggregateRoot(adapter, "agg_b", "B");
            DataLayerOps.AddDomainEntity(adapter, "ent_x", "X", "agg_a");
            adapter.Save(adapter.Files[DataLayerOps.DataModelFile]);
            DataLayerOps.MoveEntityToAggregate(adapter, "ent_x", "agg_b");
            adapter.Save(adapter.Files[DataLayerOps.DataModelFile]);
            var saved = File.ReadAllText(Path.Combine(dir, "Concepts", DataLayerOps.DataModelFile));
            saved.Should().Contain("    parent: agg_b");
            saved.Should().NotContain("    parent: agg_a");
        }
        finally { Directory.Delete(dir, true); }
    }

    [Fact]
    public void SetResourceActions_replaces_actions_csv()
    {
        var (dir, adapter) = NewWorkspace();
        try
        {
            DataLayerOps.AddResource(adapter, "res_root", "Org", actions: new[] { "read" });
            adapter.Save(adapter.Files[DataLayerOps.ResourcesFile]);
            DataLayerOps.SetResourceActions(adapter, "res_root", new[] { "read", "write", "delete" });
            adapter.Save(adapter.Files[DataLayerOps.ResourcesFile]);
            var saved = File.ReadAllText(Path.Combine(dir, "Concepts", DataLayerOps.ResourcesFile));
            saved.Should().Contain("    actions: read,write,delete");
        }
        finally { Directory.Delete(dir, true); }
    }
}
