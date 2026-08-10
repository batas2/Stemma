import type { SavedPosition } from './layout';

/**
 * Layout expressed as intent, solved to coordinates.
 *
 * An agent authoring a diagram is bad at pixels and good at "these four questions sit above the four
 * artifacts that answer them". The first attempt at a Stemma-drawn diagram hand-rolled exactly that
 * — a column grid with per-column widths and per-row heights — in sixty lines of synthetic mouse
 * drags, because the only way to place a node was to drag it. This is that idea, in the product.
 *
 * Two rules make it work rather than merely exist:
 *
 * 1. **The constraint stays live.** A drag records an *offset* against the solved position instead
 *    of replacing it, so nudging one label to line up with an arrow does not dissolve the grid that
 *    aligned the other six. Adding a box next week re-solves and keeps the nudges.
 * 2. **Only deterministic constraints belong here.** Grid, row, column and stack give the same
 *    answer every time, so their coordinates need not be committed. The force-directed and
 *    hierarchical layouts are *generators*: iterative, tunable, not stable across versions. Those
 *    stay one-shot, bake their positions, and hand the view to `custom` — which is what the canvas
 *    already does, and is correct, because a published diagram that silently re-arranges when an
 *    algorithm is tuned is a diagram that lies.
 *
 * The test for which is which: if re-running it tomorrow must give the same picture, it is a
 * constraint; if it is a starting point you will then correct, it is a generator.
 */

export type LayoutConstraintKind = 'grid' | 'row' | 'column' | 'stack';

export interface NodeSize { w: number; h: number; }

/** A column-major grid: `columns[i]` is the ids in column i, top to bottom. */
export interface GridConstraint {
  kind: 'grid';
  columns: string[][];
  /** `[x, y]` gutters in flow units. */
  gap?: [number, number];
  /** How cells line up within their track. */
  align?: 'start' | 'center';
}

export interface RowConstraint {
  kind: 'row';
  ids: string[];
  gap?: number;
  align?: 'start' | 'center';
}

export interface ColumnConstraint {
  kind: 'column';
  ids: string[];
  gap?: number;
  align?: 'start' | 'center';
}

/** Overlapping cards, offset by a fixed step — for "a pile of these" without drawing each. */
export interface StackConstraint {
  kind: 'stack';
  ids: string[];
  step?: [number, number];
}

export type LayoutConstraint = GridConstraint | RowConstraint | ColumnConstraint | StackConstraint;

/** Per-node nudges, applied on top of the solved position. */
export type LayoutOffsets = Record<string, SavedPosition>;

export const DEFAULT_GAP: [number, number] = [56, 30];
export const DEFAULT_STACK_STEP: [number, number] = [18, 18];
/** Used when a node has not been measured yet. Deliberately the canvas's own minimum width. */
export const FALLBACK_SIZE: NodeSize = { w: 180, h: 84 };

export const CONSTRAINT_KINDS: LayoutConstraintKind[] = ['grid', 'row', 'column', 'stack'];

export function isLayoutConstraint(value: unknown): value is LayoutConstraint {
  if (!value || typeof value !== 'object') return false;
  const kind = (value as { kind?: unknown }).kind;
  return typeof kind === 'string' && (CONSTRAINT_KINDS as string[]).includes(kind);
}

/** Every id the constraint places, in declaration order and without duplicates. */
export function constraintIds(c: LayoutConstraint): string[] {
  const raw = c.kind === 'grid' ? c.columns.flat() : c.ids;
  return [...new Set(raw)];
}

/**
 * A usable number, or the fallback.
 *
 * The sidecar is hand-written and agent-written, so a field can hold anything the author's editor
 * accepted. The costly mistake is not the wrong value but the wrong *type*: `gap: [56, 30]` is
 * correct for a grid and lands three lines away in the same document, and on a row it made `x`
 * a string, then NaN, then a `null` in the published render box, and the headless render died with
 * a JSON type error that named neither the file nor the field. A bad number now degrades to the
 * default; `stemma validate` is what reports it (rule `constraint/bad-gap`).
 */
function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** A gap pair, accepting the single number that reads naturally for a one-axis arrangement. */
function gapPair(value: unknown, fallback: [number, number]): [number, number] {
  if (typeof value === 'number') return [finite(value, fallback[0]), finite(value, fallback[1])];
  if (Array.isArray(value)) return [finite(value[0], fallback[0]), finite(value[1], fallback[1])];
  return fallback;
}

function sizeOf(sizes: Record<string, NodeSize>, id: string): NodeSize {
  return sizes[id] ?? FALLBACK_SIZE;
}

function solveGrid(c: GridConstraint, sizes: Record<string, NodeSize>): Record<string, SavedPosition> {
  const [gapX, gapY] = gapPair(c.gap, DEFAULT_GAP);
  const centred = c.align === 'center';

  // Columns are as wide as their widest member and rows as tall as their tallest — measured per
  // track rather than taken from one node, because these cards size themselves to their label.
  const colWidths = c.columns.map((col) => Math.max(0, ...col.map((id) => sizeOf(sizes, id).w)));
  const rowCount = Math.max(0, ...c.columns.map((col) => col.length));
  const rowHeights = Array.from({ length: rowCount }, (_, r) =>
    Math.max(0, ...c.columns.map((col) => (col[r] ? sizeOf(sizes, col[r]).h : 0))));

  const out: Record<string, SavedPosition> = {};
  let x = 0;
  for (let ci = 0; ci < c.columns.length; ci++) {
    let y = 0;
    for (let ri = 0; ri < c.columns[ci].length; ri++) {
      const id = c.columns[ci][ri];
      const s = sizeOf(sizes, id);
      out[id] = {
        x: centred ? x + (colWidths[ci] - s.w) / 2 : x,
        y: centred ? y + (rowHeights[ri] - s.h) / 2 : y,
      };
      y += rowHeights[ri] + gapY;
    }
    x += colWidths[ci] + gapX;
  }
  return out;
}

function solveRow(c: RowConstraint, sizes: Record<string, NodeSize>): Record<string, SavedPosition> {
  const gap = finite(c.gap, DEFAULT_GAP[0]);
  const tallest = Math.max(0, ...c.ids.map((id) => sizeOf(sizes, id).h));
  const out: Record<string, SavedPosition> = {};
  let x = 0;
  for (const id of c.ids) {
    const s = sizeOf(sizes, id);
    out[id] = { x, y: c.align === 'center' ? (tallest - s.h) / 2 : 0 };
    x += s.w + gap;
  }
  return out;
}

function solveColumn(c: ColumnConstraint, sizes: Record<string, NodeSize>): Record<string, SavedPosition> {
  const gap = finite(c.gap, DEFAULT_GAP[1]);
  const widest = Math.max(0, ...c.ids.map((id) => sizeOf(sizes, id).w));
  const out: Record<string, SavedPosition> = {};
  let y = 0;
  for (const id of c.ids) {
    const s = sizeOf(sizes, id);
    out[id] = { x: c.align === 'center' ? (widest - s.w) / 2 : 0, y };
    y += s.h + gap;
  }
  return out;
}

function solveStack(c: StackConstraint): Record<string, SavedPosition> {
  const [dx, dy] = gapPair(c.step, DEFAULT_STACK_STEP);
  const out: Record<string, SavedPosition> = {};
  c.ids.forEach((id, i) => { out[id] = { x: i * dx, y: i * dy }; });
  return out;
}

/**
 * Solve a constraint to positions, in flow units, with the arrangement's top-left at the origin.
 *
 * Pure and DOM-free so it runs identically in the canvas and in a headless render. `sizes` is what
 * the canvas measured, or what the size estimator predicted when nothing has been measured yet.
 */
export function solveConstraint(
  constraint: LayoutConstraint,
  sizes: Record<string, NodeSize>
): Record<string, SavedPosition> {
  switch (constraint.kind) {
    case 'grid': return solveGrid(constraint, sizes);
    case 'row': return solveRow(constraint, sizes);
    case 'column': return solveColumn(constraint, sizes);
    case 'stack': return solveStack(constraint);
  }
}

/**
 * Final positions for a view: the solved constraint, plus each node's nudge, plus anything the
 * constraint does not mention.
 *
 * A node absent from the constraint keeps its stored absolute position — a constraint is allowed to
 * govern part of a diagram, and silently dragging unmentioned nodes to the origin would be worse
 * than useless.
 */
export function resolveLayout(args: {
  constraint?: LayoutConstraint | null;
  offsets?: LayoutOffsets;
  stored?: Record<string, SavedPosition>;
  sizes?: Record<string, NodeSize>;
  origin?: SavedPosition;
}): Record<string, SavedPosition> {
  const { constraint, offsets = {}, stored = {}, sizes = {}, origin = { x: 0, y: 0 } } = args;
  if (!constraint) return { ...stored };

  const solved = solveConstraint(constraint, sizes);
  const out: Record<string, SavedPosition> = { ...stored };
  for (const [id, p] of Object.entries(solved)) {
    const nudge = offsets[id] ?? { x: 0, y: 0 };
    out[id] = { x: origin.x + p.x + nudge.x, y: origin.y + p.y + nudge.y };
  }
  return out;
}

/**
 * The nudge to store when a governed node is dragged.
 *
 * Recording the delta rather than the absolute is the whole reason the constraint survives editing:
 * re-solving after a box is added moves the node's slot, and the nudge travels with it.
 */
export function offsetForDrag(
  id: string,
  dropped: SavedPosition,
  constraint: LayoutConstraint,
  sizes: Record<string, NodeSize>,
  origin: SavedPosition = { x: 0, y: 0 }
): SavedPosition | null {
  const solved = solveConstraint(constraint, sizes)[id];
  if (!solved) return null;
  return { x: dropped.x - (origin.x + solved.x), y: dropped.y - (origin.y + solved.y) };
}

/**
 * Build a constraint from a canvas selection.
 *
 * Selection order is the authoring order — the boxes go where the user picked them, not where they
 * happen to sit — because the point of a constraint is to state the arrangement rather than to
 * record the one that already exists.
 */
export function constraintFromSelection(
  kind: LayoutConstraintKind,
  ids: string[],
  rows = 2
): LayoutConstraint {
  switch (kind) {
    case 'grid': return { kind: 'grid', columns: chunk(ids, Math.max(1, Math.floor(rows))), align: 'center' };
    case 'row': return { kind: 'row', ids, align: 'center' };
    case 'column': return { kind: 'column', ids, align: 'center' };
    case 'stack': return { kind: 'stack', ids };
  }
}

/** Split into runs of at most `size`. A grid's columns are column-major, filled top to bottom. */
export function chunk<T>(items: T[], size: number): T[][] {
  if (size < 1) return items.length ? [items] : [];
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** Ids the constraint places that are not in the model — a typo an agent cannot see otherwise. */
export function danglingIds(constraint: LayoutConstraint, knownIds: Iterable<string>): string[] {
  const known = new Set(knownIds);
  return constraintIds(constraint).filter((id) => !known.has(id));
}
