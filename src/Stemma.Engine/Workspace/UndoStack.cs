using Microsoft.CodeAnalysis;
using Stemma.Engine.ArchModel;
using Stemma.Engine.Operations;

namespace Stemma.Engine.Workspace;

/// <summary>
/// Engine-side undo/redo stack. Each entry is a pair of (forward op, inverse op), and the inverse
/// the engine records is a <see cref="RestoreDocumentsOp"/>: put back exactly what the edit
/// changed, or — if the file has changed since — fall back to the inverse operation built here.
/// Capped at 100 entries (decision #36). Layout-only ops are NOT stored — they live
/// client-side and are out of scope for the model history.
///
/// External edits (`FileSystemWatcher` notifications) clear the redo branch (decision #34).
/// </summary>
public sealed class UndoStack
{
    public const int Capacity = 100;

    /// <param name="Sequence">Which push this entry was, counting from 1 for the session. Unlike the
    /// depth, it tells two entries apart even once the stack is full, so a client that grouped several
    /// operations into one step can tell whether the top of the stack is still its own.</param>
    public sealed record Entry(OperationBase Forward, OperationBase Inverse, string Description, long Sequence = 0);

    private readonly LinkedList<Entry> _undo = new();
    private readonly LinkedList<Entry> _redo = new();
    private long _pushed;

    public bool CanUndo => _undo.Count > 0;
    public bool CanRedo => _redo.Count > 0;
    public int UndoDepth => _undo.Count;
    public int RedoDepth => _redo.Count;

    /// <summary>The sequence of the entry an undo would take back, or 0 when there is none.</summary>
    public long UndoTop => _undo.Last?.Value.Sequence ?? 0;

    /// <summary>The sequence of the entry a redo would put back, or 0 when there is none.</summary>
    public long RedoTop => _redo.Last?.Value.Sequence ?? 0;

    public string? PeekUndoDescription() => _undo.Last?.Value.Description;
    public string? PeekRedoDescription() => _redo.Last?.Value.Description;

    public void Push(OperationBase forward, OperationBase inverse, string description)
    {
        _undo.AddLast(new Entry(forward, inverse, description, ++_pushed));
        while (_undo.Count > Capacity) _undo.RemoveFirst();
        _redo.Clear();
    }

    /// <summary>
    /// The entry an undo would take back. It stays on the stack until <see cref="Undone"/>: an undo
    /// that failed has not happened, and its entry is still the next one to try. Moved to the redo
    /// branch before it was applied, a refused undo left it there, and the change on disk that refused
    /// it discarded the branch — "try again" then undid the edit before it.
    /// </summary>
    public Entry? PeekUndo() => _undo.Last?.Value;

    /// <summary>The entry a redo would put back; it stays on the branch until <see cref="Redone"/>.</summary>
    public Entry? PeekRedo() => _redo.Last?.Value;

    /// <summary><paramref name="entry"/>, the top of the stack, was undone: it moves to the redo branch.</summary>
    public void Undone(Entry entry)
    {
        if (!ReferenceEquals(_undo.Last?.Value, entry)) return;
        _undo.RemoveLast();
        _redo.AddLast(entry);
    }

    /// <summary><paramref name="entry"/>, the top of the redo branch, was redone: it moves back onto the stack.</summary>
    public void Redone(Entry entry)
    {
        if (!ReferenceEquals(_redo.Last?.Value, entry)) return;
        _redo.RemoveLast();
        _undo.AddLast(entry);
    }

    /// <summary>
    /// A redo that failed is still the next redo — even when the change on disk that refused it
    /// discarded the rest of the branch, because the refusal says to try again.
    /// </summary>
    public void RedoFailed(Entry entry)
    {
        if (!ReferenceEquals(_redo.Last?.Value, entry)) _redo.AddLast(entry);
    }

    public void OnExternalChange()
    {
        _redo.Clear();
    }

    /// <summary>
    /// Build the inverse of the given op against the model state captured *before* the op was
    /// applied. Returns null when the op is layout-only or otherwise non-reversible.
    ///
    /// This is the fallback, not the undo: it is used only when the file no longer matches what the
    /// edit wrote, so it has to re-create what was there without depending on where it was.
    /// </summary>
    /// <param name="declaredIn">The model file that declared what a removal removes, so the fallback
    /// puts it back there rather than in the primary file.</param>
    public static OperationBase? BuildInverse(OperationBase op, ArchModel.ArchModel? archBefore, string? declaredIn = null)
    {
        switch (op)
        {
            case AddElementOp:
                // Forward op succeeded; engine enriches the inverse with the new id post-apply.
                return null;

            case RenameElementOp rename when archBefore is not null:
            {
                var prior = archBefore.Elements.FirstOrDefault(e => e.Id == rename.ElementId);
                return prior is null ? null : new RenameElementOp($"undo_{Guid.NewGuid():N}", rename.ElementId, prior.Name);
            }

            case RemoveElementOp remove when archBefore is not null:
            {
                var prior = archBefore.Elements.FirstOrDefault(e => e.Id == remove.ElementId);
                if (prior is null) return null;
                prior.Attributes.TryGetValue("contextId", out var ctx);
                prior.Attributes.TryGetValue("systemId", out var sys);
                prior.Attributes.TryGetValue("kind", out var ckind);
                prior.Attributes.TryGetValue("role", out var role);
                prior.Attributes.TryGetValue("aboutId", out var about);
                // Re-declared with its own id, in its own file, with the tag that went with it.
                var tag = archBefore.Tags.FirstOrDefault(t => t.TargetId == prior.Id);
                return new RestoreElementOp($"undo_{Guid.NewGuid():N}", prior.Id, prior.Name, prior.Kind,
                    ctx, sys, ckind, role, about, declaredIn, tag?.Lifecycle, tag?.Ownership);
            }

            case AddLinkOp:
                return null; // engine fills in a RemoveLinkOp post-apply with the generated id

            case RemoveLinkOp removeLink when archBefore is not null:
            {
                var prior = archBefore.Links.FirstOrDefault(l => l.Id == removeLink.LinkId);
                if (prior is null) return null;
                prior.Attributes.TryGetValue("payload", out var payload);
                prior.Attributes.TryGetValue("direction", out var direction);
                prior.Attributes.TryGetValue("kind", out var kind);
                prior.Attributes.TryGetValue("label", out var label);
                var tag = archBefore.Tags.FirstOrDefault(t => t.TargetId == prior.Id);
                return new RestoreLinkOp($"undo_{Guid.NewGuid():N}", prior.Id, prior.FromId, prior.ToId, prior.Kind,
                    payload, direction, kind, label, declaredIn, tag?.Lifecycle, tag?.Ownership);
            }

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

            case SetElementContextOp setCtx when archBefore is not null:
            {
                var prior = archBefore.Elements.FirstOrDefault(e => e.Id == setCtx.ElementId);
                string? prev = null;
                prior?.Attributes.TryGetValue("contextId", out prev);
                return new SetElementContextOp($"undo_{Guid.NewGuid():N}", setCtx.ElementId, prev);
            }

            case SetElementAttributeOp setA when archBefore is not null:
            {
                var prior = archBefore.Elements.FirstOrDefault(e => e.Id == setA.ElementId);
                string? prev = null;
                prior?.Attributes.TryGetValue(setA.AttributeName, out prev);
                return new SetElementAttributeOp($"undo_{Guid.NewGuid():N}", setA.ElementId, setA.AttributeName, prev);
            }

            default:
                return null;
        }
    }
}

/// <summary>
/// Internal op used by the undo stack to restore a removed element with its original id.
/// Behaves identically to AddElement but skips id generation.
/// </summary>
/// <param name="FilePath">The model file to declare it in; the primary one when null, or when no model
/// file has that path.</param>
/// <param name="Lifecycle">The lifecycle its tag had, written back with it.</param>
/// <param name="Ownership">The squad and domain its tag had, written back with it.</param>
public sealed record RestoreElementOp(
    string OpId,
    string ElementId,
    string Name,
    ArchElementKind ElementKind,
    string? ContextId = null,
    string? SystemId = null,
    string? ContainerKind = null,
    string? Role = null,
    string? AboutId = null,
    string? FilePath = null,
    ArchLifecycle? Lifecycle = null,
    ArchOwnership? Ownership = null) : OperationBase(OpId);

/// <summary>
/// Internal op used by the undo stack to restore a removed link with its original id; see
/// <see cref="RestoreElementOp"/> for the file and the tag.
/// </summary>
public sealed record RestoreLinkOp(
    string OpId,
    string LinkId,
    string FromId,
    string ToId,
    ArchLinkKind LinkKind,
    string? Payload = null,
    string? Direction = null,
    string? DependencyKind = null,
    string? Label = null,
    string? FilePath = null,
    ArchLifecycle? Lifecycle = null,
    ArchOwnership? Ownership = null) : OperationBase(OpId);

/// <summary>What one write did to one file: its syntax tree before, and the exact text it left.</summary>
/// <param name="Before">Null when the write created the file.</param>
public sealed record DocumentWrite(string FilePath, SyntaxNode? Before, string After);

/// <summary>
/// The inverse the engine records for every edit: put each file it wrote back exactly as it was —
/// provided the file is still exactly as the edit left it.
///
/// Rebuilding the old state from the model cannot do this. A removed declaration comes back at the
/// end of the method, without the comment above it, with the arguments the model knows about and
/// none of the formatting; that is a second edit rather than the reversal of the first. Holding the
/// tree the edit replaced makes undo the edit's own diff, reversed, and nothing else. It is a
/// targeted replacement in the only sense that matters: the result differs from the file on disk in
/// exactly the region the edit changed, because the file is checked to be byte-for-byte what the
/// edit wrote before anything is put back.
///
/// When that check fails — the file was edited outside Stemma in between — restoring the old bytes
/// would erase someone else's change, so the engine applies <paramref name="Fallback"/> instead, or
/// refuses when there is none. Never registered for JSON: it carries syntax trees, and only the
/// engine constructs it.
/// </summary>
public sealed record RestoreDocumentsOp(
    string OpId,
    IReadOnlyList<DocumentWrite> Writes,
    OperationBase? Fallback) : OperationBase(OpId);
