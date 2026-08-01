import type { CustomView, ViewKind } from './types';

const KEY_PREFIX = 'stemma.views';
const ACTIVE_KEY = 'stemma.activeView';
const OPEN_KEY = 'stemma.openViews';

function key(rootPath: string): string {
  return `${KEY_PREFIX}:${rootPath}`;
}

export function loadViews(rootPath: string): CustomView[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(key(rootPath));
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

export function saveViews(rootPath: string, views: CustomView[]): void {
  if (typeof window === 'undefined') return;
  try { localStorage.setItem(key(rootPath), JSON.stringify(views)); } catch { /* ignore */ }
}

export function loadActiveView(rootPath: string): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem(`${ACTIVE_KEY}:${rootPath}`);
}

export function saveActiveView(rootPath: string, customViewId: string | null): void {
  if (typeof window === 'undefined') return;
  if (customViewId) localStorage.setItem(`${ACTIVE_KEY}:${rootPath}`, customViewId);
  else localStorage.removeItem(`${ACTIVE_KEY}:${rootPath}`);
}

/** Which saved views are currently open as bottom tabs. `null` = never persisted (fresh). */
export function loadOpenViews(rootPath: string): string[] | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(`${OPEN_KEY}:${rootPath}`);
    return raw ? JSON.parse(raw) as string[] : null;
  } catch { return null; }
}

export function saveOpenViews(rootPath: string, ids: string[]): void {
  if (typeof window === 'undefined') return;
  try { localStorage.setItem(`${OPEN_KEY}:${rootPath}`, JSON.stringify(ids)); } catch { /* ignore */ }
}

export function newCustomView(name: string, baseView: ViewKind | 'all' = 'all'): CustomView {
  return {
    id: `view_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
    name,
    baseView,
    elementIds: [],
    createdAt: new Date().toISOString(),
  };
}
