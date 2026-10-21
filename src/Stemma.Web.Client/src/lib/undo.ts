/**
 * Undo and redo, as ⌘Z and the toolbar's arrows do them (F-015 AC6).
 *
 * The journal (`history.ts`) decides which stack the last step went to; this module is where those
 * stacks are reached — the engine's over SignalR, the layout stack, and the presentation sidecar —
 * and where the result is said out loud.
 */

import { history, setHistoryDriver, type PresentationChange } from './history';
import { layoutUndo } from './layoutUndo';
import { loadLayout, saveLayout, sidecarSet } from './layout';
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

function undoLayout(): boolean {
  const entry = layoutUndo.popUndo();
  if (!entry) return false;
  applyLayoutEntry({ workspaceRoot: entry.workspaceRoot, viewKey: entry.viewKey, positions: entry.before });
  return true;
}

function redoLayout(): boolean {
  const entry = layoutUndo.popRedo();
  if (!entry) return false;
  applyLayoutEntry({ workspaceRoot: entry.workspaceRoot, viewKey: entry.viewKey, positions: entry.after });
  return true;
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
    if (c.section === 'position') {
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
    depths: async () => {
      try {
        const s = await fetchUndoState();
        return { undo: s.undoDepth, redo: s.redoDepth };
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
  const done = await history.undo();
  if (done !== null) { say(`Undid ${done}`); return; }
  if (undoLayout()) { say('Undid Move'); return; }
  const state = await fetchUndoState().catch(() => null);
  if (state?.canUndo && (await engineStep(undoOperation))) say(`Undid ${state.undoDescription ?? 'the last edit'}`);
}

export async function redo(): Promise<void> {
  const done = await history.redo();
  if (done !== null) { say(`Redid ${done}`); return; }
  if (redoLayout()) { say('Redid Move'); return; }
  const state = await fetchUndoState().catch(() => null);
  if (state?.canRedo && (await engineStep(redoOperation))) say(`Redid ${state.redoDescription ?? 'the last edit'}`);
}

function say(text: string) {
  useApp.getState().setToast({ kind: 'info', text });
}
