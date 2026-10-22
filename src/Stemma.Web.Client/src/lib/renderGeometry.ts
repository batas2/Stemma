import type { GeoBox, GeoEdge, GeoLabel, GeoNode, GeoPoint, RenderGeometry } from './layoutLint';

/**
 * The picture's geometry, read off the live canvas (F-022): every card's box, every edge as the line
 * actually drawn, every label's box — in flow units, the coordinates the layout and the sidecar use.
 *
 * Read from the DOM on purpose. The layout, the routing, the docking and the label placement each
 * decide part of where things end up; the drawn picture is the only place where all of their answers
 * meet, and it is what the reader of the image will see.
 */

/** How finely a curved edge is sampled into a polyline, in flow units along the path. */
const SAMPLE_STEP = 6;

/**
 * Drop the points of a polyline that lie on the line between their neighbours. A sampled straight run
 * collapses to its two ends, which keeps the lint's pairwise comparisons proportional to the bends
 * rather than to the length.
 */
export function simplify(points: GeoPoint[], tolerance = 0.25): GeoPoint[] {
  if (points.length <= 2) return points;
  const out: GeoPoint[] = [points[0]];
  for (let i = 1; i < points.length - 1; i++) {
    const a = out[out.length - 1], b = points[i], c = points[i + 1];
    const len = Math.hypot(c.x - a.x, c.y - a.y);
    const off = len === 0 ? 0 : Math.abs((c.x - a.x) * (a.y - b.y) - (a.x - b.x) * (c.y - a.y)) / len;
    if (off > tolerance) out.push(b);
  }
  out.push(points[points.length - 1]);
  return out;
}

function viewportTransform(root: ParentNode): { x: number; y: number; zoom: number } {
  const viewport = root.querySelector<HTMLElement>('.react-flow__viewport');
  const m = /translate\(([-\d.]+)px,\s*([-\d.]+)px\)(?:\s*scale\(([\d.]+)\))?/.exec(viewport?.style.transform ?? '');
  return { x: m ? parseFloat(m[1]) : 0, y: m ? parseFloat(m[2]) : 0, zoom: m && m[3] ? parseFloat(m[3]) : 1 };
}

export function readRenderGeometry(edgeEnds: { id: string; source: string; target: string }[], root: ParentNode = document): RenderGeometry {
  const flow = root.querySelector<HTMLElement>('.react-flow');
  const origin = flow?.getBoundingClientRect() ?? { left: 0, top: 0 };
  const vp = viewportTransform(root);
  const toFlow = (r: DOMRect): GeoBox => ({
    x: (r.left - origin.left - vp.x) / vp.zoom,
    y: (r.top - origin.top - vp.y) / vp.zoom,
    w: r.width / vp.zoom,
    h: r.height / vp.zoom,
  });

  const nodes: GeoNode[] = [];
  for (const el of root.querySelectorAll<HTMLElement>('.react-flow__node')) {
    const id = el.dataset.id;
    if (!id || el.classList.contains('stemma-layout-pending')) continue;
    nodes.push({ id, ...toFlow(el.getBoundingClientRect()), frame: !!el.querySelector('.stemma-bc-frame') });
  }

  const edges: GeoEdge[] = [];
  for (const { id, source, target } of edgeEnds) {
    const path = root.querySelector<SVGPathElement>(`.react-flow__edge[data-id="${CSS.escape(id)}"] .react-flow__edge-path`);
    if (!path || typeof path.getTotalLength !== 'function') continue;
    // Edge paths live inside the viewport's transform, so their own coordinates are flow units.
    const total = path.getTotalLength();
    const points: GeoPoint[] = [];
    for (let at = 0; at < total; at += SAMPLE_STEP) {
      const p = path.getPointAtLength(at);
      points.push({ x: p.x, y: p.y });
    }
    const end = path.getPointAtLength(total);
    points.push({ x: end.x, y: end.y });
    edges.push({ id, source, target, points: simplify(points) });
  }

  const labels: GeoLabel[] = [];
  for (const el of root.querySelectorAll<HTMLElement>('.stemma-edge-label[data-edge-id]')) {
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) continue;
    labels.push({ edgeId: el.dataset.edgeId!, ...toFlow(r) });
  }

  const xs = nodes.flatMap((n) => [n.x, n.x + n.w]);
  const ys = nodes.flatMap((n) => [n.y, n.y + n.h]);
  const bounds = nodes.length === 0
    ? { x: 0, y: 0, w: 0, h: 0 }
    : { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
  return { nodes, edges, labels, bounds };
}
