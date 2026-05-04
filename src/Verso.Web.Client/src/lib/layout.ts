import type { ViewKind } from './types';
import { fetchLayout, saveLayoutSidecar } from './api';

export interface SavedPosition { x: number; y: number; }

interface SidecarShape {
  version?: number;
  views?: Record<string, { nodes?: Record<string, SavedPosition>; edges?: Record<string, unknown> }>;
  nodeStyles?: Record<string, unknown>;
  edgeStyles?: Record<string, unknown>;
}

const KEY_PREFIX = 'verso.layout';
const MIGRATED_KEY_PREFIX = 'verso.layout.migrated';

function key(workspaceRoot: string, view: ViewKind | string): string {
  return `${KEY_PREFIX}:${workspaceRoot}:${view}`;
}

function migratedKey(workspaceRoot: string): string {
  return `${MIGRATED_KEY_PREFIX}:${workspaceRoot}`;
}

// In-memory cache of the latest sidecar so reads don't refetch every drag-stop.
let sidecarCache: { rootPath: string; sidecar: SidecarShape } | null = null;
let pendingWrite: { rootPath: string; sidecar: SidecarShape; timer: ReturnType<typeof setTimeout> } | null = null;

export function loadLayout(workspaceRoot: string, view: ViewKind | string): Record<string, SavedPosition> {
  if (typeof window === 'undefined') return {};
  // Sidecar wins — populated by `primeLayoutSidecar` during workspace open.
  if (sidecarCache?.rootPath === workspaceRoot) {
    const v = sidecarCache.sidecar.views?.[view];
    if (v?.nodes) return v.nodes;
  }
  try {
    const raw = localStorage.getItem(key(workspaceRoot, view));
    return raw ? JSON.parse(raw) : {};
  } catch { return {}; }
}

export function saveLayout(workspaceRoot: string, view: ViewKind | string, positions: Record<string, SavedPosition>): void {
  if (typeof window === 'undefined') return;
  // Localstorage as the durable in-browser cache.
  try { localStorage.setItem(key(workspaceRoot, view), JSON.stringify(positions)); } catch { /* ignore */ }

  // Update in-memory cache.
  if (!sidecarCache || sidecarCache.rootPath !== workspaceRoot) {
    sidecarCache = { rootPath: workspaceRoot, sidecar: { version: 1, views: {}, nodeStyles: {}, edgeStyles: {} } };
  }
  if (!sidecarCache.sidecar.views) sidecarCache.sidecar.views = {};
  sidecarCache.sidecar.views[view] = { ...sidecarCache.sidecar.views[view], nodes: positions };

  // Debounced PUT to verso.layout.json.
  if (pendingWrite?.rootPath === workspaceRoot) clearTimeout(pendingWrite.timer);
  const timer = setTimeout(() => {
    saveLayoutSidecar(sidecarCache!.sidecar).catch(() => { /* best-effort */ });
    pendingWrite = null;
  }, 400);
  pendingWrite = { rootPath: workspaceRoot, sidecar: sidecarCache.sidecar, timer };
}

export function mergePositions(
  defaults: Record<string, SavedPosition>,
  saved: Record<string, SavedPosition>
): Record<string, SavedPosition> {
  return { ...defaults, ...saved };
}

/**
 * Fetch the verso.layout.json sidecar on workspace open. If the sidecar is empty
 * but localStorage has positions for known views, migrate them into the sidecar
 * and write it back so layouts travel with the workspace in Git from now on.
 */
export async function primeLayoutSidecar(workspaceRoot: string): Promise<void> {
  if (typeof window === 'undefined') return;
  try {
    const raw = (await fetchLayout()) as SidecarShape | null;
    const sidecar: SidecarShape = raw ?? { version: 1, views: {}, nodeStyles: {}, edgeStyles: {} };
    sidecarCache = { rootPath: workspaceRoot, sidecar };

    // First-load migration from localStorage (idempotent).
    const alreadyMigrated = localStorage.getItem(migratedKey(workspaceRoot)) === '1';
    if (!alreadyMigrated) {
      const candidates = ['c4Context', 'moduleMap', 'dependencyGraph', 'engineer'];
      let touched = false;
      sidecar.views = sidecar.views ?? {};
      for (const v of candidates) {
        const stored = localStorage.getItem(key(workspaceRoot, v));
        if (!stored) continue;
        try {
          const positions = JSON.parse(stored) as Record<string, SavedPosition>;
          if (!sidecar.views[v]?.nodes && Object.keys(positions).length > 0) {
            sidecar.views[v] = { ...sidecar.views[v], nodes: positions };
            touched = true;
          }
        } catch { /* ignore corrupt entry */ }
      }
      // Custom views: enumerate localStorage keys for this workspace.
      for (let i = 0; i < localStorage.length; i++) {
        const lsKey = localStorage.key(i);
        if (!lsKey?.startsWith(`${KEY_PREFIX}:${workspaceRoot}:custom:`)) continue;
        const viewKey = lsKey.split(':').slice(2).join(':');
        const stored = localStorage.getItem(lsKey);
        if (!stored) continue;
        try {
          const positions = JSON.parse(stored) as Record<string, SavedPosition>;
          if (!sidecar.views[viewKey]?.nodes && Object.keys(positions).length > 0) {
            sidecar.views[viewKey] = { ...sidecar.views[viewKey], nodes: positions };
            touched = true;
          }
        } catch { /* ignore */ }
      }
      if (touched) {
        await saveLayoutSidecar(sidecar);
      }
      localStorage.setItem(migratedKey(workspaceRoot), '1');
    }
  } catch {
    // Sidecar fetch failed (engine not ready) — fall back to localStorage transparently.
  }
}
