import { cachedSection, sidecarSet } from './layout';

export type EdgeLineStyle = 'solid' | 'dashed' | 'dotted';
/** Endpoint marker styles available at each end of a relationship. */
export type EdgeArrow = 'none' | 'closed' | 'open' | 'circle' | 'diamond' | 'pipe';
export type EdgeAnimSpeed = 'slow' | 'normal' | 'fast';
/** How the line between two boxes is drawn (draw.io-style). `bezier` is the default bend. */
export type EdgeRouting = 'bezier' | 'smoothstep' | 'step' | 'straight';
/** How large an edge's label is drawn — larger for a room than for a screen (F-014). */
export type EdgeLabelSize = 'sm' | 'base' | 'lg' | 'xl';

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
  labelSize?: EdgeLabelSize;
}

/** SVG marker id (in EdgeMarkerDefs) for an endpoint style — undefined = no marker. */
export function arrowMarkerUrl(a?: EdgeArrow): string | undefined {
  switch (a) {
    case 'closed': return 'url(#stemma-arrowclosed)';
    case 'open': return 'url(#stemma-arrow)';
    case 'circle': return 'url(#stemma-circle)';
    case 'diamond': return 'url(#stemma-diamond)';
    case 'pipe': return 'url(#stemma-pipe)';
    default: return undefined; // 'none' / unset
  }
}

export const DEFAULT_EDGE_STYLE: EdgeStyle = { thickness: 1.5, lineStyle: 'solid' };

export function loadEdgeStyles(rootPath: string): Record<string, EdgeStyle> {
  return cachedSection<EdgeStyle>(rootPath, 'edgeStyles');
}

export function setEdgeStyle(rootPath: string, edgeId: string, style: EdgeStyle): Record<string, EdgeStyle> {
  const all = loadEdgeStyles(rootPath);
  all[edgeId] = style;
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
