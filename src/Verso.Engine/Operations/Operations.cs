using System.Text.Json.Serialization;
using Verso.Engine.Models;

namespace Verso.Engine.Operations;

[JsonPolymorphic(TypeDiscriminatorPropertyName = "kind")]
[JsonDerivedType(typeof(AddTypeOp), "AddType")]
[JsonDerivedType(typeof(RenameTypeOp), "RenameType")]
[JsonDerivedType(typeof(RemoveTypeOp), "RemoveType")]
[JsonDerivedType(typeof(AddPropertyOp), "AddProperty")]
[JsonDerivedType(typeof(RenamePropertyOp), "RenameProperty")]
[JsonDerivedType(typeof(RemovePropertyOp), "RemoveProperty")]
[JsonDerivedType(typeof(AddInheritanceOp), "AddInheritance")]
[JsonDerivedType(typeof(RemoveInheritanceOp), "RemoveInheritance")]
[JsonDerivedType(typeof(AddImplementationOp), "AddImplementation")]
[JsonDerivedType(typeof(RemoveImplementationOp), "RemoveImplementation")]
[JsonDerivedType(typeof(Verso.Engine.ArchModel.AddElementOp), "AddElement")]
[JsonDerivedType(typeof(Verso.Engine.ArchModel.RenameElementOp), "RenameElement")]
[JsonDerivedType(typeof(Verso.Engine.ArchModel.RemoveElementOp), "RemoveElement")]
[JsonDerivedType(typeof(Verso.Engine.ArchModel.SetElementAttributeOp), "SetElementAttribute")]
[JsonDerivedType(typeof(Verso.Engine.ArchModel.AddLinkOp), "AddLink")]
[JsonDerivedType(typeof(Verso.Engine.ArchModel.RemoveLinkOp), "RemoveLink")]
[JsonDerivedType(typeof(Verso.Engine.ArchModel.SetLinkAttributeOp), "SetLinkAttribute")]
[JsonDerivedType(typeof(Verso.Engine.ArchModel.SetLifecycleOp), "SetLifecycle")]
[JsonDerivedType(typeof(Verso.Engine.ArchModel.SetOwnershipOp), "SetOwnership")]
[JsonDerivedType(typeof(Verso.Engine.Workspace.RestoreElementOp), "RestoreElement")]
[JsonDerivedType(typeof(Verso.Engine.Workspace.RestoreLinkOp), "RestoreLink")]
[JsonDerivedType(typeof(Verso.Engine.ArchModel.AddDecisionOp), "AddDecision")]
[JsonDerivedType(typeof(Verso.Engine.ArchModel.RenameDecisionOp), "RenameDecision")]
[JsonDerivedType(typeof(Verso.Engine.ArchModel.SetDecisionStatusOp), "SetDecisionStatus")]
[JsonDerivedType(typeof(Verso.Engine.ArchModel.RemoveDecisionOp), "RemoveDecision")]
[JsonDerivedType(typeof(Verso.Engine.ArchModel.AddDecisionConcernsOp), "AddDecisionConcerns")]
[JsonDerivedType(typeof(Verso.Engine.ArchModel.SetDecisionNarrativeOp), "SetDecisionNarrative")]
[JsonDerivedType(typeof(Verso.Engine.ArchModel.SetCapabilityNarrativeOp), "SetCapabilityNarrative")]
[JsonDerivedType(typeof(Verso.Engine.Adapters.Yaml.AddYamlConceptOp), "AddYamlConcept")]
[JsonDerivedType(typeof(Verso.Engine.Adapters.Yaml.UpdateYamlConceptOp), "UpdateYamlConcept")]
[JsonDerivedType(typeof(Verso.Engine.Adapters.Yaml.RemoveYamlConceptOp), "RemoveYamlConcept")]
[JsonDerivedType(typeof(Verso.Engine.Adapters.Yaml.RenameYamlConceptOp), "RenameYamlConcept")]
[JsonDerivedType(typeof(Verso.Engine.Adapters.Yaml.RenameYamlConceptIdOp), "RenameYamlConceptId")]
[JsonDerivedType(typeof(Verso.Engine.Adapters.Yaml.AddYamlRelationOp), "AddYamlRelation")]
[JsonDerivedType(typeof(Verso.Engine.Adapters.Yaml.UpdateYamlRelationOp), "UpdateYamlRelation")]
[JsonDerivedType(typeof(Verso.Engine.Adapters.Yaml.RemoveYamlRelationOp), "RemoveYamlRelation")]
[JsonDerivedType(typeof(Verso.Engine.Adapters.Yaml.AddAggregateRootOp), "AddAggregateRoot")]
[JsonDerivedType(typeof(Verso.Engine.Adapters.Yaml.AddDomainEntityOp), "AddDomainEntity")]
[JsonDerivedType(typeof(Verso.Engine.Adapters.Yaml.AddValueObjectOp), "AddValueObject")]
[JsonDerivedType(typeof(Verso.Engine.Adapters.Yaml.AddResourceOp), "AddResource")]
[JsonDerivedType(typeof(Verso.Engine.Adapters.Yaml.MoveEntityToAggregateOp), "MoveEntityToAggregate")]
[JsonDerivedType(typeof(Verso.Engine.Adapters.Yaml.MoveResourceUnderParentOp), "MoveResourceUnderParent")]
[JsonDerivedType(typeof(Verso.Engine.Adapters.Yaml.SetResourceActionsOp), "SetResourceActions")]
[JsonDerivedType(typeof(Verso.Engine.Adapters.Yaml.AddBookOp), "AddBook")]
[JsonDerivedType(typeof(Verso.Engine.Adapters.Yaml.RemoveBookOp), "RemoveBook")]
[JsonDerivedType(typeof(Verso.Engine.Adapters.Yaml.RenameBookOp), "RenameBook")]
[JsonDerivedType(typeof(Verso.Engine.Adapters.Yaml.AddBookPageOp), "AddBookPage")]
[JsonDerivedType(typeof(Verso.Engine.Adapters.Yaml.RemoveBookPageOp), "RemoveBookPage")]
[JsonDerivedType(typeof(Verso.Engine.Adapters.Yaml.ReorderBookPagesOp), "ReorderBookPages")]
[JsonDerivedType(typeof(Verso.Engine.Adapters.Yaml.SetBookPageNarrativeOp), "SetBookPageNarrative")]
public abstract record OperationBase(string OpId);

public sealed record AddTypeOp(
    string OpId,
    string FilePath,
    string Namespace,
    string Name,
    TypeKind TypeKind,
    Visibility Visibility) : OperationBase(OpId);

public sealed record RenameTypeOp(string OpId, string TypeId, string NewName) : OperationBase(OpId);

public sealed record RemoveTypeOp(string OpId, string TypeId) : OperationBase(OpId);

public sealed record AddPropertyOp(
    string OpId,
    string TypeId,
    string Name,
    string TypeName,
    Visibility Visibility,
    bool HasGetter,
    bool HasSetter,
    bool HasInit) : OperationBase(OpId);

public sealed record RenamePropertyOp(string OpId, string TypeId, string PropertyName, string NewName) : OperationBase(OpId);

public sealed record RemovePropertyOp(string OpId, string TypeId, string PropertyName) : OperationBase(OpId);

public sealed record AddInheritanceOp(string OpId, string TypeId, string BaseTypeId) : OperationBase(OpId);

public sealed record RemoveInheritanceOp(string OpId, string TypeId) : OperationBase(OpId);

public sealed record AddImplementationOp(string OpId, string TypeId, string InterfaceTypeId) : OperationBase(OpId);

public sealed record RemoveImplementationOp(string OpId, string TypeId, string InterfaceTypeId) : OperationBase(OpId);

public abstract record OperationResult(string OpId);

public sealed record OperationApplied(string OpId, IReadOnlyList<DeltaItem> Deltas) : OperationResult(OpId);

public sealed record OperationFailed(string OpId, string Reason, string Message, IReadOnlyList<string>? Diagnostics = null) : OperationResult(OpId);

[JsonPolymorphic(TypeDiscriminatorPropertyName = "kind")]
[JsonDerivedType(typeof(TypeAdded), "TypeAdded")]
[JsonDerivedType(typeof(TypeRemoved), "TypeRemoved")]
[JsonDerivedType(typeof(TypeRenamed), "TypeRenamed")]
[JsonDerivedType(typeof(TypeUpdated), "TypeUpdated")]
public abstract record DeltaItem;

public sealed record TypeAdded(TypeModel Type) : DeltaItem;
public sealed record TypeRemoved(string TypeId) : DeltaItem;
public sealed record TypeRenamed(string OldId, string NewId, string NewName) : DeltaItem;
public sealed record TypeUpdated(TypeModel Type) : DeltaItem;
