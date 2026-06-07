using Verso.Engine.Operations;

namespace Verso.Engine.ArchModel;

public sealed record AddElementOp(
    string OpId,
    ArchElementKind ElementKind,
    string Name,
    string? ContextId = null,
    string? SystemId = null,
    string? ContainerKind = null,
    string? Role = null) : OperationBase(OpId);

public sealed record RenameElementOp(string OpId, string ElementId, string NewName) : OperationBase(OpId);

public sealed record RemoveElementOp(string OpId, string ElementId) : OperationBase(OpId);

/// <summary>Place a Module or Capability inside a Bounded Context (or clear it when null).</summary>
public sealed record SetElementContextOp(string OpId, string ElementId, string? ContextId) : OperationBase(OpId);

/// <summary>Set (or clear, when value is null) a positional attribute the element kind emits —
/// e.g. `aboutId` on a Question/Assumption/Risk. Attributes the kind does not emit are ignored.</summary>
public sealed record SetElementAttributeOp(string OpId, string ElementId, string AttributeName, string? Value) : OperationBase(OpId);

public sealed record AddLinkOp(
    string OpId,
    ArchLinkKind LinkKind,
    string FromId,
    string ToId,
    string? Payload = null,
    string? DependencyKind = null,
    string? Direction = null) : OperationBase(OpId);

public sealed record RemoveLinkOp(string OpId, string LinkId) : OperationBase(OpId);

public sealed record SetLinkAttributeOp(string OpId, string LinkId, string AttributeName, string? Value) : OperationBase(OpId);

public sealed record SetLifecycleOp(
    string OpId,
    string TargetId,
    string? Status,
    string? Phase,
    string? ValidFrom,
    string? ValidUntil) : OperationBase(OpId);

public sealed record SetOwnershipOp(
    string OpId,
    string TargetId,
    string? Squad,
    string? Domain) : OperationBase(OpId);
