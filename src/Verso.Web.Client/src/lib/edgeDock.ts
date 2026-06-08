/**
 * Pick which of a node's 6 connection dots an edge should dock to, by geometry — the draw.io-style
 * "nearest sensible connection point". The 6 dot ids match the handles rendered by ArchNodeView:
 *   t1, t2  — top edge at 33% / 67%
 *   b1, b2  — bottom edge at 33% / 67%
 *   l       — left edge midpoint
 *   r       — right edge midpoint
 */
export interface DockRect { x: number; y: number; w: number; h: number; }

export type DockId = 't1' | 't2' | 'b1' | 'b2' | 'l' | 'r';

/** The dot on `box` that faces `toward` (a point — typically the other box's centre). */
export function dotFacing(box: DockRect, toward: { x: number; y: number }): DockId {
  const cx = box.x + box.w / 2;
  const cy = box.y + box.h / 2;
  const dx = toward.x - cx;
  const dy = toward.y - cy;
  // Compare the line's slope against the box aspect ratio so wide boxes prefer top/bottom and tall
  // boxes prefer left/right appropriately (|dx|/w vs |dy|/h).
  const horizontalDominant = Math.abs(dx) * box.h >= Math.abs(dy) * box.w;
  if (horizontalDominant) return dx >= 0 ? 'r' : 'l';
  const side = dy >= 0 ? 'b' : 't';
  // Of the two dots on that side (33% left vs 67% right), use the one the target leans toward.
  return (dx >= 0 ? `${side}2` : `${side}1`) as DockId;
}

/** Source + target dots for an edge between two boxes, each facing the other. */
export function autoDock(from: DockRect, to: DockRect): { source: DockId; target: DockId } {
  const fc = { x: from.x + from.w / 2, y: from.y + from.h / 2 };
  const tc = { x: to.x + to.w / 2, y: to.y + to.h / 2 };
  return { source: dotFacing(from, tc), target: dotFacing(to, fc) };
}
