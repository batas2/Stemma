/**
 * Undo and redo, as ⌘Z and the toolbar's arrows do them (F-015 AC6).
 *
 * The journal (`history.ts`) decides which stack the last step went to; this module is where those
 * stacks are reached — the engine's over SignalR, the layout stack, and the presentation sidecar —
 * and where the result is said out loud.
 */

import { history, setHistoryDriver, type HistoryStep, type PresentationChange } from './history';
import { layoutUndo } from './layoutUndo';
import { loadLayout, saveEdgeWaypoints, saveLayout, saveViewShapes, sidecarSet } from './layout';
import type { Shape } from './shapes';
import { fetchUndoState, redoOperation, undoOperation } from './signalr';
import { friendlyOpError } from './opError';
import { reportFailure, ClientEvent } from './log';
import { useApp } from './store';
import type { ViewKind } from './types';

function applyLayoutEntry(entry: { workspaceRoot: string; viewKey: string; positions: Record<string, { x: number; y: number }> }) {
  const current = loadLayout(entry.workspaceRoot, entry.viewKey as ViewKind);
  saveLayout(entry.workspaceRoot, entry.viewKey as ViewKind, { ...current, ...entry.positions });
  window.dispatchEvent(new CustomEvent('stemma:layout-changed', { detail: { viewKey: entry.viewKey } }));
}

/** The boxes the last move undone or redone moved, for showing where it happened. */
let movedIds: string[] = [];

function undoLayout(): boolean {
  const entry = layoutUndo.popUndo();
  if (!entry) return false;
  applyLayoutEntry({ workspaceRoot: entry.workspaceRoot, viewKey: entry.viewKey, positions: entry.before });
  movedIds = Object.keys(entry.before);
  return true;
}

function redoLayout(): boolean {
  const entry = layoutUndo.popRedo();
  if (!entry) return false;
  applyLayoutEntry({ workspaceRoot: entry.workspaceRoot, viewKey: entry.viewKey, positions: entry.after });
  movedIds = Object.keys(entry.after);
  return true;
}

/**
 * Show where an undo or redo happened (HIG, Undo and redo: "highlight the result of each undo and
 * redo to keep people from thinking that the action had no effect"): the boxes it moved or restyled
 * are ringed for a moment, and brought on screen when none of them is. A model edit is shown by the
 * model redrawing; a step that took boxes away has nothing left to point at.
 */
function showWhere(replayed: { step: HistoryStep; direction: 'undo' | 'redo' } | null, layout: boolean) {
  if (typeof window === 'undefined') return;
  const ids = new Set<string>(layout ? movedIds : []);
  for (const c of replayed?.step.presentation ?? []) {
    if (c.section === 'edgeStyles') continue;
    const now = replayed!.direction === 'undo' ? c.before : c.after;
    if (now !== undefined || c.section === 'nodeStyles') ids.add(c.id);
  }
  if (ids.size > 0) window.dispatchEvent(new CustomEvent('stemma:flash', { detail: { ids: [...ids] } }));
}

async function engineStep(run: () => Promise<{ reason: string } | object | null>): Promise<boolean> {
  try {
    const r = await run();
    if (r && 'reason' in r) {
      useApp.getState().setToast({ kind: 'error', text: friendlyOpError(r as Parameters<typeof friendlyOpError>[0]) });
      return false;
    }
    return r !== null;
  } catch (error) {
    reportFailure('Operations', ClientEvent.OperationFailed, 'Undo or redo')(error);
    return false;
  }
}

/** Write each entry back as it was before or after a step, then let every surface read it again. */
function applyPresentation(changes: PresentationChange[], which: 'before' | 'after') {
  const st = useApp.getState();
  const root = st.workspace?.rootPath;
  if (!root) return;
  for (const c of changes) {
    const value = which === 'before' ? c.before : c.after;
    if (c.section === 'waypoints') {
      saveEdgeWaypoints(root, c.view as ViewKind, c.id, Array.isArray(value) ? (value as { x: number; y: number }[]) : []);
      window.dispatchEvent(new CustomEvent('stemma:layout-changed', { detail: { viewKey: c.view } }));
    } else if (c.section === 'shapes') {
      const shapes = Array.isArray(value) ? (value as Shape[]) : [];
      saveViewShapes(root, c.id, shapes);
      st.setShapesFor(c.id, shapes);
      if (st.selectedShapeId && !shapes.some((x) => x.id === st.selectedShapeId)) st.selectShape(null);
    } else if (c.section === 'viewMembers') {
      // A view from Views/ names its elements in code; the change is a save of that view, as any is.
      const view = st.customViews.find((v) => v.id === c.id);
      if (view && Array.isArray(value)) st.upsertCustomView({ ...view, elementIds: value as string[] });
    } else if (c.section === 'position') {
      const positions = { ...loadLayout(root, c.view as ViewKind) };
      if (value) positions[c.id] = value as { x: number; y: number };
      else delete positions[c.id];
      saveLayout(root, c.view as ViewKind, positions);
      window.dispatchEvent(new CustomEvent('stemma:layout-changed', { detail: { viewKey: c.view } }));
    } else {
      sidecarSet(root, c.section, c.id, value);
    }
  }
  st.rehydratePresentation();
  window.dispatchEvent(new CustomEvent('stemma:notes-changed'));
}

let configured = false;

/** Point the journal at the stacks it drives. Called once, by App. */
export function configureHistory(): void {
  if (configured) return;
  configured = true;
  setHistoryDriver({
    undoLayout,
    redoLayout,
    undoOperation: () => engineStep(undoOperation),
    redoOperation: () => engineStep(redoOperation),
    tops: async () => {
      try {
        const s = await fetchUndoState();
        return { undo: s.undoTop, redo: s.redoTop };
      } catch { return null; }
    },
    applyPresentation,
  });
}

/**
 * Undo the last step. The journal knows every step this window took; with nothing in it — a reload
 * since, or an edit made in another window — the engine's own stack is all there is.
 */
export async function undo(): Promise<void> {
  // A paste still being written is not yet a step to take back: its operations are still arriving.
  if (history.groupOpen) { say('Still pasting — undo when it has finished'); return; }
  movedIds = [];
  const done = await history.undo();
  if (history.lastFailed) return; // the engine said why, in its own toast
  if (done !== null) { say(`Undid ${done}`); showWhere(history.lastReplayed, history.lastReplayed?.step.layout ?? false); return; }
  if (undoLayout()) { say('Undid Move'); showWhere(null, true); return; }
  const state = await fetchUndoState().catch(() => null);
  if (state?.canUndo && (await engineStep(undoOperation))) say(`Undid ${state.undoDescription ?? 'the last edit'}`);
}

export async function redo(): Promise<void> {
  if (history.groupOpen) { say('Still pasting — redo when it has finished'); return; }
  movedIds = [];
  const done = await history.redo();
  if (history.lastFailed) return;
  if (done !== null) { say(`Redid ${done}`); showWhere(history.lastReplayed, history.lastReplayed?.step.layout ?? false); return; }
  // No layout fallback here: every move is in the journal, so a move only the layout stack still
  // remembers was undone before a later step, and replaying it would put it back out of order.
  const state = await fetchUndoState().catch(() => null);
  if (state?.canRedo && (await engineStep(redoOperation))) say(`Redid ${state.redoDescription ?? 'the last edit'}`);
}

function say(text: string) {
  useApp.getState().setToast({ kind: 'info', text });
}
