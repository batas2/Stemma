import type { ElkExtendedEdge, ElkNode, LayoutOptions } from 'elkjs/lib/elk-api';
import type { SavedPosition } from './layout';

/**
 * A layered layout, solved by ELK, with its edges routed (F-021, ADR-0025).
 *
 * An agent that writes an architecture of twenty boxes cannot place them, and should not have to:
 * Mermaid draws the same graph legibly on the first try because dagre or ELK lays it out and routes
 * it. This is that, inside the canvas — the one renderer — so the app and a headless render cannot
 * disagree about where a box sits.
 *
 * It is a *constraint*, not a generator, under the test `layoutDsl.ts` states: given the same graph,
 * the same sizes and the same options it gives the same picture. So it is stored as intent, solved on
 * every open, nudged with offsets, and never baked. Three things make the "same" true rather than
 * hoped for: nodes and edges go to ELK in the order the model declares them, with
 * `considerModelOrder` breaking ties; sizes are rounded; and the seed is fixed. The ELK version is
 * pinned in package.json — an upgrade can move every unarranged picture and is reviewed as such.
 *
 * Pure apart from `solveLayered`, which loads ELK lazily: a workspace whose views are all arranged
 * never downloads it.
 */

export type LayeredDirection = 'down' | 'right' | 'up' | 'left';
export type LayeredRouting = 'orthogonal' | 'polyline' | 'spline';

export interface LayeredConstraint {
  kind: 'layered';
  /** Which way the flow runs. Down by default: people at the top, what they reach below. */
  direction?: LayeredDirection;
  /** `[between nodes in a layer, between layers]`, or one number for both. */
  spacing?: number | [number, number];
  /** Ids pinned to the first layer. */
  first?: string[];
  /** Ids pinned to the last layer — the external systems, usually. */
  last?: string[];
  /** Lay out a context around its modules and a system around its containers. On by default. */
  groups?: boolean;
  routing?: LayeredRouting;
}

export const DEFAULT_LAYERED_SPACING: [number, number] = [48, 72];

/**
 * A frame's padding around its children. The canvas draws a context's (and a system's) frame as the
 * children's bounding box grown by these, and ELK is told to leave exactly this much room inside a
 * group — so the frame ELK planned and the frame the canvas draws are the same rectangle.
 */
export const FRAME_PAD = 26;
export const FRAME_HEADER = 26;

export interface Box { x: number; y: number; w: number; h: number; }

export interface LayeredNode {
  id: string;
  w: number;
  h: number;
  /** The group this node is drawn inside — its context or system — when that group is in the view. */
  parent?: string | null;
}

export interface LayeredEdge {
  id: string;
  source: string;
  target: string;
  label?: string;
  /** The label's type size in pixels, which decides how much room ELK keeps for it. */
  labelPx?: number;
}

export interface LayeredInput {
  nodes: LayeredNode[];
  edges: LayeredEdge[];
  constraint: LayeredConstraint;
}

export interface EdgeRoute {
  /** From where the edge leaves its source to where it meets its target, every bend in between. */
  points: SavedPosition[];
  /** The box ELK kept clear for the label. */
  label?: Box;
}

export interface LayeredResult {
  /** Top-left of every node, groups included, in flow units. */
  positions: Record<string, SavedPosition>;
  /** The rectangle of every group that has children. */
  frames: Record<string, Box>;
  routes: Record<string, EdgeRoute>;
}

const DIRECTIONS: Record<LayeredDirection, string> = { down: 'DOWN', right: 'RIGHT', up: 'UP', left: 'LEFT' };
const ROUTINGS: Record<LayeredRouting, string> = { orthogonal: 'ORTHOGONAL', polyline: 'POLYLINE', spline: 'SPLINES' };

export function isLayeredConstraint(value: unknown): value is LayeredConstraint {
  return !!value && typeof value === 'object' && (value as { kind?: unknown }).kind === 'layered';
}

/** Every id the constraint names: the ones it pins. The rest of the view is governed without naming. */
export function layeredIds(c: LayeredConstraint): string[] {
  return [...new Set([...(Array.isArray(c.first) ? c.first : []), ...(Array.isArray(c.last) ? c.last : [])])];
}

/** A finite positive number, or the fallback — the sidecar is hand-written and agent-written. */
function gap(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : fallback;
}

function spacingPair(value: unknown): [number, number] {
  if (typeof value === 'number') return [gap(value, DEFAULT_LAYERED_SPACING[0]), gap(value, DEFAULT_LAYERED_SPACING[1])];
  if (Array.isArray(value)) return [gap(value[0], DEFAULT_LAYERED_SPACING[0]), gap(value[1], DEFAULT_LAYERED_SPACING[1])];
  return DEFAULT_LAYERED_SPACING;
}

/**
 * The room an edge label takes, without a DOM. Mirrors the label `WaypointEdge` draws — one line,
 * four pixels of padding a side and a hairline border — closely enough that ELK keeps its space
 * clear; an estimate that is a little generous costs a few pixels, one that is short costs an overlap.
 */
export function labelBox(text: string, px = 10): { w: number; h: number } {
  return { w: Math.ceil(text.length * px * 0.58) + 12, h: Math.ceil(px * 1.4) + 6 };
}

/** The ELK graph for a view. Pure, so what ELK is asked is testable without running it. */
export function buildElkGraph(input: LayeredInput): ElkNode {
  const c = input.constraint;
  const [nodeGap, layerGap] = spacingPair(c.spacing);
  const ids = new Set(input.nodes.map((n) => n.id));
  const groupsOn = c.groups !== false;

  const parentOf = new Map<string, string>();
  if (groupsOn) {
    for (const n of input.nodes) {
      if (n.parent && n.parent !== n.id && ids.has(n.parent)) parentOf.set(n.id, n.parent);
    }
    // A parent chain that loops back on itself is not a hierarchy; the node stays at the top.
    for (const id of [...parentOf.keys()]) {
      const seen = new Set([id]);
      for (let p = parentOf.get(id); p; p = parentOf.get(p)) {
        if (seen.has(p)) { parentOf.delete(id); break; }
        seen.add(p);
      }
    }
  }
  const isAncestor = (maybe: string, of: string): boolean => {
    for (let p = parentOf.get(of); p; p = parentOf.get(p)) if (p === maybe) return true;
    return false;
  };

  const children = new Map<string, LayeredNode[]>();
  const roots: LayeredNode[] = [];
  for (const n of input.nodes) {
    const p = parentOf.get(n.id);
    if (p) (children.get(p) ?? children.set(p, []).get(p)!).push(n);
    else roots.push(n);
  }

  const firsts = new Set(Array.isArray(c.first) ? c.first : []);
  const lasts = new Set(Array.isArray(c.last) ? c.last : []);
  const padding = `[top=${FRAME_PAD + FRAME_HEADER},left=${FRAME_PAD},bottom=${FRAME_PAD},right=${FRAME_PAD}]`;

  function toElk(n: LayeredNode): ElkNode {
    const options: LayoutOptions = {};
    if (firsts.has(n.id)) options['elk.layered.layering.layerConstraint'] = 'FIRST';
    else if (lasts.has(n.id)) options['elk.layered.layering.layerConstraint'] = 'LAST';
    const kids = children.get(n.id);
    if (kids && kids.length > 0) {
      return { id: n.id, layoutOptions: { ...options, 'elk.padding': padding }, children: kids.map(toElk) };
    }
    return { id: n.id, width: Math.round(n.w), height: Math.round(n.h), layoutOptions: options };
  }

  const seen = new Set<string>();
  const edges: ElkExtendedEdge[] = [];
  for (const e of input.edges) {
    if (seen.has(e.id) || !ids.has(e.source) || !ids.has(e.target)) continue;
    // An edge between a node and the group it is drawn in has no route that leaves the group, and
    // ELK refuses it; the canvas draws it unrouted.
    if (isAncestor(e.source, e.target) || isAncestor(e.target, e.source)) continue;
    seen.add(e.id);
    const edge: ElkExtendedEdge = { id: e.id, sources: [e.source], targets: [e.target] };
    if (e.label) {
      const size = labelBox(e.label, e.labelPx);
      edge.labels = [{ text: e.label, width: size.w, height: size.h, layoutOptions: { 'elk.edgeLabels.placement': 'CENTER' } }];
    }
    edges.push(edge);
  }

  return {
    id: '__root__',
    layoutOptions: {
      'elk.algorithm': 'layered',
      'elk.direction': DIRECTIONS[c.direction ?? 'down'] ?? 'DOWN',
      'elk.edgeRouting': ROUTINGS[c.routing ?? 'orthogonal'] ?? 'ORTHOGONAL',
      'elk.hierarchyHandling': 'INCLUDE_CHILDREN',
      'elk.layered.considerModelOrder.strategy': 'NODES_AND_EDGES',
      'elk.layered.nodePlacement.strategy': 'NETWORK_SIMPLEX',
      'elk.randomSeed': '1',
      'elk.spacing.nodeNode': String(nodeGap),
      'elk.layered.spacing.nodeNodeBetweenLayers': String(layerGap),
      'elk.spacing.edgeNode': '20',
      'elk.layered.spacing.edgeNodeBetweenLayers': '20',
      'elk.spacing.edgeEdge': '14',
      'elk.layered.spacing.edgeEdgeBetweenLayers': '12',
      'elk.spacing.edgeLabel': '4',
      'elk.json.shapeCoords': 'ROOT',
      'elk.json.edgeCoords': 'ROOT',
    },
    children: roots.map(toElk),
    edges,
  };
}

/** Positions, frames and routes out of a laid-out ELK graph, every coordinate in the root's frame. */
export function readElkResult(graph: ElkNode): LayeredResult {
  const positions: Record<string, SavedPosition> = {};
  const frames: Record<string, Box> = {};
  const routes: Record<string, EdgeRoute> = {};

  const walk = (n: ElkNode) => {
    for (const child of n.children ?? []) {
      positions[child.id] = { x: child.x ?? 0, y: child.y ?? 0 };
      if (child.children && child.children.length > 0) {
        frames[child.id] = { x: child.x ?? 0, y: child.y ?? 0, w: child.width ?? 0, h: child.height ?? 0 };
        walk(child);
      }
    }
  };
  walk(graph);

  const collect = (n: ElkNode) => {
    for (const e of n.edges ?? []) {
      const points: SavedPosition[] = [];
      for (const s of e.sections ?? []) {
        for (const p of [s.startPoint, ...(s.bendPoints ?? []), s.endPoint]) {
          const last = points[points.length - 1];
          if (!last || last.x !== p.x || last.y !== p.y) points.push({ x: p.x, y: p.y });
        }
      }
      if (points.length < 2) continue;
      const l = e.labels?.[0];
      routes[e.id] = l && l.x !== undefined && l.y !== undefined
        ? { points, label: { x: l.x, y: l.y, w: l.width ?? 0, h: l.height ?? 0 } }
        : { points };
    }
    for (const child of n.children ?? []) collect(child);
  };
  collect(graph);

  return { positions, frames, routes };
}

interface ElkApi { layout(graph: ElkNode): Promise<ElkNode>; }
let elkInstance: Promise<ElkApi> | null = null;

/** ELK, loaded once and only when a view first needs it — it is its own chunk of the bundle. */
function elk(): Promise<ElkApi> {
  elkInstance ??= import('elkjs/lib/elk.bundled.js').then((m) => new m.default() as unknown as ElkApi);
  return elkInstance;
}

/**
 * Lay a view out. Groups are tried first; a graph ELK cannot lay out with them (it refuses a few
 * hierarchical edge shapes) is laid out flat rather than not at all, and only a flat failure is an
 * error — which the canvas reports instead of drawing the fallback as if it were the layout.
 */
export async function solveLayered(input: LayeredInput): Promise<LayeredResult> {
  const api = await elk();
  try {
    return readElkResult(await api.layout(buildElkGraph(input)));
  } catch (first) {
    if (input.constraint.groups === false) throw first;
    return readElkResult(await api.layout(buildElkGraph({ ...input, constraint: { ...input.constraint, groups: false } })));
  }
}

/**
 * The nudge to store when a card on a layered view is dropped: where it landed, less where the layout
 * put it. The same contract as a grid's (`offsetForDrag`), against the solved result in hand.
 */
export function layeredOffsetForDrag(id: string, dropped: SavedPosition, solved: LayeredResult): SavedPosition | null {
  const p = solved.positions[id];
  return p ? { x: dropped.x - p.x, y: dropped.y - p.y } : null;
}
