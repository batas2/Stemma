import type { ArchElement, ArchLink, ViewKind } from './types';
import type { SavedPosition } from './layout';

export type LayoutAlgorithm = 'hierarchical' | 'force' | 'focused' | 'byType';

// ---------- Shared helpers ----------

interface Adjacency {
  out: Map<string, string[]>;
  in: Map<string, string[]>;
}

function buildAdjacency(elements: ArchElement[], links: ArchLink[]): Adjacency {
  const ids = new Set(elements.map((e) => e.id));
  const out = new Map<string, string[]>();
  const inMap = new Map<string, string[]>();
  for (const e of elements) { out.set(e.id, []); inMap.set(e.id, []); }
  for (const l of links) {
    if (!ids.has(l.fromId) || !ids.has(l.toId) || l.fromId === l.toId) continue;
    out.get(l.fromId)!.push(l.toId);
    inMap.get(l.toId)!.push(l.fromId);
  }
  return { out, in: inMap };
}

/** Number of edge crossings in a 2-layer drawing given orderings. Used as a quality metric
 *  for crossing-minimization sweeps in Sugiyama. */
function countCrossings(
  upper: string[], lower: string[],
  edges: Array<[string, string]>,
): number {
  const upIdx = new Map(upper.map((id, i) => [id, i] as const));
  const loIdx = new Map(lower.map((id, i) => [id, i] as const));
  const pairs = edges
    .map(([u, l]) => [upIdx.get(u), loIdx.get(l)] as const)
    .filter((p): p is readonly [number, number] => p[0] !== undefined && p[1] !== undefined);
  let crossings = 0;
  for (let i = 0; i < pairs.length; i++) {
    for (let j = i + 1; j < pairs.length; j++) {
      const [a1, b1] = pairs[i];
      const [a2, b2] = pairs[j];
      if ((a1 < a2 && b1 > b2) || (a1 > a2 && b1 < b2)) crossings++;
    }
  }
  return crossings;
}

// ---------- Algorithm 1 — Hierarchical (Sugiyama, BC-aware) ----------

/**
 * Hierarchical (layered) layout, Sugiyama-style:
 *   1. Layer assignment by domain rules + longest-path refinement so directed
 *      relationships flow downward.
 *   2. Within-layer ordering minimised by repeated barycentric sweeps; BoundedContext
 *      membership is preserved as a soft tiebreak so modules of the same context cluster.
 *   3. Coordinate assignment on a fixed grid with BC-aware horizontal alignment so the
 *      same context column-aligns across layers when possible.
 */
export function layoutHierarchical(
  elements: ArchElement[],
  links: ArchLink[],
): Record<string, SavedPosition> {
  if (elements.length === 0) return {};

  const adj = buildAdjacency(elements, links);

  // ----- 1. Initial layer assignment by domain role -----
  const baseTier: Record<string, number> = {
    person: 0, softwareSystem: 1, container: 1,
    boundedContext: 2, capability: 3, module: 3, useCase: 4,
  };
  const layer = new Map<string, number>();
  for (const e of elements) layer.set(e.id, baseTier[e.kind] ?? 5);

  // ----- 2. Longest-path refinement: each node sits one layer below its deepest predecessor
  //         that crosses a "real" link. Bounded by domain tier so persons never sink. -----
  for (let pass = 0; pass < 8; pass++) {
    let changed = false;
    for (const e of elements) {
      const tierMin = baseTier[e.kind] ?? 0;
      const ins = adj.in.get(e.id) ?? [];
      let maxIn = -1;
      for (const src of ins) maxIn = Math.max(maxIn, layer.get(src) ?? -1);
      const desired = Math.max(tierMin, maxIn + 1);
      if (desired !== layer.get(e.id)) {
        layer.set(e.id, desired);
        changed = true;
      }
    }
    if (!changed) break;
  }

  // ----- 3. Bucket by layer -----
  const byLayer = new Map<number, ArchElement[]>();
  for (const e of elements) {
    const l = layer.get(e.id)!;
    (byLayer.get(l) ?? byLayer.set(l, []).get(l)!).push(e);
  }
  const layerKeys = [...byLayer.keys()].sort((a, b) => a - b);

  // Initial ordering within each layer: group by BoundedContext, then alphabetical.
  // BC ordering across layers shares the same anchor so columns line up.
  const ctxOrder = new Map<string, number>();
  const allCtx = elements.filter((e) => e.kind === 'boundedContext').sort((a, b) => a.name.localeCompare(b.name));
  allCtx.forEach((c, i) => ctxOrder.set(c.id, i));

  const ctxKey = (e: ArchElement) => {
    const cid = e.attributes?.contextId;
    if (cid && ctxOrder.has(cid)) return ctxOrder.get(cid)!;
    if (e.kind === 'boundedContext') return ctxOrder.get(e.id) ?? 999;
    return 999;
  };

  for (const lk of layerKeys) {
    byLayer.get(lk)!.sort((a, b) => {
      const ca = ctxKey(a), cb = ctxKey(b);
      if (ca !== cb) return ca - cb;
      return a.name.localeCompare(b.name);
    });
  }

  // ----- 4. Sugiyama crossing-minimisation: alternating up/down barycentric sweeps. -----
  const order = new Map<string, number>();
  for (const lk of layerKeys) byLayer.get(lk)!.forEach((e, i) => order.set(e.id, i));

  let bestCrossings = totalCrossings(byLayer, layerKeys, adj);
  const snapshot = () => new Map(order);
  let bestSnapshot = snapshot();

  for (let sweep = 0; sweep < 24; sweep++) {
    const downward = sweep % 2 === 0;
    const keys = downward ? layerKeys : [...layerKeys].reverse();
    for (const lk of keys) {
      const refLayer = lk + (downward ? -1 : 1);
      if (!byLayer.has(refLayer)) continue;
      const refs = downward ? adj.in : adj.out;
      const layerEls = byLayer.get(lk)!;
      const bary = (e: ArchElement): number => {
        const ns = (refs.get(e.id) ?? []).map((id) => order.get(id)).filter((v): v is number => typeof v === 'number');
        if (ns.length === 0) return order.get(e.id) ?? 0;
        return ns.reduce((s, v) => s + v, 0) / ns.length;
      };
      const sorted = [...layerEls].sort((a, b) => {
        const ba = bary(a), bb = bary(b);
        if (Math.abs(ba - bb) > 1e-6) return ba - bb;
        const ca = ctxKey(a), cb = ctxKey(b);
        if (ca !== cb) return ca - cb;
        return a.name.localeCompare(b.name);
      });
      sorted.forEach((e, i) => order.set(e.id, i));
      byLayer.set(lk, sorted);
    }
    const cross = totalCrossings(byLayer, layerKeys, adj);
    if (cross < bestCrossings) {
      bestCrossings = cross;
      bestSnapshot = snapshot();
    }
    if (cross === 0) break;
  }
  // Restore best ordering found across sweeps (barycentric can oscillate past optimum).
  for (const [id, idx] of bestSnapshot) order.set(id, idx);
  for (const lk of layerKeys) {
    byLayer.get(lk)!.sort((a, b) => order.get(a.id)! - order.get(b.id)!);
  }

  // ----- 5. Coordinate assignment. Centre each row around 0; tighter horizontal pitch
  //         when a layer has few nodes, looser when there are many (auto-fit-ish). -----
  const COL_W = 240;
  const ROW_H = 170;
  const PAD_Y = 60;
  const out: Record<string, SavedPosition> = {};
  const minLayer = layerKeys[0];
  for (const lk of layerKeys) {
    const layerEls = byLayer.get(lk)!;
    const total = layerEls.length;
    const rowWidth = total * COL_W;
    const startX = -rowWidth / 2 + COL_W / 2;
    layerEls.forEach((e, i) => {
      out[e.id] = { x: startX + i * COL_W, y: PAD_Y + (lk - minLayer) * ROW_H };
    });
  }
  return out;
}

function totalCrossings(byLayer: Map<number, ArchElement[]>, layerKeys: number[], adj: Adjacency): number {
  let total = 0;
  for (let i = 0; i < layerKeys.length - 1; i++) {
    const upper = byLayer.get(layerKeys[i])!.map((e) => e.id);
    const lower = byLayer.get(layerKeys[i + 1])!.map((e) => e.id);
    const edges: Array<[string, string]> = [];
    for (const u of upper) for (const t of adj.out.get(u) ?? []) if (lower.includes(t)) edges.push([u, t]);
    total += countCrossings(upper, lower, edges);
  }
  return total;
}

// ---------- Algorithm 2 — Force-directed (Fruchterman–Reingold, cluster-aware) ----------

export interface ForceLayoutOptions {
  iterations?: number;
  /** Minimum gap between rendered box edges. Defaults to 40 px. */
  padding?: number;
  /** Strength of pull toward the global centroid; counteracts isolated-node drift. */
  gravity?: number;
  /** Per-node rendered size so repulsion accounts for box dimensions, not just centres. */
  sizes?: Record<string, { w: number; h: number }>;
}

/**
 * Force-directed layout with Fruchterman-Reingold dynamics, tuned for architecture diagrams:
 *   - F_repulsion ≈ k² / gap, where `gap` is the AABB edge-to-edge distance — bigger boxes
 *     therefore repel harder, which is what stops two large nodes from overlapping when their
 *     centres are 'k' apart but their bodies aren't.
 *   - F_attraction = d² / k along every edge.
 *   - Same-BC pairs repel ~half-strength and get a centroid pull so contexts cohere.
 *   - Global centroid gravity stops disconnected nodes from drifting to infinity.
 *   - A final AABB collision-resolution sweep guarantees zero box overlap on output.
 *
 * Pass `sizes` (rendered widths/heights from React Flow) for accurate non-overlap; without
 * it the algorithm falls back to per-kind defaults that match `ArchNodeView`.
 */
export function layoutForceDirected(
  elements: ArchElement[],
  links: ArchLink[],
  seed: Record<string, SavedPosition> = {},
  opts: ForceLayoutOptions = {},
): Record<string, SavedPosition> {
  if (elements.length === 0) return {};
  const n = elements.length;
  const iterations = opts.iterations ?? 320;
  const padding = opts.padding ?? 40;
  const gravity = opts.gravity ?? 0.06;
  const sizesIn = opts.sizes ?? {};

  // Per-element rendered size. Defaults track ArchNodeView so the algorithm produces
  // sensible spacing even when the caller can't supply measured DOM sizes.
  const sizeOf = (e: ArchElement): { w: number; h: number } => {
    const s = sizesIn[e.id];
    if (s) return s;
    if (e.kind === 'person') return { w: 140, h: 56 };
    if (e.kind === 'boundedContext') return { w: 240, h: 120 };
    return { w: 220, h: 100 };
  };

  // Sizing area scales with average box footprint, not a fixed canvas — avoids the bug
  // where a 100-node graph with big boxes used a layout area suitable for tiny ones.
  const avgW = elements.reduce((s, e) => s + sizeOf(e).w, 0) / n;
  const avgH = elements.reduce((s, e) => s + sizeOf(e).h, 0) / n;
  const W = Math.max(800, 1.9 * avgW * Math.sqrt(n));
  const H = Math.max(600, 1.9 * avgH * Math.sqrt(n));
  const k = Math.sqrt((W * H) / n);

  type P = { x: number; y: number; dx: number; dy: number; w: number; h: number };
  const pos: Record<string, P> = {};
  const cluster = new Map<string, string>();
  elements.forEach((e, i) => {
    const s = seed[e.id];
    const sz = sizeOf(e);
    cluster.set(e.id, e.attributes?.contextId ?? '__none');
    if (s) pos[e.id] = { x: s.x, y: s.y, dx: 0, dy: 0, w: sz.w, h: sz.h };
    else {
      const angle = (2 * Math.PI * i) / n;
      const r = k * Math.sqrt(n) / 2;
      pos[e.id] = { x: Math.cos(angle) * r, y: Math.sin(angle) * r, dx: 0, dy: 0, w: sz.w, h: sz.h };
    }
  });

  const idList = elements.map((e) => e.id);
  const idSet = new Set(idList);

  // Attraction edges = model links + "about" annotations (Risk / Question / Assumption → the
  // element they're about). Those `aboutId` references are NOT model links, so without adding
  // them here the annotation nodes are *disconnected* — they feel only repulsion + weak gravity
  // and drift to the far balance point (the bug in the screenshot). They pull a bit harder
  // (w > 1) so they hug their parent instead of floating.
  const attractEdges: { from: string; to: string; w: number }[] = [];
  for (const l of links) {
    if (idSet.has(l.fromId) && idSet.has(l.toId) && l.fromId !== l.toId) attractEdges.push({ from: l.fromId, to: l.toId, w: 1 });
  }
  for (const e of elements) {
    const about = e.attributes?.aboutId;
    if (about && about !== e.id && idSet.has(about)) attractEdges.push({ from: e.id, to: about, w: 1.8 });
  }

  const startTemp = k * 1.1;
  const endTemp = k * 0.04;

  for (let step = 0; step < iterations; step++) {
    const t = startTemp * Math.pow(endTemp / startTemp, step / iterations);

    for (const id of idList) { pos[id].dx = 0; pos[id].dy = 0; }

    // Repulsion. We use AABB edge-gap as the "distance" so big boxes push harder than small
    // ones at the same centre-distance, and overlapping boxes get a strong separating push
    // along their minimum-translation axis on the same step.
    for (let i = 0; i < n; i++) {
      const a = pos[idList[i]];
      const ca = cluster.get(idList[i]);
      for (let j = i + 1; j < n; j++) {
        const b = pos[idList[j]];
        let dx = a.x - b.x;
        let dy = a.y - b.y;
        let d2 = dx * dx + dy * dy;
        if (d2 < 1) { dx = (Math.random() - 0.5) * 0.5; dy = (Math.random() - 0.5) * 0.5; d2 = dx * dx + dy * dy; }
        const d = Math.sqrt(d2);

        const xGap = Math.abs(dx) - (a.w + b.w) / 2;
        const yGap = Math.abs(dy) - (a.h + b.h) / 2;
        const edgeGap = Math.max(xGap, yGap);
        // Floor at half-padding so overlapping pairs (edgeGap < 0) get a finite — but very
        // strong — repulsion instead of dividing by zero.
        const effective = Math.max(padding * 0.5, edgeGap + padding);
        if (effective > 5 * k) continue;
        const cb = cluster.get(idList[j]);
        const sameCluster = ca === cb && ca !== '__none';
        const repScale = sameCluster ? 0.55 : 1;
        const f = (k * k) / effective * repScale;
        const fx = (dx / d) * f;
        const fy = (dy / d) * f;
        a.dx += fx; a.dy += fy;
        b.dx -= fx; b.dy -= fy;

        // If boxes overlap on both axes, add a hard separation impulse along the smaller
        // overlap axis (minimum-translation vector). Combined with the soft repulsion this
        // keeps overlap from persisting across steps.
        if (xGap < 0 && yGap < 0) {
          const ox = -xGap, oy = -yGap;
          if (ox < oy) {
            const sx = dx >= 0 ? 1 : -1;
            const push = ox * 1.5;
            a.dx += sx * push; b.dx -= sx * push;
          } else {
            const sy = dy >= 0 ? 1 : -1;
            const push = oy * 1.5;
            a.dy += sy * push; b.dy -= sy * push;
          }
        }
      }
    }

    // Attraction along edges (model links + about-annotations) — classic FR, edge-weighted.
    for (const ed of attractEdges) {
      const a = pos[ed.from];
      const b = pos[ed.to];
      if (!a || !b) continue;
      const dx = a.x - b.x;
      const dy = a.y - b.y;
      const d = Math.sqrt(dx * dx + dy * dy) || 0.01;
      const f = (d * d) / k * ed.w;
      const fx = (dx / d) * f;
      const fy = (dy / d) * f;
      a.dx -= fx; a.dy -= fy;
      b.dx += fx; b.dy += fy;
    }

    // Cluster centroid pull — keeps a BC's modules visually close.
    const centroids = new Map<string, { x: number; y: number; n: number }>();
    for (const id of idList) {
      const c = cluster.get(id)!;
      if (c === '__none') continue;
      const cur = centroids.get(c) ?? { x: 0, y: 0, n: 0 };
      cur.x += pos[id].x; cur.y += pos[id].y; cur.n++;
      centroids.set(c, cur);
    }
    for (const c of centroids.values()) { c.x /= c.n; c.y /= c.n; }
    const clusterPull = 0.022;
    for (const id of idList) {
      const c = cluster.get(id)!;
      if (c === '__none') continue;
      const ctr = centroids.get(c)!;
      pos[id].dx += (ctr.x - pos[id].x) * clusterPull;
      pos[id].dy += (ctr.y - pos[id].y) * clusterPull;
    }

    // Global gravity toward overall centroid. Without this, a node with no edges and no
    // cluster has only repulsion acting on it — it drifts outward until it leaves the
    // viewport. With gentle gravity it parks near the rest of the graph.
    let cx = 0, cy = 0;
    for (const id of idList) { cx += pos[id].x; cy += pos[id].y; }
    cx /= n; cy /= n;
    for (const id of idList) {
      pos[id].dx += (cx - pos[id].x) * gravity;
      pos[id].dy += (cy - pos[id].y) * gravity;
    }

    // Apply with cooling.
    for (const id of idList) {
      const p = pos[id];
      const speed = Math.sqrt(p.dx * p.dx + p.dy * p.dy) || 0.01;
      const move = Math.min(speed, t);
      p.x += (p.dx / speed) * move;
      p.y += (p.dy / speed) * move;
    }
  }

  // Final overlap-resolution sweep. Pure AABB collision response — no spring, no
  // temperature — guarantees the returned layout has zero overlapping boxes. Cheap:
  // ~30 passes is enough even for dense graphs because each pass halves residual overlap.
  for (let pass = 0; pass < 60; pass++) {
    let any = false;
    for (let i = 0; i < n; i++) {
      const a = pos[idList[i]];
      for (let j = i + 1; j < n; j++) {
        const b = pos[idList[j]];
        const dx = a.x - b.x;
        const dy = a.y - b.y;
        const overlapX = (a.w + b.w) / 2 + padding - Math.abs(dx);
        const overlapY = (a.h + b.h) / 2 + padding - Math.abs(dy);
        if (overlapX <= 0 || overlapY <= 0) continue;
        any = true;
        if (overlapX < overlapY) {
          const sx = dx >= 0 ? 1 : -1;
          const half = overlapX / 2 + 0.5;
          a.x += sx * half; b.x -= sx * half;
        } else {
          const sy = dy >= 0 ? 1 : -1;
          const half = overlapY / 2 + 0.5;
          a.y += sy * half; b.y -= sy * half;
        }
      }
    }
    if (!any) break;
  }

  const out: Record<string, SavedPosition> = {};
  for (const id of idList) out[id] = { x: pos[id].x, y: pos[id].y };
  return out;
}


// ---------- Algorithm 4 — Focus-Around-Entity (radial BFS) ----------

/**
 * Lays the focused element in the centre with concentric rings of neighbours.
 *   - Ring d contains nodes reachable in exactly d undirected hops, up to `maxDepth`.
 *   - Within a ring, neighbours are ordered by the angular barycentre of their parent-ring
 *     connections, so each node sits closest to its main attractor (minimising ring-to-ring
 *     edge crossings without an expensive crossing count).
 *   - Nodes outside maxDepth are flowed into a faint grid below, spaced far enough that the
 *     focus is unambiguous without hiding context entirely.
 * Architects use this when they want to see "what does X talk to and what depends on X"
 * without the full graph drowning the answer.
 */
export function layoutFocused(
  focusId: string,
  elements: ArchElement[],
  links: ArchLink[],
  maxDepth = 3,
): Record<string, SavedPosition> {
  const focusEl = elements.find((e) => e.id === focusId);
  if (!focusEl) return {};

  // Undirected adjacency — relationships are bidirectional for "around me" framing.
  const ids = new Set(elements.map((e) => e.id));
  const neighbours = new Map<string, Set<string>>();
  for (const e of elements) neighbours.set(e.id, new Set());
  for (const l of links) {
    if (!ids.has(l.fromId) || !ids.has(l.toId) || l.fromId === l.toId) continue;
    neighbours.get(l.fromId)!.add(l.toId);
    neighbours.get(l.toId)!.add(l.fromId);
  }

  // BFS depth from focus.
  const depth = new Map<string, number>();
  depth.set(focusId, 0);
  const queue: string[] = [focusId];
  while (queue.length > 0) {
    const cur = queue.shift()!;
    const d = depth.get(cur)!;
    if (d >= maxDepth) continue;
    for (const n of neighbours.get(cur) ?? []) {
      if (!depth.has(n)) { depth.set(n, d + 1); queue.push(n); }
    }
  }
  const byDepth = new Map<number, string[]>();
  for (const [id, d] of depth) {
    (byDepth.get(d) ?? byDepth.set(d, []).get(d)!).push(id);
  }

  const out: Record<string, SavedPosition> = {};
  const cx = 0, cy = 0;
  out[focusId] = { x: cx, y: cy };

  // Geometry tuned so default nodes (~220 wide) on the first ring don't overlap, and rings
  // grow slowly enough that a 3-hop view fits a reasonable canvas (~1600 px wide).
  const baseRadius = 260;
  const ringStep = 320;
  const ringRadius = (d: number) => baseRadius + (d - 1) * ringStep;

  // Track each placed node's angle so the next ring can barycentre against it.
  const angleAt = new Map<string, number>();
  angleAt.set(focusId, 0);

  for (let d = 1; d <= maxDepth; d++) {
    const ring = byDepth.get(d) ?? [];
    if (ring.length === 0) continue;

    // Score: average angle of neighbours that are already placed (parent ring or focus).
    const angularBary = (id: string): number => {
      const ns = [...(neighbours.get(id) ?? [])].filter((p) => angleAt.has(p));
      if (ns.length === 0) return 0;
      let sx = 0, sy = 0;
      for (const p of ns) {
        const a = angleAt.get(p)!;
        sx += Math.cos(a); sy += Math.sin(a);
      }
      return Math.atan2(sy, sx);
    };

    // Sort by barycentre angle so adjacent ring members share parents → fewer crossings.
    const sorted = [...ring].sort((a, b) => angularBary(a) - angularBary(b));

    const r = ringRadius(d);
    // Even angular distribution. Offset alternate rings by half-step so dots stagger.
    const offset = (d % 2 === 0 ? Math.PI / Math.max(1, sorted.length) : 0);
    const slot = (2 * Math.PI) / sorted.length;
    sorted.forEach((id, i) => {
      const angle = i * slot + offset;
      angleAt.set(id, angle);
      out[id] = { x: cx + Math.cos(angle) * r, y: cy + Math.sin(angle) * r };
    });
  }

  // Out-of-scope nodes: flow into a faint grid well below the focus area so they're parked,
  // not deleted from the view. Architects can still see them and pan to them.
  const unreached = elements.filter((e) => !depth.has(e.id));
  if (unreached.length > 0) {
    const off = ringRadius(maxDepth) + 260;
    const cols = Math.min(8, Math.max(4, Math.ceil(Math.sqrt(unreached.length))));
    const colW = 240, rowH = 130;
    const totalW = cols * colW;
    unreached.forEach((e, i) => {
      const col = i % cols;
      const row = Math.floor(i / cols);
      out[e.id] = { x: cx - totalW / 2 + col * colW, y: cy + off + row * rowH };
    });
  }

  return out;
}

// ---------- Algorithm 5 — By-Type (view-aware, industry-standard) ----------

export interface ByTypeLayoutOptions {
  /** Diagram view this layout will be drawn on. Drives skeleton selection. */
  view?: ViewKind;
  /** Per-node rendered size from the live DOM. Improves spacing accuracy. */
  sizes?: Record<string, { w: number; h: number }>;
  /** Gap between elements within the same group (e.g. modules of the same BC). */
  gap?: number;
  /** Gap between distinct groups (e.g. between BC columns). */
  groupGap?: number;
  /** Gap between rows. */
  rowGap?: number;
}

/**
 * Architectural ("by type") layout — picks layering and coordinate rules from element
 * kinds and the current diagram view, then minimises edge crossings within and across
 * layers. Follows the conventions practising architects expect:
 *
 *   - **Module Map / Context Map views** — Bounded Contexts as vertical columns; modules
 *     of a context stack under their BC card. BC column order is chosen by barycentric
 *     sort over inter-BC edges so heavy talkers end up adjacent (fewer crossings).
 *   - **Dependency views** — rows are layers of topological depth (apps/edges at top,
 *     domain/business in the middle, infrastructure at the bottom — the classic onion).
 *     BCs become horizontal sub-clusters within each row; within-layer ordering is fixed
 *     by Sugiyama-style barycentric + median + adjacent-swap sweeps.
 *   - **Custom views** — falls back to the context-map skeleton.
 *
 * All paths run a final crossing-minimisation pass that keeps the best ordering ever
 * observed across sweeps (barycentric heuristics can oscillate past the optimum).
 */
export function layoutByType(
  elements: ArchElement[],
  links: ArchLink[],
  opts: ByTypeLayoutOptions = {},
): Record<string, SavedPosition> {
  if (elements.length === 0) return {};
  switch (opts.view) {
    case 'dependencyGraph': return layeredDependencyLayout(elements, links, opts);
    case 'moduleMap':       return contextMapLayout(elements, links, opts);
    default:                return contextMapLayout(elements, links, opts);
  }
}

// ----- Shared sizing/grouping helpers used by every view skeleton. -----

function getSize(sizes: Record<string, { w: number; h: number }>, e: ArchElement): { w: number; h: number } {
  const s = sizes[e.id];
  if (s) return s;
  if (e.kind === 'person') return { w: 140, h: 56 };
  if (e.kind === 'boundedContext') return { w: 240, h: 120 };
  return { w: 220, h: 100 };
}

/**
 * Place a row of elements left-to-right, centred at x = 0, with intra-group `gap` and
 * larger `groupGap` between distinct groups. Returns top-left positions keyed by id.
 */
function placeRowByGroup(
  row: ArchElement[],
  groupOf: (e: ArchElement) => string,
  y: number,
  sizes: Record<string, { w: number; h: number }>,
  gap: number,
  groupGap: number,
): Record<string, SavedPosition> {
  const out: Record<string, SavedPosition> = {};
  if (row.length === 0) return out;
  let totalWidth = 0;
  let prevGroup: string | null = null;
  for (const e of row) {
    const sz = getSize(sizes, e);
    if (prevGroup !== null) totalWidth += groupOf(e) === prevGroup ? gap : groupGap;
    totalWidth += sz.w;
    prevGroup = groupOf(e);
  }
  let cursor = -totalWidth / 2;
  prevGroup = null;
  for (const e of row) {
    const sz = getSize(sizes, e);
    if (prevGroup !== null) cursor += groupOf(e) === prevGroup ? gap : groupGap;
    out[e.id] = { x: cursor, y };
    cursor += sz.w;
    prevGroup = groupOf(e);
  }
  return out;
}

/**
 * Sugiyama-style crossing minimisation for a stack of layers. Combines:
 *   - Alternating up/down barycentric sweeps,
 *   - Median sweeps every other pass (median often beats barycentric on dense graphs),
 *   - Greedy adjacent-pair swaps after each sweep,
 * keeping the best ordering ever observed. Layers are mutated in place.
 */
function minimiseLayerCrossings(
  layers: ArchElement[][],
  adj: Adjacency,
  groupOf: (e: ArchElement) => string,
): void {
  const ids = layers.map((l) => l.map((e) => e.id));
  const order = new Map<string, number>();
  for (const layer of ids) layer.forEach((id, i) => order.set(id, i));

  const totalCrosses = (): number => {
    let total = 0;
    for (let li = 0; li < ids.length - 1; li++) {
      const upper = ids[li], lower = ids[li + 1];
      const lowerSet = new Set(lower);
      const edges: Array<[string, string]> = [];
      for (const u of upper) for (const t of adj.out.get(u) ?? []) if (lowerSet.has(t)) edges.push([u, t]);
      total += countCrossings(upper, lower, edges);
    }
    return total;
  };

  let bestCrosses = totalCrosses();
  let bestSnapshot = ids.map((l) => [...l]);

  for (let sweep = 0; sweep < 32; sweep++) {
    const downward = sweep % 2 === 0;
    const useMedian = (sweep % 4) >= 2;
    for (let li = 0; li < ids.length; li++) {
      const lk = downward ? li : ids.length - 1 - li;
      const refIdx = lk + (downward ? -1 : 1);
      if (refIdx < 0 || refIdx >= ids.length) continue;
      const refRank = new Map(ids[refIdx].map((id, i) => [id, i] as const));
      const refs = downward ? adj.in : adj.out;
      const score = (id: string): number => {
        const ns = (refs.get(id) ?? []).map((n) => refRank.get(n)).filter((v): v is number => typeof v === 'number');
        if (ns.length === 0) return order.get(id) ?? 0;
        if (useMedian) {
          const sorted = [...ns].sort((a, b) => a - b);
          const m = sorted.length;
          return m % 2 === 1 ? sorted[(m - 1) / 2] : (sorted[m / 2 - 1] + sorted[m / 2]) / 2;
        }
        return ns.reduce((s, v) => s + v, 0) / ns.length;
      };
      const layerEls = layers[lk];
      const elById = new Map(layerEls.map((e) => [e.id, e] as const));
      const sortedIds = [...ids[lk]].sort((a, b) => {
        const sa = score(a), sb = score(b);
        if (Math.abs(sa - sb) > 1e-6) return sa - sb;
        const ga = groupOf(elById.get(a)!), gb = groupOf(elById.get(b)!);
        if (ga !== gb) return ga.localeCompare(gb);
        return a.localeCompare(b);
      });
      ids[lk] = sortedIds;
      sortedIds.forEach((id, i) => order.set(id, i));
      layers[lk] = sortedIds.map((id) => elById.get(id)!);
    }

    // Greedy adjacent swap on each pair of adjacent layers, twice for stability.
    for (let pass = 0; pass < 2; pass++) {
      for (let li = 0; li < ids.length - 1; li++) {
        const upper = ids[li];
        const lower = ids[li + 1];
        const lowerSet = new Set(lower);
        const edges: Array<[string, string]> = [];
        for (const u of upper) for (const t of adj.out.get(u) ?? []) if (lowerSet.has(t)) edges.push([u, t]);
        for (let i = 0; i < lower.length - 1; i++) {
          const before = countCrossings(upper, lower, edges);
          const tmp = lower[i]; lower[i] = lower[i + 1]; lower[i + 1] = tmp;
          const after = countCrossings(upper, lower, edges);
          if (after >= before) { lower[i + 1] = lower[i]; lower[i] = tmp; }
        }
        ids[li + 1] = lower;
        const elMap = new Map(layers[li + 1].map((e) => [e.id, e] as const));
        layers[li + 1] = lower.map((id) => elMap.get(id)!);
      }
    }

    const cross = totalCrosses();
    if (cross < bestCrosses) { bestCrosses = cross; bestSnapshot = ids.map((l) => [...l]); }
    if (cross === 0) break;
  }

  // Restore best ordering observed across sweeps.
  for (let li = 0; li < ids.length; li++) {
    const elMap = new Map(layers[li].map((e) => [e.id, e] as const));
    layers[li] = bestSnapshot[li].map((id) => elMap.get(id)!).filter(Boolean);
  }
}

// ----- View skeletons -----


function contextMapLayout(
  elements: ArchElement[],
  links: ArchLink[],
  opts: ByTypeLayoutOptions,
): Record<string, SavedPosition> {
  const sizes = opts.sizes ?? {};
  const gap = opts.gap ?? 40;
  const groupGap = opts.groupGap ?? 110;
  const rowGap = opts.rowGap ?? 60;

  const ctxs = elements.filter((e) => e.kind === 'boundedContext');
  const ctxIdSet = new Set(ctxs.map((c) => c.id));
  const otherTopLevel = elements.filter((e) =>
    e.kind === 'person' || e.kind === 'softwareSystem' || e.kind === 'container' || e.kind === 'useCase'
  );
  const orphanModules = elements.filter((e) =>
    (e.kind === 'module' || e.kind === 'capability')
    && (!e.attributes?.contextId || !ctxIdSet.has(e.attributes.contextId))
  );

  const adj = buildAdjacency(elements, links);
  const moduleCtx = (id: string): string | null => {
    const m = elements.find((e) => e.id === id);
    if (!m) return null;
    if (m.kind === 'boundedContext') return m.id;
    return m.attributes?.contextId ?? null;
  };

  // Inter-BC edge weights — used to order BC columns by barycentric sort.
  const ctxNeighbours = new Map<string, Map<string, number>>();
  for (const c of ctxs) ctxNeighbours.set(c.id, new Map());
  for (const l of links) {
    const fromCtx = moduleCtx(l.fromId);
    const toCtx = moduleCtx(l.toId);
    if (!fromCtx || !toCtx || fromCtx === toCtx) continue;
    if (!ctxIdSet.has(fromCtx) || !ctxIdSet.has(toCtx)) continue;
    const m1 = ctxNeighbours.get(fromCtx)!;
    m1.set(toCtx, (m1.get(toCtx) ?? 0) + 1);
    const m2 = ctxNeighbours.get(toCtx)!;
    m2.set(fromCtx, (m2.get(fromCtx) ?? 0) + 1);
  }

  // BC column ordering: minimise total weighted edge length across the column strip.
  // Greedy adjacent-swap converges where a one-shot barycentric sort would oscillate
  // (a single heavy edge can flip both endpoints across each other forever). Each pass
  // is O(n × edges); for typical model sizes this finishes in a few milliseconds.
  ctxs.sort((a, b) => a.name.localeCompare(b.name));
  const ctxOrder = new Map<string, number>();
  ctxs.forEach((c, i) => ctxOrder.set(c.id, i));
  const totalWeightedDistance = (): number => {
    let total = 0;
    for (const c of ctxs) {
      const cIdx = ctxOrder.get(c.id)!;
      for (const [nid, weight] of ctxNeighbours.get(c.id)!) {
        const nIdx = ctxOrder.get(nid);
        if (nIdx === undefined) continue;
        total += weight * Math.abs(cIdx - nIdx);
      }
    }
    return total / 2;
  };
  for (let pass = 0; pass < 64; pass++) {
    let improved = false;
    for (let i = 0; i < ctxs.length - 1; i++) {
      const before = totalWeightedDistance();
      const tmp = ctxs[i]; ctxs[i] = ctxs[i + 1]; ctxs[i + 1] = tmp;
      ctxOrder.set(ctxs[i].id, i);
      ctxOrder.set(ctxs[i + 1].id, i + 1);
      const after = totalWeightedDistance();
      if (after < before) {
        improved = true;
      } else {
        // Revert.
        const t2 = ctxs[i]; ctxs[i] = ctxs[i + 1]; ctxs[i + 1] = t2;
        ctxOrder.set(ctxs[i].id, i);
        ctxOrder.set(ctxs[i + 1].id, i + 1);
      }
    }
    if (!improved) break;
  }

  const out: Record<string, SavedPosition> = {};

  // Top row: top-level non-BC kinds (persons, systems, containers).
  if (otherTopLevel.length > 0) {
    Object.assign(out, placeRowByGroup(otherTopLevel, () => '__top', 0, sizes, gap, groupGap));
  }
  const bcRowY = otherTopLevel.length > 0 ? 200 : 0;

  // For each BC, sort its modules vertically by inter-BC barycentre (modules talking to
  // left-side neighbours float up, modules talking to right-side neighbours sink down).
  const sortModulesInCtx = (ctxId: string, mods: ArchElement[]): ArchElement[] => {
    const ctxIdx = ctxOrder.get(ctxId)!;
    const score = (m: ArchElement) => {
      const ns = [...(adj.out.get(m.id) ?? []), ...(adj.in.get(m.id) ?? [])];
      let s = 0, w = 0;
      for (const nid of ns) {
        const nctx = moduleCtx(nid);
        if (!nctx || !ctxIdSet.has(nctx) || nctx === ctxId) continue;
        s += (ctxOrder.get(nctx)! - ctxIdx); w++;
      }
      return w === 0 ? 0 : s / w;
    };
    return [...mods].sort((a, b) => {
      const sa = score(a), sb = score(b);
      if (Math.abs(sa - sb) > 1e-6) return sa - sb;
      return a.name.localeCompare(b.name);
    });
  };

  // Compute column widths first so we can centre the BC strip horizontally.
  const moduleByCtx = new Map<string, ArchElement[]>();
  for (const c of ctxs) {
    const cm = elements.filter((e) =>
      (e.kind === 'module' || e.kind === 'capability') && e.attributes?.contextId === c.id
    );
    moduleByCtx.set(c.id, sortModulesInCtx(c.id, cm));
  }
  const columnW = new Map<string, number>();
  for (const c of ctxs) {
    let w = getSize(sizes, c).w;
    for (const m of moduleByCtx.get(c.id) ?? []) w = Math.max(w, getSize(sizes, m).w);
    columnW.set(c.id, w);
  }
  let totalStripW = 0;
  ctxs.forEach((c, i) => {
    totalStripW += columnW.get(c.id)!;
    if (i < ctxs.length - 1) totalStripW += groupGap;
  });

  let cursorX = -totalStripW / 2;
  for (const c of ctxs) {
    const cs = getSize(sizes, c);
    const cw = columnW.get(c.id)!;
    out[c.id] = { x: cursorX + (cw - cs.w) / 2, y: bcRowY };
    let yCursor = bcRowY + cs.h + rowGap;
    for (const m of moduleByCtx.get(c.id) ?? []) {
      const ms = getSize(sizes, m);
      out[m.id] = { x: cursorX + (cw - ms.w) / 2, y: yCursor };
      yCursor += ms.h + rowGap;
    }
    cursorX += cw + groupGap;
  }

  if (orphanModules.length > 0) {
    let maxBottom = bcRowY;
    for (const id in out) {
      const e = elements.find((x) => x.id === id);
      if (!e) continue;
      maxBottom = Math.max(maxBottom, out[id].y + getSize(sizes, e).h);
    }
    Object.assign(out, placeRowByGroup(orphanModules, () => '__orphan', maxBottom + 200, sizes, gap, groupGap));
  }

  return out;
}

function layeredDependencyLayout(
  elements: ArchElement[],
  links: ArchLink[],
  opts: ByTypeLayoutOptions,
): Record<string, SavedPosition> {
  const sizes = opts.sizes ?? {};
  const gap = opts.gap ?? 40;
  const groupGap = opts.groupGap ?? 100;
  const rowGap = opts.rowGap ?? 180;

  const ids = new Set(elements.map((e) => e.id));
  const depEdges = links.filter((l) =>
    l.kind === 'dependency' && ids.has(l.fromId) && ids.has(l.toId) && l.fromId !== l.toId
  );
  const dataAdj: Adjacency = { out: new Map(), in: new Map() };
  for (const e of elements) { dataAdj.out.set(e.id, []); dataAdj.in.set(e.id, []); }
  for (const l of depEdges) {
    dataAdj.out.get(l.fromId)!.push(l.toId);
    dataAdj.in.get(l.toId)!.push(l.fromId);
  }

  // Layer = longest path from this node toward sinks. Nodes with no out-edges → layer 0
  // (drawn at the BOTTOM as infrastructure); nodes deepest in the chain go to the TOP
  // (apps / edges, the things that drive the dependency tree).
  const depth = new Map<string, number>();
  const visiting = new Set<string>();
  const computeDepth = (id: string): number => {
    if (depth.has(id)) return depth.get(id)!;
    if (visiting.has(id)) return 0; // break cycle
    visiting.add(id);
    let max = 0;
    for (const t of dataAdj.out.get(id) ?? []) max = Math.max(max, computeDepth(t) + 1);
    visiting.delete(id);
    depth.set(id, max);
    return max;
  };
  for (const e of elements) computeDepth(e.id);

  // Bucket. Top of diagram = highest depth (apps). Bottom = depth 0 (infra).
  const byLayer = new Map<number, ArchElement[]>();
  for (const e of elements) {
    const d = depth.get(e.id) ?? 0;
    (byLayer.get(d) ?? byLayer.set(d, []).get(d)!).push(e);
  }
  const layerKeys = [...byLayer.keys()].sort((a, b) => b - a); // descending → top-first

  // Initial within-layer ordering: by BC, then alphabetical.
  for (const lk of layerKeys) {
    byLayer.get(lk)!.sort((a, b) => {
      const ca = a.attributes?.contextId ?? '';
      const cb = b.attributes?.contextId ?? '';
      if (ca !== cb) return ca.localeCompare(cb);
      return a.name.localeCompare(b.name);
    });
  }

  // Sugiyama crossing minimisation across all layers — adj direction is "out", so
  // an "upper" layer (higher depth, drawn first/top) connects DOWN to the next layer.
  const layers = layerKeys.map((lk) => byLayer.get(lk)!);
  const groupOf = (e: ArchElement) => e.attributes?.contextId ?? '__none';
  minimiseLayerCrossings(layers, dataAdj, groupOf);

  const out: Record<string, SavedPosition> = {};
  layers.forEach((row, rowIdx) => {
    Object.assign(out, placeRowByGroup(row, groupOf, rowIdx * rowGap, sizes, gap, groupGap));
  });
  return out;
}

// ---------- Misc utilities ----------

export function snapToGrid(x: number, y: number, gridSize = 20): { x: number; y: number } {
  return { x: Math.round(x / gridSize) * gridSize, y: Math.round(y / gridSize) * gridSize };
}

export interface NodeBounds {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Align selected nodes on a shared edge / centre. Other nodes are returned unchanged.
 * Edge axes use rendered width/height so resized nodes line up correctly.
 */
export function alignSelected(
  bounds: Record<string, NodeBounds>,
  selectedIds: string[],
  axis: 'left' | 'right' | 'top' | 'bottom' | 'centerX' | 'centerY',
): Record<string, SavedPosition> {
  const out: Record<string, SavedPosition> = {};
  for (const id of Object.keys(bounds)) out[id] = { x: bounds[id].x, y: bounds[id].y };
  if (selectedIds.length < 2) return out;
  const subset = selectedIds.filter((id) => bounds[id]);
  if (subset.length < 2) return out;

  const get = (id: string) => bounds[id];
  let target: number;
  switch (axis) {
    case 'left':    target = Math.min(...subset.map((id) => get(id).x)); break;
    case 'right':   target = Math.max(...subset.map((id) => get(id).x + get(id).w)); break;
    case 'centerX': target = subset.reduce((s, id) => s + get(id).x + get(id).w / 2, 0) / subset.length; break;
    case 'top':     target = Math.min(...subset.map((id) => get(id).y)); break;
    case 'bottom':  target = Math.max(...subset.map((id) => get(id).y + get(id).h)); break;
    case 'centerY': target = subset.reduce((s, id) => s + get(id).y + get(id).h / 2, 0) / subset.length; break;
  }

  for (const id of subset) {
    const b = get(id);
    switch (axis) {
      case 'left':    out[id] = { x: target,             y: b.y }; break;
      case 'right':   out[id] = { x: target - b.w,       y: b.y }; break;
      case 'centerX': out[id] = { x: target - b.w / 2,   y: b.y }; break;
      case 'top':     out[id] = { x: b.x,                y: target }; break;
      case 'bottom':  out[id] = { x: b.x,                y: target - b.h }; break;
      case 'centerY': out[id] = { x: b.x,                y: target - b.h / 2 }; break;
    }
  }
  return out;
}

/**
 * Distribute selected nodes so centres are evenly spaced between the outermost selected
 * centres. Centres are used so boxes of different sizes look uniformly spaced visually.
 */
export function distributeSelected(
  bounds: Record<string, NodeBounds>,
  selectedIds: string[],
  axis: 'horizontal' | 'vertical',
): Record<string, SavedPosition> {
  const out: Record<string, SavedPosition> = {};
  for (const id of Object.keys(bounds)) out[id] = { x: bounds[id].x, y: bounds[id].y };
  if (selectedIds.length < 3) return out;
  const subset = selectedIds.filter((id) => bounds[id]);
  if (subset.length < 3) return out;

  const center = (id: string) => axis === 'horizontal'
    ? bounds[id].x + bounds[id].w / 2
    : bounds[id].y + bounds[id].h / 2;
  const sorted = [...subset].sort((a, b) => center(a) - center(b));
  const firstC = center(sorted[0]);
  const lastC = center(sorted[sorted.length - 1]);
  const step = (lastC - firstC) / (sorted.length - 1);

  sorted.forEach((id, i) => {
    const targetCenter = firstC + step * i;
    const b = bounds[id];
    if (axis === 'horizontal') out[id] = { x: targetCenter - b.w / 2, y: b.y };
    else out[id] = { x: b.x, y: targetCenter - b.h / 2 };
  });
  return out;
}
