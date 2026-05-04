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
