import type { ArchElement, ArchLink } from './types';
import type { SavedPosition } from './layout';

export type LayoutAlgorithm = 'hierarchical' | 'force';

/**
 * Algorithm 1 — Hierarchical (layered).
 * Topologically sorts elements by their `BoundedContext` membership and link direction.
 * Tier 1: Persons / Software Systems (top row).
 * Tier 2..N: each Bounded Context as a row, modules/capabilities laid out left-to-right within.
 * Modules without a context land in a "Loose" row at the bottom.
 *
 * This produces clean, predictable diagrams for module-map / C4-context style models.
 */
export function layoutHierarchical(
  elements: ArchElement[],
  _links: ArchLink[]
): Record<string, SavedPosition> {
  const out: Record<string, SavedPosition> = {};
  const COL_W = 240;
  const ROW_H = 130;
  const PAD_X = 60;
  const PAD_Y = 60;

  let y = PAD_Y;

  const persons = elements.filter((e) => e.kind === 'person');
  const systems = elements.filter((e) => e.kind === 'softwareSystem' || e.kind === 'container');
  const tier1 = [...persons, ...systems];
  if (tier1.length > 0) {
    tier1.forEach((e, i) => { out[e.id] = { x: PAD_X + i * COL_W, y }; });
    y += ROW_H + 30;
  }

  const ctxs = elements.filter((e) => e.kind === 'boundedContext');
  for (const ctx of ctxs) {
    out[ctx.id] = { x: PAD_X, y };
    const childModules = elements.filter(
      (e) => (e.kind === 'module' || e.kind === 'capability') && e.attributes.contextId === ctx.id
    );
    childModules.forEach((m, i) => {
      out[m.id] = { x: PAD_X + (i + 1) * COL_W + 60, y };
    });
    y += ROW_H + 40;
  }

  const looseModules = elements.filter(
    (e) => (e.kind === 'module' || e.kind === 'capability')
        && !ctxs.some((c) => c.id === e.attributes.contextId)
  );
  if (looseModules.length > 0) {
    looseModules.forEach((m, i) => { out[m.id] = { x: PAD_X + i * COL_W, y }; });
    y += ROW_H;
  }

  const useCases = elements.filter((e) => e.kind === 'useCase');
  if (useCases.length > 0) {
    useCases.forEach((u, i) => { out[u.id] = { x: PAD_X + i * COL_W, y }; });
  }

  return out;
}

/**
 * Algorithm 2 — Force-directed (organic).
 * Iterative spring-and-repulsion simulation:
 *  - Every pair of nodes pushes each other away (Coulomb-like, 1/r^2).
 *  - Every link pulls its endpoints together (Hooke spring).
 * Produces compact, clustered layouts good for dependency graphs.
 *
 * Pure, deterministic: positions seeded by current coordinates if provided, else random.
 */
export function layoutForceDirected(
  elements: ArchElement[],
  links: ArchLink[],
  seed: Record<string, SavedPosition> = {},
  iterations = 200
): Record<string, SavedPosition> {
  if (elements.length === 0) return {};
  const n = elements.length;
  const positions: Record<string, { x: number; y: number; vx: number; vy: number }> = {};
  const center = { x: 400, y: 280 };
  const radius = 80 + 30 * Math.sqrt(n);

  // Seed positions: keep existing if provided, otherwise distribute on a circle.
  elements.forEach((e, i) => {
    const s = seed[e.id];
    if (s) positions[e.id] = { x: s.x, y: s.y, vx: 0, vy: 0 };
    else {
      const angle = (2 * Math.PI * i) / n;
      positions[e.id] = {
        x: center.x + Math.cos(angle) * radius,
        y: center.y + Math.sin(angle) * radius,
        vx: 0, vy: 0
      };
    }
  });

  const repulsion = 6000;
  const springLength = 180;
  const springK = 0.04;
  const damping = 0.85;
  const maxStep = 30;

  for (let step = 0; step < iterations; step++) {
    // Repulsion forces between all pairs.
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const a = positions[elements[i].id];
        const b = positions[elements[j].id];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const distSq = Math.max(50, dx * dx + dy * dy);
        const dist = Math.sqrt(distSq);
        const f = repulsion / distSq;
        const fx = (dx / dist) * f;
        const fy = (dy / dist) * f;
        a.vx -= fx; a.vy -= fy;
        b.vx += fx; b.vy += fy;
      }
    }

    // Spring forces along links.
    for (const link of links) {
      const a = positions[link.fromId];
      const b = positions[link.toId];
      if (!a || !b) continue;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const dist = Math.sqrt(dx * dx + dy * dy) || 1;
      const displacement = dist - springLength;
      const f = springK * displacement;
      const fx = (dx / dist) * f;
      const fy = (dy / dist) * f;
      a.vx += fx; a.vy += fy;
      b.vx -= fx; b.vy -= fy;
    }

    // Apply velocities (damped, clamped).
    for (const id in positions) {
      const p = positions[id];
      p.vx *= damping;
      p.vy *= damping;
      const stepLen = Math.sqrt(p.vx * p.vx + p.vy * p.vy);
      if (stepLen > maxStep) {
        p.vx = (p.vx / stepLen) * maxStep;
        p.vy = (p.vy / stepLen) * maxStep;
      }
      p.x += p.vx;
      p.y += p.vy;
    }
  }

  const out: Record<string, SavedPosition> = {};
  for (const id in positions) out[id] = { x: positions[id].x, y: positions[id].y };
  return out;
}

/**
 * Snap a point to the nearest grid cell.
 */
export function snapToGrid(x: number, y: number, gridSize = 20): { x: number; y: number } {
  return { x: Math.round(x / gridSize) * gridSize, y: Math.round(y / gridSize) * gridSize };
}

/**
 * Align a set of selected nodes to share an axis.
 */
export function alignSelected(
  positions: Record<string, SavedPosition>,
  selectedIds: string[],
  axis: 'left' | 'right' | 'top' | 'bottom' | 'centerX' | 'centerY'
): Record<string, SavedPosition> {
  if (selectedIds.length < 2) return positions;
  const subset = selectedIds.filter((id) => positions[id]);
  if (subset.length < 2) return positions;
  const xs = subset.map((id) => positions[id].x);
  const ys = subset.map((id) => positions[id].y);
  let target: number;
  switch (axis) {
    case 'left': target = Math.min(...xs); break;
    case 'right': target = Math.max(...xs); break;
    case 'top': target = Math.min(...ys); break;
    case 'bottom': target = Math.max(...ys); break;
    case 'centerX': target = xs.reduce((a, b) => a + b, 0) / xs.length; break;
    case 'centerY': target = ys.reduce((a, b) => a + b, 0) / ys.length; break;
  }
  const out = { ...positions };
  for (const id of subset) {
    if (axis === 'left' || axis === 'right' || axis === 'centerX') out[id] = { ...out[id], x: target };
    else out[id] = { ...out[id], y: target };
  }
  return out;
}

/**
 * Distribute selected nodes evenly along the given axis.
 */
export function distributeSelected(
  positions: Record<string, SavedPosition>,
  selectedIds: string[],
  axis: 'horizontal' | 'vertical'
): Record<string, SavedPosition> {
  if (selectedIds.length < 3) return positions;
  const subset = selectedIds.filter((id) => positions[id]);
  if (subset.length < 3) return positions;
  const sorted = [...subset].sort((a, b) =>
    axis === 'horizontal' ? positions[a].x - positions[b].x : positions[a].y - positions[b].y
  );
  const first = positions[sorted[0]];
  const last = positions[sorted[sorted.length - 1]];
  const total = axis === 'horizontal' ? last.x - first.x : last.y - first.y;
  const step = total / (sorted.length - 1);
  const out = { ...positions };
  sorted.forEach((id, i) => {
    if (axis === 'horizontal') out[id] = { ...out[id], x: first.x + step * i };
    else out[id] = { ...out[id], y: first.y + step * i };
  });
  return out;
}
