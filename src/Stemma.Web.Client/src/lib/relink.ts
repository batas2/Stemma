/**
 * Moving a relationship's ends: reversing it, or reconnecting one end to another box.
 *
 * There is no operation that moves an end, so it is the link removed and added again. The added link
 * has to be the same relationship: its kind — a Relation reversed came back as a Dependency with a new
 * id — its label, payload, direction or dependency kind, its status and owner, and its look. It is
 * one step of the undo history, and if adding fails the removal is undone, so the model never loses
 * the relationship.
 */

import { addedId, applyOperation, fetchUndoState } from './signalr';
import { history } from './history';
import { friendlyOpError } from './opError';
import { format } from './shortcuts';
import { useApp } from './store';
import type { ArchLink, OperationEnvelope } from './types';

let seq = 0;
const opId = () => `op_${Date.now()}_rl${seq++}`;

export async function relink(link: ArchLink, fromId: string, toId: string, description: string): Promise<{ id: string | null; error: string | null }> {
  if (!history.beginGroup(description)) return { id: null, error: 'Another change is still being written. Try again in a moment.' };
  try {
    const removed = await applyOperation({ kind: 'RemoveLink', opId: opId(), linkId: link.id });
    if ('reason' in removed) return { id: null, error: friendlyOpError(removed) };

    const added = await applyOperation({
      kind: 'AddLink', opId: opId(), linkKind: link.kind, fromId, toId,
      payload: link.kind === 'dataFlow' ? link.attributes.payload ?? 'Event' : null,
      direction: link.kind === 'dataFlow' ? link.attributes.direction ?? null : null,
      dependencyKind: link.kind === 'dependency' ? link.attributes.kind ?? 'uses' : null,
    } as OperationEnvelope);
    if ('reason' in added) {
      // The relationship must not be lost because its new ends were refused: the removal is undone.
      const restored = await history.takeBackInGroup().catch(() => false);
      const why = friendlyOpError(added);
      return { id: null, error: restored ? why : `${why} The relationship was removed; press ${format({ key: 'z', primary: true, description: '', handler: () => {} })} to bring it back.` };
    }
    const id = addedId(added);
    if (!id) return { id: null, error: null };

    const st = useApp.getState();
    const follow: Omit<OperationEnvelope, 'opId'>[] = [];
    if (link.kind === 'relation' && link.attributes.label) follow.push({ kind: 'SetLinkAttribute', linkId: id, attributeName: 'label', value: link.attributes.label });
    const tag = st.arch?.tags.find((t) => t.targetId === link.id);
    const life = tag?.lifecycle;
    if (life && (life.status || life.phase || life.validFrom || life.validUntil)) {
      follow.push({ kind: 'SetLifecycle', targetId: id, status: life.status, phase: life.phase, validFrom: life.validFrom, validUntil: life.validUntil });
    }
    const own = tag?.ownership;
    if (own && (own.squad || own.domain)) follow.push({ kind: 'SetOwnership', targetId: id, squad: own.squad, domain: own.domain });
    for (const op of follow) {
      const r = await applyOperation({ ...op, opId: opId() } as OperationEnvelope);
      if ('reason' in r) return { id, error: friendlyOpError(r) };
    }
    const look = st.edgeStyles[link.id];
    if (look) st.setEdgeStyleFor(id, look);
    return { id, error: null };
  } finally {
    const top = await fetchUndoState().then((s) => s.undoTop).catch(() => null);
    history.endGroup(top);
  }
}
