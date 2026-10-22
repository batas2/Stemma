/**
 * What is wrong with a picture, measured rather than looked at (F-022).
 *
 * An agent judges its diagram by looking at a PNG, and vision models are unreliable at exactly the
 * faults that make a diagram hard to read: they tell zero, one or two line crossings apart a little
 * over half the time. The renderer knows every box and every line to the unit, so it says what is
 * wrong — in rule ids and element ids, which are what an agent can change.
 *
 * Pure: geometry in, findings out. The geometry is read off the live canvas (`renderGeometry.ts`), so
 * the numbers are the ones the picture was drawn with.
 */

export interface GeoBox { x: number; y: number; w: number; h: number; }
export interface GeoPoint { x: number; y: number; }

export interface GeoNode extends GeoBox {
  id: string;
  /** A context or system boundary drawn around other cards: lines cross into it on purpose. */
  frame?: boolean;
}

export interface GeoEdge {
  id: string;
  source: string;
  target: string;
  /** The line as drawn, in flow units: exact for a routed edge, sampled for a curve. */
  points: GeoPoint[];
}

export interface GeoLabel extends GeoBox { edgeId: string; }

export interface RenderGeometry {
  nodes: GeoNode[];
  edges: GeoEdge[];
  labels: GeoLabel[];
  bounds: GeoBox;
}

export type LintSeverity = 'warning' | 'info';

export interface LintFinding {
  severity: LintSeverity;
  rule: string;
  message: string;
  /** The elements and links involved, the ones to change. */
  ids: string[];
}

/** How far a line may run into a card before it counts as through it — an arrowhead ends on the outline. */
const THROUGH_TOLERANCE = 4;
/** How much two boxes may touch before they count as overlapping. */
const OVERLAP_TOLERANCE = 2;
/** Two segments this close and parallel are drawn on top of each other. */
const COLLINEAR_DISTANCE = 1.5;
/** An edge hidden along another for more than this share of its length cannot be told apart. */
const HIDDEN_SHARE = 0.6;

function shrink(b: GeoBox, by: number): GeoBox {
  return { x: b.x + by, y: b.y + by, w: b.w - 2 * by, h: b.h - 2 * by };
}

function boxesOverlap(a: GeoBox, b: GeoBox, tolerance = OVERLAP_TOLERANCE): boolean {
  return a.x + tolerance < b.x + b.w && b.x + tolerance < a.x + a.w
    && a.y + tolerance < b.y + b.h && b.y + tolerance < a.y + a.h;
}

/** Whether segment ab passes through the interior of box (Liang–Barsky clipping). */
export function segmentHitsBox(a: GeoPoint, b: GeoPoint, box: GeoBox): boolean {
  if (box.w <= 0 || box.h <= 0) return false;
  const dx = b.x - a.x, dy = b.y - a.y;
  let t0 = 0, t1 = 1;
  const clip = (p: number, q: number): boolean => {
    if (p === 0) return q > 0;
    const r = q / p;
    if (p < 0) { if (r > t1) return false; if (r > t0) t0 = r; }
    else { if (r < t0) return false; if (r < t1) t1 = r; }
    return true;
  };
  return clip(-dx, a.x - box.x) && clip(dx, box.x + box.w - a.x)
    && clip(-dy, a.y - box.y) && clip(dy, box.y + box.h - a.y)
    && t1 - t0 > 1e-6;
}

/** Whether two segments cross at a point inside both — touching at an end is not a crossing. */
function segmentsCross(a: GeoPoint, b: GeoPoint, c: GeoPoint, d: GeoPoint): boolean {
  const cross = (p: GeoPoint, q: GeoPoint, r: GeoPoint) => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
  const d1 = cross(c, d, a), d2 = cross(c, d, b), d3 = cross(a, b, c), d4 = cross(a, b, d);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}

function length(a: GeoPoint, b: GeoPoint): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

function polylineLength(points: GeoPoint[]): number {
  let total = 0;
  for (let i = 0; i < points.length - 1; i++) total += length(points[i], points[i + 1]);
  return total;
}

/** How long segments ab and cd lie on top of each other: parallel, nearly coincident, overlapping. */
function sharedLength(a: GeoPoint, b: GeoPoint, c: GeoPoint, d: GeoPoint): number {
  const len = length(a, b);
  if (len === 0 || length(c, d) === 0) return 0;
  const ux = (b.x - a.x) / len, uy = (b.y - a.y) / len;
  // Parallel: cd's direction has (almost) no component across ab.
  const cdLen = length(c, d);
  const across = Math.abs(((d.x - c.x) / cdLen) * uy - ((d.y - c.y) / cdLen) * ux);
  if (across > 0.02) return 0;
  // Coincident: c lies (almost) on the line through ab.
  const offset = Math.abs((c.x - a.x) * uy - (c.y - a.y) * ux);
  if (offset > COLLINEAR_DISTANCE) return 0;
  const tc = (c.x - a.x) * ux + (c.y - a.y) * uy;
  const td = (d.x - a.x) * ux + (d.y - a.y) * uy;
  const lo = Math.max(0, Math.min(tc, td)), hi = Math.min(len, Math.max(tc, td));
  return Math.max(0, hi - lo);
}

export function lintLayout(g: RenderGeometry): LintFinding[] {
  const findings: LintFinding[] = [];
  const cards = g.nodes.filter((n) => !n.frame);

  for (let i = 0; i < cards.length; i++) {
    for (let j = i + 1; j < cards.length; j++) {
      if (boxesOverlap(cards[i], cards[j])) {
        findings.push({
          severity: 'warning', rule: 'layout/node-overlap', ids: [cards[i].id, cards[j].id],
          message: `${cards[i].id} and ${cards[j].id} overlap`,
        });
      }
    }
  }

  for (const e of g.edges) {
    for (const n of cards) {
      if (n.id === e.source || n.id === e.target) continue;
      const inner = shrink(n, THROUGH_TOLERANCE);
      for (let i = 0; i < e.points.length - 1; i++) {
        if (segmentHitsBox(e.points[i], e.points[i + 1], inner)) {
          findings.push({
            severity: 'warning', rule: 'layout/edge-through-node', ids: [e.id, n.id],
            message: `${e.id} passes through ${n.id}`,
          });
          break;
        }
      }
    }
  }

  for (let i = 0; i < g.labels.length; i++) {
    const l = g.labels[i];
    for (let j = i + 1; j < g.labels.length; j++) {
      const m = g.labels[j];
      if (boxesOverlap(l, m)) {
        findings.push({
          severity: 'warning', rule: 'layout/label-overlap', ids: [l.edgeId, m.edgeId],
          message: `the labels of ${l.edgeId} and ${m.edgeId} overlap`,
        });
      }
    }
    for (const n of cards) {
      if (boxesOverlap(l, n)) {
        findings.push({
          severity: 'warning', rule: 'layout/label-overlap', ids: [l.edgeId, n.id],
          message: `the label of ${l.edgeId} covers ${n.id}`,
        });
      }
    }
  }

  // An edge drawn along another for most of its length — the back edge in a row that vanished under
  // the forward ones (the audit's A5). Measured against every other edge's segments.
  for (const e of g.edges) {
    const total = polylineLength(e.points);
    if (total < 1) continue;
    for (const o of g.edges) {
      if (o.id === e.id) continue;
      let shared = 0;
      for (let i = 0; i < e.points.length - 1; i++) {
        for (let j = 0; j < o.points.length - 1; j++) {
          shared += sharedLength(e.points[i], e.points[i + 1], o.points[j], o.points[j + 1]);
        }
      }
      if (shared / total > HIDDEN_SHARE) {
        findings.push({
          severity: 'warning', rule: 'layout/edge-hidden', ids: [e.id, o.id],
          message: `${e.id} runs along ${o.id} for most of its length, so it cannot be told apart`,
        });
        break;
      }
    }
  }

  let crossings = 0;
  const crossed = new Set<string>();
  for (let a = 0; a < g.edges.length; a++) {
    for (let b = a + 1; b < g.edges.length; b++) {
      const p = g.edges[a].points, q = g.edges[b].points;
      for (let i = 0; i < p.length - 1; i++) {
        for (let j = 0; j < q.length - 1; j++) {
          if (segmentsCross(p[i], p[i + 1], q[j], q[j + 1])) {
            crossings++;
            crossed.add(g.edges[a].id);
            crossed.add(g.edges[b].id);
          }
        }
      }
    }
  }
  if (crossings > 0) {
    findings.push({
      severity: crossings > g.edges.length ? 'warning' : 'info', rule: 'layout/crossings', ids: [...crossed].sort(),
      message: `edges cross ${crossings} time${crossings === 1 ? '' : 's'}${crossings > g.edges.length ? ' — more crossings than edges' : ''}`,
    });
  }

  return findings;
}
