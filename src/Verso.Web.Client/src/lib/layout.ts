import type { ViewKind } from './types';
import { fetchLayout, saveLayoutSidecar } from './api';

export interface SavedPosition { x: number; y: number; }

interface SidecarShape {
  version?: number;
  views?: Record<string, { nodes?: Record<string, SavedPosition>; edges?: Record<string, unknown>; shapes?: unknown[] }>;
  nodeStyles?: Record<string, unknown>;
  edgeStyles?: Record<string, unknown>;
  notes?: Record<string, string>;
  customProps?: Record<string, Record<string, string>>;
  annotations?: Record<string, unknown[]>;
}

/** Top-level pass-through sections of the committed sidecar that the client owns the schema of. */
export type SidecarSection = 'nodeStyles' | 'edgeStyles' | 'notes' | 'customProps' | 'annotations';

function ensureSidecar(rootPath: string): SidecarShape {
  if (!sidecarCache || sidecarCache.rootPath !== rootPath) {
    sidecarCache = { rootPath, sidecar: { version: 1, views: {}, nodeStyles: {}, edgeStyles: {} } };
  }
  return sidecarCache.sidecar;
}

function scheduleSidecarWrite(rootPath: string): void {
  if (pendingWrite?.rootPath === rootPath) clearTimeout(pendingWrite.timer);
  const timer = setTimeout(() => {
    saveLayoutSidecar(sidecarCache!.sidecar).catch(() => { /* best-effort */ });
    pendingWrite = null;
  }, 400);
  pendingWrite = { rootPath, sidecar: ensureSidecar(rootPath), timer };
}

/** Read a whole pass-through section from the primed sidecar (undefined if not primed yet). */
export function sidecarMap<T = unknown>(rootPath: string, section: SidecarSection): Record<string, T> | undefined {
  if (sidecarCache?.rootPath !== rootPath) return undefined;
  return sidecarCache.sidecar[section] as Record<string, T> | undefined;
}

/** Set (or delete, when value is undefined) one entry in a pass-through section and schedule a PUT. */
export function sidecarSet(rootPath: string, section: SidecarSection, key: string, value: unknown): void {
  if (typeof window === 'undefined') return;
  const s = ensureSidecar(rootPath);
  const map = ((s as Record<string, unknown>)[section] as Record<string, unknown> | undefined) ?? {};
  if (value === undefined || value === null) delete map[key];
  else map[key] = value;
  (s as Record<string, unknown>)[section] = map;
  scheduleSidecarWrite(rootPath);
}

/** Per-view free-form canvas shapes (annotations), persisted under views.<key>.shapes. */
export function loadViewShapes<T = unknown>(rootPath: string, viewKey: string): T[] {
  if (sidecarCache?.rootPath !== rootPath) return [];
  return ((sidecarCache.sidecar.views?.[viewKey]?.shapes) as T[] | undefined) ?? [];
}

export function saveViewShapes(rootPath: string, viewKey: string, shapes: unknown[]): void {
  if (typeof window === 'undefined') return;
  const s = ensureSidecar(rootPath);
  s.views = s.views ?? {};
  s.views[viewKey] = { ...s.views[viewKey], shapes };
  scheduleSidecarWrite(rootPath);
}

/** Test seam: inject the shared sidecar cache without going through fetch. */
export function setSidecarCacheForTest(rootPath: string, sidecar: unknown): void {
  sidecarCache = { rootPath, sidecar: sidecar as SidecarShape };
  primedRoot = rootPath;
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
// Workspace the committed sidecar has already been fetched for. Once set, the in-memory cache is
// authoritative for the session and we never re-fetch (re-fetching clobbers unflushed local edits).
let primedRoot: string | null = null;

/** Combine the on-disk sidecar with in-memory edits made before the first fetch resolved. Local
 *  wins per entry, so a position/style changed during load is never lost to the slower disk read. */
function mergeSidecar(server: SidecarShape, local: SidecarShape): SidecarShape {
  const mergeViews = (a: SidecarShape['views'] = {}, b: SidecarShape['views'] = {}) => {
    const out: NonNullable<SidecarShape['views']> = { ...a };
    for (const k of Object.keys(b)) out[k] = { ...a[k], ...b[k] };
    return out;
  };
  return {
    version: local.version ?? server.version ?? 1,
    views: mergeViews(server.views, local.views),
    nodeStyles: { ...server.nodeStyles, ...local.nodeStyles },
    edgeStyles: { ...server.edgeStyles, ...local.edgeStyles },
    notes: { ...server.notes, ...local.notes },
    customProps: { ...server.customProps, ...local.customProps },
    annotations: { ...server.annotations, ...local.annotations },
  };
}

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
 * Read edge waypoints for a given view from the sidecar cache. Returns an empty map if
 * the sidecar isn't primed yet or the view has no edge entries.
 */
export function loadEdgeWaypoints(workspaceRoot: string, view: ViewKind | string): Record<string, SavedPosition[]> {
  if (sidecarCache?.rootPath !== workspaceRoot) return {};
  const v = sidecarCache.sidecar.views?.[view];
  if (!v?.edges) return {};
  const out: Record<string, SavedPosition[]> = {};
  for (const [edgeId, entry] of Object.entries(v.edges)) {
    const e = entry as { waypoints?: SavedPosition[] };
    if (e?.waypoints && e.waypoints.length > 0) out[edgeId] = e.waypoints;
  }
  return out;
}

/**
 * Persist a single edge's waypoints into the sidecar (debounced PUT, parallel to saveLayout).
 */
export function saveEdgeWaypoints(
  workspaceRoot: string,
  view: ViewKind | string,
  edgeId: string,
  waypoints: SavedPosition[]
): void {
  if (typeof window === 'undefined') return;
  if (!sidecarCache || sidecarCache.rootPath !== workspaceRoot) {
    sidecarCache = { rootPath: workspaceRoot, sidecar: { version: 1, views: {}, nodeStyles: {}, edgeStyles: {} } };
  }
  if (!sidecarCache.sidecar.views) sidecarCache.sidecar.views = {};
  const v = sidecarCache.sidecar.views[view] ?? {};
  const edges = v.edges ?? {};
  if (waypoints.length === 0) {
    delete edges[edgeId];
  } else {
    edges[edgeId] = { ...(edges[edgeId] as object | undefined), waypoints };
  }
  sidecarCache.sidecar.views[view] = { ...v, edges };

  if (pendingWrite?.rootPath === workspaceRoot) clearTimeout(pendingWrite.timer);
  const timer = setTimeout(() => {
    saveLayoutSidecar(sidecarCache!.sidecar).catch(() => {});
    pendingWrite = null;
  }, 400);
  pendingWrite = { rootPath: workspaceRoot, sidecar: sidecarCache.sidecar, timer };
}

/** Which connection dot each end of a relationship is anchored to (see lib/edgeDock DockId). */
export interface EdgeHandlePair { source?: string; target?: string; }

/** Read per-edge dock-handle anchors for a view from the primed sidecar. */
export function loadEdgeHandles(workspaceRoot: string, view: ViewKind | string): Record<string, EdgeHandlePair> {
  if (sidecarCache?.rootPath !== workspaceRoot) return {};
  const v = sidecarCache.sidecar.views?.[view];
  if (!v?.edges) return {};
  const out: Record<string, EdgeHandlePair> = {};
  for (const [edgeId, entry] of Object.entries(v.edges)) {
    const h = (entry as { handles?: EdgeHandlePair }).handles;
    if (h && (h.source || h.target)) out[edgeId] = h;
  }
  return out;
}

/** Persist (or clear) one edge's dock-handle anchors, preserving any waypoints on the same entry. */
export function saveEdgeHandles(
  workspaceRoot: string,
  view: ViewKind | string,
  edgeId: string,
  handles: EdgeHandlePair | null
): void {
  if (typeof window === 'undefined') return;
  const s = ensureSidecar(workspaceRoot);
  s.views = s.views ?? {};
  const v = s.views[view] ?? {};
  const edges = v.edges ?? {};
  const prev = (edges[edgeId] as Record<string, unknown> | undefined) ?? {};
  if (!handles || (!handles.source && !handles.target)) {
    const { handles: _omit, ...rest } = prev as { handles?: unknown };
    if (Object.keys(rest).length === 0) delete edges[edgeId];
    else edges[edgeId] = rest;
  } else {
    edges[edgeId] = { ...prev, handles };
  }
  s.views[view] = { ...v, edges };
  scheduleSidecarWrite(workspaceRoot);
}

/**
 * Fetch the verso.layout.json sidecar on workspace open. If the sidecar is empty
 * but localStorage has positions for known views, migrate them into the sidecar
 * and write it back so layouts travel with the workspace in Git from now on.
 */
export async function primeLayoutSidecar(workspaceRoot: string): Promise<void> {
  if (typeof window === 'undefined') return;
  // Fetch the committed sidecar from disk exactly ONCE per workspace. Afterwards the in-memory
  // cache is the session's source of truth — every local edit updates it and debounce-flushes to
  // verso.layout.json. Re-fetching on later refreshes (which fire on every model op AND on the
  // file-watch event our own layout PUT triggers) would overwrite not-yet-flushed edits with stale
  // disk data — the "box jumps back / routing reverts / canvas blinks while editing" bug.
  if (primedRoot === workspaceRoot) return;
  try {
    const raw = (await fetchLayout()) as SidecarShape | null;
    const server: SidecarShape = raw ?? { version: 1, views: {}, nodeStyles: {}, edgeStyles: {} };
    // Preserve any in-memory edits made before this first fetch resolved (local wins).
    const pending = sidecarCache?.rootPath === workspaceRoot ? sidecarCache.sidecar : null;
    const sidecar: SidecarShape = pending ? mergeSidecar(server, pending) : server;
    sidecarCache = { rootPath: workspaceRoot, sidecar };

    // First-load migration from localStorage (idempotent).
    const alreadyMigrated = localStorage.getItem(migratedKey(workspaceRoot)) === '1';
    if (!alreadyMigrated) {
      const candidates = ['moduleMap', 'dependencyGraph'];
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
    // Mark primed only after a successful load so a failed fetch retries on the next call.
    primedRoot = workspaceRoot;
    // Tell the store/canvas to re-hydrate styles/notes/props from the now-loaded committed sidecar.
    window.dispatchEvent(new CustomEvent('verso:sidecar-primed', { detail: { rootPath: workspaceRoot } }));
  } catch {
    // Sidecar fetch failed (engine not ready) — fall back to localStorage transparently; retry next call.
  }
}
