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

public sealed record AddDecisionOp(string OpId, string Title, string Status = "proposed") : OperationBase(OpId);
public sealed record RenameDecisionOp(string OpId, string DecisionId, string NewTitle) : OperationBase(OpId);
public sealed record SetDecisionStatusOp(string OpId, string DecisionId, string Status) : OperationBase(OpId);
public sealed record RemoveDecisionOp(string OpId, string DecisionId) : OperationBase(OpId);
public sealed record AddDecisionConcernsOp(string OpId, string DecisionId, string ElementId) : OperationBase(OpId);
public sealed record SetDecisionNarrativeOp(string OpId, string DecisionId, string Body) : OperationBase(OpId);
public sealed record SetCapabilityNarrativeOp(string OpId, string ElementId, string Body) : OperationBase(OpId);
