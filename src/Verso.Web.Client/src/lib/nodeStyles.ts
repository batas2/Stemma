export type NodeBorderStyle = 'solid' | 'dashed' | 'dotted';

// Keys of the data we may render inside a node body (Q from "adjustable list of properties").
// Names map cleanly to ArchElement attribute paths so the renderer can look them up
// by key without a switch per kind.
export type NodeFieldKey =
  | 'kind'         // header label (Module / Bounded Context / …)
  | 'name'         // primary heading
  | 'id'           // raw id, mono
  | 'contextId'    // "in <ctx>" for modules
  | 'systemId'     // "in <sys>" for containers
  | 'containerKind'
  | 'squad'
  | 'domain'
  | 'status'       // status badge (lifecycle)
  | 'phase'
  | 'narrativePreview'; // first line of the capability narrative if loaded elsewhere

export const DEFAULT_VISIBLE_FIELDS: NodeFieldKey[] = ['kind', 'name', 'contextId', 'squad', 'status'];

export interface NodeStyle {
  fillColor?: string;     // CSS color (rgb / hex), undefined = theme default
  borderColor?: string;
  borderWidth: number;    // px, 1–5
  borderStyle: NodeBorderStyle;
  width?: number;         // px, persisted from NodeResizer drag
  height?: number;
  // Built-in NodeFieldKey values OR custom property names. Renderer falls
  // through built-in field handling first, then customProps[name] for the rest.
  visibleFields?: string[];
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
