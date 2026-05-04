import type { SavedPosition } from './layout';

/**
 * Layout-only undo stack — purely client-side.
 *
 * Layout changes (node drags, waypoint moves) live in localStorage / verso.layout.json,
 * not in code. They never enter the engine-side op stack. This module mirrors the engine's
 * `UndoStack` shape but for cosmetic positions, with **drag-session coalescing**: every
 * mouse-down → mouse-up sequence is a single undo entry, regardless of how many position
 * deltas xyflow emitted in between.
 *
 * The App-level keyboard handler tries this stack first on `⌘Z`, falling through to the
 * engine's undo only when this one is empty. Symmetric for `⌘⇧Z`.
 */
export interface LayoutUndoEntry {
  workspaceRoot: string;
  viewKey: string;
  before: Record<string, SavedPosition>;
  after: Record<string, SavedPosition>;
  description: string;
  ts: number;
}

const CAPACITY = 50;

export class LayoutUndoStack {
  private undo: LayoutUndoEntry[] = [];
  private redo: LayoutUndoEntry[] = [];
  private listeners = new Set<() => void>();

  push(entry: LayoutUndoEntry) {
    this.undo.push(entry);
    while (this.undo.length > CAPACITY) this.undo.shift();
    this.redo = [];
    this.notify();
  }

  popUndo(): LayoutUndoEntry | undefined {
    const e = this.undo.pop();
    if (e) { this.redo.push(e); this.notify(); }
    return e;
  }

  popRedo(): LayoutUndoEntry | undefined {
    const e = this.redo.pop();
    if (e) { this.undo.push(e); this.notify(); }
    return e;
  }

  get canUndo(): boolean { return this.undo.length > 0; }
  get canRedo(): boolean { return this.redo.length > 0; }
  get undoDescription(): string | null { return this.undo[this.undo.length - 1]?.description ?? null; }
  get redoDescription(): string | null { return this.redo[this.redo.length - 1]?.description ?? null; }

  /** External-edit-style invalidation. Drops the redo branch. */
  invalidateRedo() { if (this.redo.length > 0) { this.redo = []; this.notify(); } }

  subscribe(cb: () => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }
  private notify() { this.listeners.forEach((l) => l()); }
}

/** Singleton shared across the app. */
export const layoutUndo = new LayoutUndoStack();

/**
 * Diff helper: given two snapshots, return only the entries that differ. The returned
 * Records are suitable for storing as an entry's `before` and `after`.
 */
export function diffPositions(
  prev: Record<string, SavedPosition>,
  next: Record<string, SavedPosition>
): { before: Record<string, SavedPosition>; after: Record<string, SavedPosition> } {
  const before: Record<string, SavedPosition> = {};
  const after: Record<string, SavedPosition> = {};
  const keys = new Set([...Object.keys(prev), ...Object.keys(next)]);
  for (const k of keys) {
    const p = prev[k]; const n = next[k];
    if (!p && n) { after[k] = n; continue; }
    if (p && !n) { before[k] = p; continue; }
    if (p && n && (p.x !== n.x || p.y !== n.y)) {
      before[k] = p; after[k] = n;
    }
  }
  return { before, after };
}

export function isEmptyDiff(d: { before: Record<string, SavedPosition>; after: Record<string, SavedPosition> }): boolean {
  return Object.keys(d.before).length === 0 && Object.keys(d.after).length === 0;
}
