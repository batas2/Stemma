/**
 * Moving a relationship's ends: reversing it, or reconnecting one end to another box (B-028).
 *
 * One operation, `SetLinkEnds`, rewrites the two ends in the link's own declaration. The link keeps its
 * id, and with it everything that names it: every argument (a data flow's technology included), its
 * status and owner, its look, its comments, the book steps that play it. Until this operation existed
 * the link was removed and added again, which gave it a new id, a new line at the end of `Build()`, and
 * lost whatever the new declaration did not carry.
 *
 * Reversing also turns the drawing round on every view that has one: the dot each end was docked to
 * goes with that end, and the bends are walked the other way, so the arrow keeps its path and only its
 * head moves. Reconnecting docks the moved end to the dot it was dropped on. Model and drawing are one
 * step of the undo history.
 */

import { applyOperation } from './signalr';
import { history, type PresentationChange } from './history';
import { edgeDrawings, saveEdgeHandles, saveEdgeWaypoints, type EdgeHandlePair } from './layout';
import { friendlyOpError } from './opError';
import { useApp } from './store';
import type { ArchLink } from './types';

let seq = 0;
const opId = () => `op_${Date.now()}_rl${seq++}`;

/** The dots the moved ends were dropped on, on the view they were dropped on. */
export interface Docking {
  view: string;
  handles: EdgeHandlePair;
}

export async function relink(
  link: ArchLink,
  fromId: string,
  toId: string,
  description: string,
  docking?: Docking,
): Promise<{ id: string | null; error: string | null }> {
  if (!history.beginGroup(description)) return { id: null, error: 'Another change is still being written. Try again in a moment.' };
  try {
    const result = await applyOperation({ kind: 'SetLinkEnds', opId: opId(), linkId: link.id, fromId, toId });
    if ('reason' in result) return { id: null, error: friendlyOpError(result) };

    const root = useApp.getState().workspace?.rootPath;
    if (root) {
      const reversed = fromId === link.toId && toId === link.fromId && fromId !== toId;
      const changes = reversed ? turnedRound(root, link.id) : [];
      if (docking) changes.push(docked(root, link.id, docking));
      write(root, changes);
      history.recordPresentation(changes, description);
    }
    return { id: link.id, error: null };
  } finally {
    history.endGroup();
  }
}

/** Each view's drawing of the relationship, the other way round. */
function turnedRound(root: string, linkId: string): PresentationChange[] {
  const changes: PresentationChange[] = [];
  for (const { view, handles, waypoints } of edgeDrawings(root, linkId)) {
    if (handles) {
      const next: EdgeHandlePair = {};
      if (handles.target) next.source = handles.target;
      if (handles.source) next.target = handles.source;
      changes.push({ section: 'handles', id: linkId, view, before: handles, after: next });
    }
    if (waypoints) changes.push({ section: 'waypoints', id: linkId, view, before: waypoints, after: [...waypoints].reverse() });
  }
  return changes;
}

function docked(root: string, linkId: string, docking: Docking): PresentationChange {
  const before = edgeDrawings(root, linkId).find((d) => d.view === docking.view)?.handles;
  const after = docking.handles.source || docking.handles.target ? { ...docking.handles } : undefined;
  return { section: 'handles', id: linkId, view: docking.view, before, after };
}

function write(root: string, changes: PresentationChange[]): void {
  if (changes.length === 0) return;
  for (const c of changes) {
    if (c.section === 'handles') saveEdgeHandles(root, c.view!, c.id, (c.after as EdgeHandlePair | undefined) ?? null);
    else if (c.section === 'waypoints') saveEdgeWaypoints(root, c.view!, c.id, (c.after as { x: number; y: number }[]) ?? []);
  }
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('stemma:layout-changed'));
}
