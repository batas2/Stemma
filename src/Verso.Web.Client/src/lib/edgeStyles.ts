export type EdgeLineStyle = 'solid' | 'dashed' | 'dotted';

export interface EdgeStyle {
  thickness: number;       // 1 — 5
  lineStyle: EdgeLineStyle;
  color?: string;          // optional CSS color override
}

export const DEFAULT_EDGE_STYLE: EdgeStyle = { thickness: 1.5, lineStyle: 'solid' };

const KEY_PREFIX = 'verso.edgeStyles';

function key(rootPath: string): string { return `${KEY_PREFIX}:${rootPath}`; }

export function loadEdgeStyles(rootPath: string): Record<string, EdgeStyle> {
  if (typeof window === 'undefined') return {};
  try {
    const raw = localStorage.getItem(key(rootPath));
    return raw ? JSON.parse(raw) : {};
  } catch { return {}; }
}

export function saveEdgeStyles(rootPath: string, styles: Record<string, EdgeStyle>): void {
  if (typeof window === 'undefined') return;
  try { localStorage.setItem(key(rootPath), JSON.stringify(styles)); } catch { /* ignore */ }
}

export function setEdgeStyle(rootPath: string, edgeId: string, style: EdgeStyle): Record<string, EdgeStyle> {
  const all = loadEdgeStyles(rootPath);
  all[edgeId] = style;
  saveEdgeStyles(rootPath, all);
  return all;
}

export function dashArrayFor(s: EdgeLineStyle): string | undefined {
  switch (s) {
    case 'dashed': return '8 4';
    case 'dotted': return '2 4';
    default: return undefined;
  }
}
