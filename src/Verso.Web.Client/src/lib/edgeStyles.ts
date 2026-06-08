import { sidecarMap, sidecarSet } from './layout';

export type EdgeLineStyle = 'solid' | 'dashed' | 'dotted';
/** Endpoint marker styles available at each end of a relationship. */
export type EdgeArrow = 'none' | 'closed' | 'open' | 'circle' | 'diamond' | 'pipe';
export type EdgeAnimSpeed = 'slow' | 'normal' | 'fast';
/** How the line between two boxes is drawn (draw.io-style). `bezier` is the default bend. */
export type EdgeRouting = 'bezier' | 'smoothstep' | 'step' | 'straight';

/** Routing used when an edge has no explicit `routing` — a gentle curve, matching the
 *  connection line shown while dragging a new relationship. */
export const DEFAULT_EDGE_ROUTING: EdgeRouting = 'bezier';

export interface EdgeStyle {
  thickness: number;       // 1 — 5
  lineStyle: EdgeLineStyle;
  routing?: EdgeRouting;   // line shape: curved / elbow / step / straight
  color?: string;          // optional CSS color override
  animated?: boolean;      // animated "flow" dashes along the edge
  animSpeed?: EdgeAnimSpeed;
  arrow?: EdgeArrow;       // legacy alias for the target-end marker (migrated to `arrowEnd`)
  arrowStart?: EdgeArrow;  // marker at the source end
  arrowEnd?: EdgeArrow;    // marker at the target end
}

/** SVG marker id (in EdgeMarkerDefs) for an endpoint style — undefined = no marker. */
export function arrowMarkerUrl(a?: EdgeArrow): string | undefined {
  switch (a) {
    case 'closed': return 'url(#verso-arrowclosed)';
    case 'open': return 'url(#verso-arrow)';
    case 'circle': return 'url(#verso-circle)';
    case 'diamond': return 'url(#verso-diamond)';
    case 'pipe': return 'url(#verso-pipe)';
    default: return undefined; // 'none' / unset
  }
}

export const DEFAULT_EDGE_STYLE: EdgeStyle = { thickness: 1.5, lineStyle: 'solid' };

const KEY_PREFIX = 'verso.edgeStyles';

function key(rootPath: string): string { return `${KEY_PREFIX}:${rootPath}`; }

export function loadEdgeStyles(rootPath: string): Record<string, EdgeStyle> {
  if (typeof window === 'undefined') return {};
  let local: Record<string, EdgeStyle> = {};
  try { const raw = localStorage.getItem(key(rootPath)); local = raw ? JSON.parse(raw) : {}; } catch { /* ignore */ }
  const committed = sidecarMap<EdgeStyle>(rootPath, 'edgeStyles');
  return committed ? { ...local, ...committed } : local;
}

export function saveEdgeStyles(rootPath: string, styles: Record<string, EdgeStyle>): void {
  if (typeof window === 'undefined') return;
  try { localStorage.setItem(key(rootPath), JSON.stringify(styles)); } catch { /* ignore */ }
}

export function setEdgeStyle(rootPath: string, edgeId: string, style: EdgeStyle): Record<string, EdgeStyle> {
  const all = loadEdgeStyles(rootPath);
  all[edgeId] = style;
  saveEdgeStyles(rootPath, all);
  sidecarSet(rootPath, 'edgeStyles', edgeId, style);
  return all;
}

export function dashArrayFor(s: EdgeLineStyle): string | undefined {
  switch (s) {
    case 'dashed': return '8 4';
    case 'dotted': return '2 4';
    default: return undefined;
  }
}
