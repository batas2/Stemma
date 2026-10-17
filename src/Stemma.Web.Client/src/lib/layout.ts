import type { ViewKind } from './types';
import { reportFailure, ClientEvent } from './log';
import { fetchLayout, saveLayoutSidecar } from './api';
import { isLayoutConstraint, type LayoutConstraint, type LayoutOffsets } from './layoutDsl';

export interface SavedPosition { x: number; y: number; }

interface SidecarShape {
  version?: number;
  views?: Record<string, { nodes?: Record<string, SavedPosition>; edges?: Record<string, unknown>; shapes?: unknown[]; layoutMode?: string; layout?: unknown; offsets?: Record<string, SavedPosition> }>;
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
    pendingWrite = null;
    // Until the committed sidecar has been read, the cache holds this session's edits and nothing
    // else, and a PUT would replace the whole file with them. Priming writes them, over the file.
    if (!isSidecarPrimed(rootPath)) return;
    saveLayoutSidecar(sidecarCache!.sidecar)
      .catch(reportFailure('Sidecar', ClientEvent.SidecarWriteFailed, 'Writing the layout sidecar'));
  }, 400);
  pendingWrite = { rootPath, sidecar: ensureSidecar(rootPath), timer };
}

/** Whether this session has read the committed sidecar of `rootPath`, and so holds all of it. */
export function isSidecarPrimed(rootPath: string): boolean {
  return primedRoot === rootPath && sidecarCache?.rootPath === rootPath;
}

/** Read a whole pass-through section from the primed sidecar (undefined if not primed yet). */
export function sidecarMap<T = unknown>(rootPath: string, section: SidecarSection): Record<string, T> | undefined {
  if (!isSidecarPrimed(rootPath)) return undefined;
  return sidecarCache!.sidecar[section] as Record<string, T> | undefined;
}

/**
 * A pass-through section as the canvas should draw it. Once the committed sidecar has been read it
 * is the whole answer, and the browser's copy under `cacheKey` is overwritten with it; until then,
 * that copy is all there is. The two are never merged: an entry only the browser has is one the
 * repository no longer has — a teammate removed it, a checkout went back past it — and merging it
 * in drew it again on every open (B-012).
 */
export function cachedSection<T>(rootPath: string, section: SidecarSection, cacheKey: string): Record<string, T> {
  if (typeof window === 'undefined') return {};
  if (isSidecarPrimed(rootPath)) {
    const committed = { ...sidecarMap<T>(rootPath, section) };
    try { localStorage.setItem(cacheKey, JSON.stringify(committed)); } catch { /* ignore */ }
    return committed;
  }
  try { const raw = localStorage.getItem(cacheKey); return raw ? JSON.parse(raw) : {}; } catch { return {}; }
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

/**
 * Per-view layout mode, committed rather than kept in the browser.
 *
 * This decides whether the positions stored beside it are authoritative or are about to be
 * overwritten by an auto-layout on open — so a workspace that did not carry it drew differently on
 * a fresh clone than on the machine it was authored on. It is presentation and it must travel with
 * the model, which means the sidecar, not `localStorage`.
 */
export function loadViewLayoutModes(rootPath: string): Record<string, string> {
  if (sidecarCache?.rootPath !== rootPath) return {};
  const out: Record<string, string> = {};
  for (const [key, view] of Object.entries(sidecarCache.sidecar.views ?? {})) {
    if (view?.layoutMode) out[key] = view.layoutMode;
  }
  return out;
}

export function saveViewLayoutMode(rootPath: string, viewKey: string, mode: string): void {
  if (typeof window === 'undefined') return;
  const s = ensureSidecar(rootPath);
  s.views = s.views ?? {};
  s.views[viewKey] = { ...s.views[viewKey], layoutMode: mode };
  scheduleSidecarWrite(rootPath);
}

/**
 * The layout constraint governing a view, if it has one.
 *
 * Stored beside the positions rather than instead of them: a constraint may govern part of a
 * diagram, and the nodes it does not mention keep their absolute positions.
 */
export function loadViewConstraint(rootPath: string, viewKey: string): LayoutConstraint | null {
  if (sidecarCache?.rootPath !== rootPath) return null;
  const raw = sidecarCache.sidecar.views?.[viewKey]?.layout;
  return isLayoutConstraint(raw) ? raw : null;
}

export function saveViewConstraint(rootPath: string, viewKey: string, constraint: LayoutConstraint | null): void {
  if (typeof window === 'undefined') return;
  const s = ensureSidecar(rootPath);
  s.views = s.views ?? {};
  const view = { ...s.views[viewKey] };
  if (constraint) view.layout = constraint; else delete view.layout;
  s.views[viewKey] = view;
  scheduleSidecarWrite(rootPath);
}

/** Per-node nudges against the solved constraint. Empty when the view has no constraint. */
export function loadViewOffsets(rootPath: string, viewKey: string): LayoutOffsets {
  if (sidecarCache?.rootPath !== rootPath) return {};
  return sidecarCache.sidecar.views?.[viewKey]?.offsets ?? {};
}

export function saveViewOffset(rootPath: string, viewKey: string, nodeId: string, offset: SavedPosition | null): void {
  if (typeof window === 'undefined') return;
  const s = ensureSidecar(rootPath);
  s.views = s.views ?? {};
  const view = { ...s.views[viewKey] };
  const offsets = { ...(view.offsets ?? {}) };
  // A nudge of zero is the absence of a nudge; keeping it would grow the file for nothing.
  if (!offset || (offset.x === 0 && offset.y === 0)) delete offsets[nodeId];
  else offsets[nodeId] = offset;
  view.offsets = offsets;
  s.views[viewKey] = view;
  scheduleSidecarWrite(rootPath);
}

/** Drop every nudge on a view, returning it to the pure solved arrangement. */
export function clearViewOffsets(rootPath: string, viewKey: string): void {
  if (typeof window === 'undefined') return;
  const s = ensureSidecar(rootPath);
  s.views = s.views ?? {};
  s.views[viewKey] = { ...s.views[viewKey], offsets: {} };
  scheduleSidecarWrite(rootPath);
}

/** Test seam: inject the shared sidecar cache without going through fetch. */
export function setSidecarCacheForTest(rootPath: string, sidecar: unknown): void {
  sidecarCache = { rootPath, sidecar: sidecar as SidecarShape };
  primedRoot = rootPath;
}

const KEY_PREFIX = 'stemma.layout';
const MIGRATED_KEY_PREFIX = 'stemma.layout.migrated';

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
  // Once read, the sidecar is the whole answer: a view it has no positions for is laid out afresh,
  // not from what this browser remembers of it (B-012).
  if (isSidecarPrimed(workspaceRoot)) {
    const nodes = sidecarCache!.sidecar.views?.[view]?.nodes;
    try {
      if (nodes) localStorage.setItem(key(workspaceRoot, view), JSON.stringify(nodes));
      else localStorage.removeItem(key(workspaceRoot, view));
    } catch { /* ignore */ }
    return nodes ?? {};
  }
  // Before that: what was moved during the load, then what this browser remembers.
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

  // Update in-memory cache, and a debounced PUT to stemma.layout.json.
  const s = ensureSidecar(workspaceRoot);
  s.views = s.views ?? {};
  s.views[view] = { ...s.views[view], nodes: positions };
  scheduleSidecarWrite(workspaceRoot);
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
  const s = ensureSidecar(workspaceRoot);
  s.views = s.views ?? {};
  const v = s.views[view] ?? {};
  const edges = v.edges ?? {};
  if (waypoints.length === 0) {
    delete edges[edgeId];
  } else {
    edges[edgeId] = { ...(edges[edgeId] as object | undefined), waypoints };
  }
  s.views[view] = { ...v, edges };
  scheduleSidecarWrite(workspaceRoot);
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
 * Fetch the stemma.layout.json sidecar on workspace open. If the sidecar is empty
 * but localStorage has positions for known views, migrate them into the sidecar
 * and write it back so layouts travel with the workspace in Git from now on.
 */
export async function primeLayoutSidecar(workspaceRoot: string): Promise<void> {
  if (typeof window === 'undefined') return;
  // Fetch the committed sidecar from disk exactly ONCE per workspace. Afterwards the in-memory
  // cache is the session's source of truth — every local edit updates it and debounce-flushes to
  // stemma.layout.json. Re-fetching on later refreshes (which fire on every model op AND on the
  // file-watch event our own layout PUT triggers) would overwrite not-yet-flushed edits with stale
  // disk data — the "box jumps back / routing reverts / canvas blinks while editing" bug.
  if (primedRoot === workspaceRoot) return;
  try {
    const raw = (await fetchLayout()) as SidecarShape | null;
    // No workspace open on the server: nothing has been read, so nothing may be written. Treating
    // it as an empty sidecar would let the next edit replace the real one with that edit alone.
    if (raw === null) return;
    // Opening primes from two places at once. Whichever read lands second finds the cache already
    // read — not edits held back while it loaded — and must leave it alone rather than write it.
    if (primedRoot === workspaceRoot) return;
    // Preserve any in-memory edits made before this first fetch resolved (local wins).
    const pending = sidecarCache?.rootPath === workspaceRoot ? sidecarCache.sidecar : null;
    const sidecar: SidecarShape = pending ? mergeSidecar(raw, pending) : raw;
    sidecarCache = { rootPath: workspaceRoot, sidecar };
    // Marked only after a successful read, so a failed fetch retries on the next call. From here on
    // the session holds the whole sidecar, and may write it.
    primedRoot = workspaceRoot;

    // First-load migration from localStorage (idempotent).
    let touched = false;
    const alreadyMigrated = localStorage.getItem(migratedKey(workspaceRoot)) === '1';
    if (!alreadyMigrated) {
      const candidates = ['moduleMap', 'dependencyGraph'];
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
      localStorage.setItem(migratedKey(workspaceRoot), '1');
    }
    // Edits made while it loaded were held back (see scheduleSidecarWrite); they go out with the
    // migration, over what the file had.
    if (touched || pending) {
      saveLayoutSidecar(sidecar).catch(reportFailure('Sidecar', ClientEvent.SidecarWriteFailed, 'Writing the layout sidecar'));
    }
    // Tell the store/canvas to re-hydrate styles/notes/props from the now-loaded committed sidecar.
    window.dispatchEvent(new CustomEvent('stemma:sidecar-primed', { detail: { rootPath: workspaceRoot } }));
  } catch {
    // Sidecar fetch failed (engine not ready) — fall back to localStorage transparently; retry next call.
  }
}
