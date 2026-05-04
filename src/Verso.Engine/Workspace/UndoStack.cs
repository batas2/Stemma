using Verso.Engine.ArchModel;
using Verso.Engine.Operations;

namespace Verso.Engine.Workspace;

/// <summary>
/// Engine-side undo/redo stack. Each entry is a pair of (forward op, inverse op).
/// Capped at 100 entries (decision #36). Layout-only ops are NOT stored — they live
/// client-side and are out of scope for the model history.
///
/// External edits (`FileSystemWatcher` notifications) clear the redo branch (decision #34).
/// </summary>
public sealed class UndoStack
{
    private const int Capacity = 100;

    public sealed record Entry(OperationBase Forward, OperationBase Inverse, string Description);

    private readonly LinkedList<Entry> _undo = new();
    private readonly LinkedList<Entry> _redo = new();

    public bool CanUndo => _undo.Count > 0;
    public bool CanRedo => _redo.Count > 0;
    public int UndoDepth => _undo.Count;
    public int RedoDepth => _redo.Count;

    public string? PeekUndoDescription() => _undo.Last?.Value.Description;
    public string? PeekRedoDescription() => _redo.Last?.Value.Description;

    public void Push(OperationBase forward, OperationBase inverse, string description)
    {
        _undo.AddLast(new Entry(forward, inverse, description));
        while (_undo.Count > Capacity) _undo.RemoveFirst();
        _redo.Clear();
    }

    public Entry? PopUndo()
    {
        if (_undo.Last is null) return null;
        var e = _undo.Last.Value;
        _undo.RemoveLast();
        _redo.AddLast(e);
        return e;
    }

    public Entry? PopRedo()
    {
        if (_redo.Last is null) return null;
        var e = _redo.Last.Value;
        _redo.RemoveLast();
        _undo.AddLast(e);
        return e;
    }

    public void OnExternalChange()
    {
        _redo.Clear();
    }

    /// <summary>
    /// Build the inverse of the given op against the model state captured *before* the op was
    /// applied. Returns null when the op is layout-only or otherwise non-reversible.
    /// </summary>
    public static OperationBase? BuildInverse(OperationBase op, ArchModel.ArchModel? archBefore)
    {
        switch (op)
        {
            case AddElementOp add when archBefore is not null:
                // We cannot know the generated id ahead of time; the engine will fill it in
                // post-apply by attaching the new id. Placeholder used only after enrichment.
                return null;

            case RenameElementOp rename when archBefore is not null:
            {
                var prior = archBefore.Elements.FirstOrDefault(e => e.Id == rename.ElementId);
                return prior is null ? null : new RenameElementOp($"undo_{Guid.NewGuid():N}", rename.ElementId, prior.Name);
            }

            case RemoveElementOp remove when archBefore is not null:
                // Inverse requires preserving the full element + tags, which the basic op
                // surface cannot recreate verbatim (kind, attributes). Skip for v1; users get
                // a forward "redo" but no automatic restore of removed elements.
                return null;

            case AddLinkOp _:
                return null; // Same caveat as AddElement.

            case RemoveLinkOp:
                return null;

            case SetLinkAttributeOp set when archBefore is not null:
            {
                var prior = archBefore.Links.FirstOrDefault(l => l.Id == set.LinkId);
                if (prior is null) return null;
                prior.Attributes.TryGetValue(set.AttributeName, out var prev);
                return new SetLinkAttributeOp($"undo_{Guid.NewGuid():N}", set.LinkId, set.AttributeName, prev);
            }

            case SetLifecycleOp setL when archBefore is not null:
            {
                var prior = archBefore.Tags.FirstOrDefault(t => t.TargetId == setL.TargetId)?.Lifecycle;
                return new SetLifecycleOp($"undo_{Guid.NewGuid():N}",
                    setL.TargetId, prior?.Status, prior?.Phase, prior?.ValidFrom, prior?.ValidUntil);
            }

            case SetOwnershipOp setO when archBefore is not null:
            {
                var prior = archBefore.Tags.FirstOrDefault(t => t.TargetId == setO.TargetId)?.Ownership;
                return new SetOwnershipOp($"undo_{Guid.NewGuid():N}",
                    setO.TargetId, prior?.Squad, prior?.Domain);
            }

            default:
                return null;
        }
    }
}
