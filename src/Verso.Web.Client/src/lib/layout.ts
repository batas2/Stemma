import type { ViewKind } from './types';

export interface SavedPosition { x: number; y: number; }

const KEY_PREFIX = 'verso.layout';

function key(workspaceRoot: string, view: ViewKind): string {
  return `${KEY_PREFIX}:${workspaceRoot}:${view}`;
}

export function loadLayout(workspaceRoot: string, view: ViewKind): Record<string, SavedPosition> {
  if (typeof window === 'undefined') return {};
  try {
    const raw = localStorage.getItem(key(workspaceRoot, view));
    return raw ? JSON.parse(raw) : {};
  } catch { return {}; }
}

export function saveLayout(workspaceRoot: string, view: ViewKind, positions: Record<string, SavedPosition>): void {
  if (typeof window === 'undefined') return;
  try { localStorage.setItem(key(workspaceRoot, view), JSON.stringify(positions)); } catch { /* ignore */ }
}

export function mergePositions(
  defaults: Record<string, SavedPosition>,
  saved: Record<string, SavedPosition>
): Record<string, SavedPosition> {
  return { ...defaults, ...saved };
}
