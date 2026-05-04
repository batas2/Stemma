export type NodeBorderStyle = 'solid' | 'dashed' | 'dotted';

export interface NodeStyle {
  fillColor?: string;     // CSS color (rgb / hex), undefined = theme default
  borderColor?: string;
  borderWidth: number;    // px, 1–5
  borderStyle: NodeBorderStyle;
}

export const DEFAULT_NODE_STYLE: NodeStyle = { borderWidth: 1, borderStyle: 'solid' };

const KEY_PREFIX = 'verso.nodeStyles';

function key(rootPath: string): string { return `${KEY_PREFIX}:${rootPath}`; }

export function loadNodeStyles(rootPath: string): Record<string, NodeStyle> {
  if (typeof window === 'undefined') return {};
  try {
    const raw = localStorage.getItem(key(rootPath));
    return raw ? JSON.parse(raw) : {};
  } catch { return {}; }
}

export function saveNodeStyles(rootPath: string, styles: Record<string, NodeStyle>): void {
  if (typeof window === 'undefined') return;
  try { localStorage.setItem(key(rootPath), JSON.stringify(styles)); } catch { /* ignore */ }
}

export function setNodeStyle(rootPath: string, nodeId: string, style: NodeStyle): Record<string, NodeStyle> {
  const all = loadNodeStyles(rootPath);
  all[nodeId] = style;
  saveNodeStyles(rootPath, all);
  return all;
}
