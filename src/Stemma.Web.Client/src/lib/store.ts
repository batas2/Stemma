import { create } from 'zustand';
import { reportFailure, ClientEvent } from './log';
import type { ArchModel, CustomView, ViewKind, Violation, WorkspaceModel } from './types';
import { loadViews, saveViews, loadActiveView, saveActiveView, loadOpenViews, saveOpenViews } from './views';
import { loadEdgeStyles, setEdgeStyle, type EdgeStyle } from './edgeStyles';
import { loadNodeStyles, setNodeStyle, type NodeStyle } from './nodeStyles';
import {
  loadCustomProps, setCustomProp as setCP, removeCustomProp as rmCP,
  renameCustomProp as renameCP, type CustomProps,
} from './customProps';
import { saveServerView, deleteServerView, listServerViews, type ServerView } from './api';
import { editBooksSection, editViewHeader, isSidecarPrimed, loadBooksSection, loadViewEntries, loadViewLayoutModes, saveViewLayoutMode } from './layout';
import { readViewHeaders, type HeaderField, type ViewHeaderSpec } from './viewHeader';
import {
  addBook as addBookTo, addPage, duplicatePage, movePage, newBookId, newPageId, readBooks,
  removeBook as removeBookFrom, removePage, renameBook as renameBookIn, setBookAudience as setAudienceIn,
  updatePage, type Book, type BookPage, type BooksSection, type PagePatch,
} from './books';
import { friendlyOpError } from './opError';
import { history } from './history';
import type { Shape, ShapeKind } from './shapes';

/** What the canvas pointer is doing right now. `select` is the default (drag/select model nodes). */
export type CanvasMode =
  | { kind: 'select' }
  | { kind: 'shape'; tool: ShapeKind };

export type Theme = 'dark' | 'light';

/** Tunable knobs for the force-directed ("organic") auto-layout. */
export interface ForceParams {
  gravity: number;      // pull toward the centre — higher packs the graph tighter
  clusterPull: number;  // extra pull between same-Bounded-Context nodes
  spacing: number;      // multiplies the ideal node distance (k) — higher spreads nodes out
  iterations: number;   // simulation steps — higher settles more but costs time
}

export const DEFAULT_FORCE_PARAMS: ForceParams = { gravity: 0.06, clusterPull: 0.022, spacing: 1, iterations: 320 };

/** Knobs for the hierarchical (layered) auto-layout. */
export interface HierParams { colGap: number; rowGap: number; }
export const DEFAULT_HIER_PARAMS: HierParams = { colGap: 240, rowGap: 170 };

/** Knobs for the architectural ("by type") auto-layout. */
export interface ByTypeParams { gap: number; groupGap: number; rowGap: number; }
export const DEFAULT_BYTYPE_PARAMS: ByTypeParams = { gap: 40, groupGap: 100, rowGap: 120 };

/** A view's layout mode: an auto algorithm that re-applies live, or 'custom' (manual positions).
 *  Manually moving or adding a node flips an auto view to 'custom' so it stops re-arranging. */
export type LayoutMode = 'custom' | 'force' | 'hierarchical' | 'byType';

function viewLayoutsKey(root: string): string { return `stemma.viewLayouts:${root}`; }
function viewLayoutsMigratedKey(root: string): string { return `stemma.viewLayouts.migrated:${root}`; }
/**
 * Layout modes for a workspace. The committed sidecar is the source of truth once it has been read;
 * until then, the localStorage copy is drawn. That copy is also where modes lived before they were
 * committed, so the first time a workspace's sidecar is read, a mode only the browser has is moved
 * into it — once. After that, a mode the sidecar lacks was taken out of it, and moving it up on
 * every read put this browser's memory back over the file each time it was opened (B-012).
 */
function loadViewLayouts(root: string): Record<string, LayoutMode> {
  if (typeof window === 'undefined') return {};
  let cached: Record<string, LayoutMode> = {};
  try { const raw = localStorage.getItem(viewLayoutsKey(root)); cached = raw ? JSON.parse(raw) : {}; } catch { /* ignore */ }
  if (!isSidecarPrimed(root)) return cached;

  const committed = loadViewLayoutModes(root) as Record<string, LayoutMode>;
  let modes = committed;
  if (localStorage.getItem(viewLayoutsMigratedKey(root)) !== '1') {
    modes = { ...cached, ...committed };
    for (const [key, mode] of Object.entries(modes)) {
      if (committed[key] !== mode) saveViewLayoutMode(root, key, mode);
    }
    try { localStorage.setItem(viewLayoutsMigratedKey(root), '1'); } catch { /* ignore */ }
  }
  try { localStorage.setItem(viewLayoutsKey(root), JSON.stringify(modes)); } catch { /* ignore */ }
  return modes;
}

/**
 * View saves and deletes the engine has not answered yet, by view id (`view: null` for a delete).
 * The list of views is what Views/*.cs declares, read again on every refresh; until the engine has
 * written a change, that list does not have it, and the view would vanish and come back.
 */
const viewsInFlight = new Map<string, { root: string; view: CustomView | null }>();

/** The list the canvas shows: the code's, with what is still on its way laid over it. */
function viewsFromCode(root: string, fromCode: ServerView[], known: CustomView[]): CustomView[] {
  const createdAt = new Map(known.map((v) => [v.id, v.createdAt]));
  const views: CustomView[] = fromCode.map((s) => ({
    id: s.id, name: s.name, baseView: s.baseView as CustomView['baseView'], elementIds: s.elementIds,
    createdAt: createdAt.get(s.id) ?? new Date().toISOString(),
  }));
  for (const [id, pending] of viewsInFlight) {
    if (pending.root !== root) continue;
    const at = views.findIndex((v) => v.id === id);
    if (pending.view === null) { if (at >= 0) views.splice(at, 1); }
    else if (at >= 0) views[at] = pending.view;
    else views.push(pending.view);
  }
  return views;
}
function saveViewLayouts(root: string, m: Record<string, LayoutMode>, changedKey?: string): void {
  if (typeof window === 'undefined') return;
  // localStorage stays as a fast local cache; the sidecar is what ships.
  try { localStorage.setItem(viewLayoutsKey(root), JSON.stringify(m)); } catch { /* ignore */ }
  if (changedKey) saveViewLayoutMode(root, changedKey, m[changedKey]);
  else for (const [k, v] of Object.entries(m)) saveViewLayoutMode(root, k, v);
}

const THEME_KEY = 'stemma.theme';
function initialTheme(): Theme {
  if (typeof window === 'undefined') return 'dark';
  const saved = localStorage.getItem(THEME_KEY) as Theme | null;
  if (saved === 'dark' || saved === 'light') return saved;
  return window.matchMedia?.('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

interface AppState {
  workspace: WorkspaceModel | null;
  arch: ArchModel | null;
  view: ViewKind;
  customViews: CustomView[];
  activeCustomViewId: string | null;
  // Saved views currently open as bottom tabs (built-ins are always present, not listed here).
  openViewIds: string[];
  sidebarOpen: boolean;
  /** Which inspector panel the right-hand icon rail has open (e.g. 'element.appearance',
   *  'link.appearance', 'layout'), or null when the rail is collapsed to icons only. */
  inspectorTab: string | null;
  /** The element-domain / link-domain tab the user last picked from the rail — restored when the
   *  selection crosses domains so the user's choice survives canvas clicks. */
  lastElementTab: string;
  lastLinkTab: string;
  /** Tunable layout parameters per algorithm, editable from the Layout panel. */
  forceParams: ForceParams;
  hierParams: HierParams;
  byTypeParams: ByTypeParams;
  /** The chosen layout mode per view key (e.g. 'moduleMap', 'custom:cv_1'). Missing = 'custom'. */
  viewLayouts: Record<string, LayoutMode>;
  /** How many canvas nodes are currently multi-selected (published by ArchCanvas for the Layout
   *  panel, which lives outside the canvas tree and can't see React Flow's selection). */
  canvasSelection: number;
  /** Ids of the multi-selected canvas nodes, in selection order. The Layout panel builds a
   *  constraint out of these; the count alone was enough only for align/distribute. */
  canvasSelectedIds: string[];
  theme: Theme;
  loading: boolean;
  selectedElementId: string | null;
  selectedLinkId: string | null;
  /** In-progress edit of a relationship's payload/kind, shared keystroke-by-keystroke between the
   *  canvas inline editor and the inspector so both surfaces stay in sync while typing. */
  /** `field` is whichever attribute carries this kind's label — see lib/linkLabel. */
  linkDraft: { linkId: string; field: 'payload' | 'kind' | 'label'; value: string } | null;
  edgeStyles: Record<string, EdgeStyle>;
  nodeStyles: Record<string, NodeStyle>;
  customProps: Record<string, CustomProps>;
  violations: Violation[];
  violationsOpen: boolean;
  snapEnabled: boolean;
  toast: { kind: 'info' | 'error' | 'success'; text: string } | null;
  paletteOpen: boolean;
  // Shape support on custom views.
  canvasMode: CanvasMode;
  shapes: Record<string, Shape[]>;       // keyed by viewKey, e.g. "custom:cv_q4"
  selectedShapeId: string | null;
  // Dependencies-view architect UX.
  depFocusMode: boolean;
  depKindFilter: Set<string> | null;     // null = all kinds, otherwise the allow-list
  depDepth: number;                      // 1 = direct deps; 2 = transitive 2-hop; etc.
  // Collapsed Bounded Contexts (session-only): their child modules are hidden on the canvas.
  collapsedBcs: Set<string>;
  // Books (F-013) — read from the sidecar's `books` section, and edited back into it.
  books: Book[];
  /** The book open in the editor, or being presented. */
  activeBookId: string | null;
  activePageId: string | null;
  /** A book is on screen with no chrome around it, the canvas read-only, and keys turning pages. */
  presenting: boolean;
  /** Pages are framed at once rather than animated: the PDF export is walking through them. */
  capturing: boolean;
  /** Each view's header (F-014), keyed by view key; read from the sidecar and edited back into it. */
  viewHeaders: Record<string, ViewHeaderSpec>;
  setWorkspace: (ws: WorkspaceModel | null) => void;
  rehydratePresentation: () => void;
  /** Give a view a header, if it has none. False, and nothing changed, until the sidecar has been read. */
  addViewHeader: (viewKey: string) => boolean;
  /** Take a view's header away. */
  removeViewHeader: (viewKey: string) => boolean;
  /** Set one field of a view's header; blank text removes the field. Every other key is left as it is. */
  setViewHeaderField: (viewKey: string, field: HeaderField, value: string) => boolean;
  /** Re-read the views from Views/*.cs; the list in the browser is only a cache of it (B-012). */
  syncViews: () => Promise<void>;
  setArch: (a: ArchModel | null) => void;
  setView: (v: ViewKind) => void;
  setCustomViews: (vs: CustomView[]) => void;
  upsertCustomView: (v: CustomView) => void;
  removeCustomView: (id: string) => void;
  setActiveCustomView: (id: string | null) => void;
  openCustomView: (id: string) => void;
  closeCustomView: (id: string) => void;
  addElementToActiveView: (elementId: string) => void;
  /** Several at once — a paste — written to the view's file in one save. */
  addElementsToActiveView: (elementIds: string[]) => void;
  removeElementFromActiveView: (elementId: string) => void;
  setSidebarOpen: (b: boolean) => void;
  setInspectorTab: (id: string | null) => void;
  setForceParams: (p: Partial<ForceParams>) => void;
  resetForceParams: () => void;
  setHierParams: (p: Partial<HierParams>) => void;
  resetHierParams: () => void;
  setByTypeParams: (p: Partial<ByTypeParams>) => void;
  resetByTypeParams: () => void;
  setViewLayout: (viewKey: string, mode: LayoutMode) => void;
  setCanvasSelection: (n: number, ids?: string[]) => void;
  setTheme: (t: Theme) => void;
  toggleTheme: () => void;
  setLoading: (b: boolean) => void;
  selectElement: (id: string | null) => void;
  selectLink: (id: string | null) => void;
  setLinkDraft: (d: AppState['linkDraft']) => void;
  setEdgeStyleFor: (linkId: string, style: EdgeStyle) => void;
  setNodeStyleFor: (nodeId: string, style: NodeStyle) => void;
  setCustomProp: (nodeId: string, key: string, value: string) => void;
  removeCustomProp: (nodeId: string, key: string) => void;
  renameCustomProp: (nodeId: string, oldKey: string, newKey: string) => void;
  setViolations: (v: Violation[]) => void;
  setViolationsOpen: (b: boolean) => void;
  toggleSnap: () => void;
  setToast: (t: AppState['toast']) => void;
  setPaletteOpen: (b: boolean) => void;
  setCanvasMode: (m: CanvasMode) => void;
  setShapesFor: (viewKey: string, shapes: Shape[]) => void;
  selectShape: (id: string | null) => void;
  setDepFocusMode: (b: boolean) => void;
  setDepKindFilter: (k: Set<string> | null) => void;
  setDepDepth: (n: number) => void;
  toggleBcCollapsed: (id: string) => void;
  /** Read the books again from the sidecar — on open, and after anyone else changed the file. */
  reloadBooks: () => void;
  /** Create a book and open it; null when the sidecar cannot be written. */
  createBook: (name: string) => string | null;
  renameBook: (id: string, name: string) => void;
  setBookAudience: (id: string, audience: string | null) => void;
  deleteBook: (id: string) => void;
  /** Add a page showing the current view, pointing at the current selection; returns its id. */
  addPageFromCanvas: (bookId: string) => string | null;
  updateBookPage: (bookId: string, pageId: string, patch: PagePatch) => void;
  removeBookPage: (bookId: string, pageId: string) => void;
  moveBookPage: (bookId: string, from: number, to: number) => void;
  duplicateBookPage: (bookId: string, pageId: string) => void;
  openBook: (id: string | null) => void;
  /** Make a page of the open book the current one, and put its view on the canvas. */
  showPage: (pageId: string) => void;
  stepPage: (delta: 1 | -1) => void;
  edgePage: (which: 'first' | 'last') => void;
  startPresenting: (bookId: string, pageId?: string) => void;
  stopPresenting: () => void;
  setCapturing: (b: boolean) => void;
}

/** "Resize" when only the size changed — what dragging a box's corner does — and "Change appearance" otherwise. */
function describeStyleChange(before: NodeStyle | undefined, after: NodeStyle): string {
  const strip = (s: NodeStyle | undefined) => {
    if (!s) return '';
    const { width: _w, height: _h, ...rest } = s;
    return JSON.stringify(rest);
  };
  const sized = before?.width !== after.width || before?.height !== after.height;
  return sized && strip(before ?? { ...after, width: undefined, height: undefined }) === strip(after) ? 'Resize' : 'Change appearance';
}

/** The book open in the editor or the presenter, if any. */
export function activeBook(s: Pick<AppState, 'books' | 'activeBookId'>): Book | null {
  return s.books.find((b) => b.id === s.activeBookId) ?? null;
}

/** The page on screen, if a book is open and has one. */
export function activePage(s: Pick<AppState, 'books' | 'activeBookId' | 'activePageId'>): BookPage | null {
  return activeBook(s)?.pages.find((p) => p.id === s.activePageId) ?? null;
}

/**
 * The id a page would name for what the canvas shows now: the open view from `Views/`, or the
 * built-in canvas. Null on Concerns, which is a summary rather than a diagram, so has nothing to frame.
 */
export function currentViewId(s: Pick<AppState, 'view' | 'activeCustomViewId'>): string | null {
  if (s.view === 'concerns') return null;
  return s.activeCustomViewId ?? s.view;
}

/** The view ids a page may name: the two built-in canvases and every view in `Views/`. */
export function pageViewIds(s: Pick<AppState, 'customViews'>): Set<string> {
  return new Set(['moduleMap', 'dependencyGraph', ...s.customViews.map((v) => v.id)]);
}

/**
 * Edit the sidecar's books and read them back. Refused out loud when the file has not been read or
 * cannot be: an edit that silently went nowhere is the failure books had before (F-013).
 */
/** Edit a view's header as the file holds it, then read every header back for the canvas to draw. */
function editHeader(
  get: () => AppState,
  set: (partial: Partial<AppState>) => void,
  viewKey: string,
  edit: (header: Record<string, unknown> | null) => Record<string, unknown> | null,
): boolean {
  const root = get().workspace?.rootPath;
  if (!root || !editViewHeader(root, viewKey, edit)) return false;
  set({ viewHeaders: readViewHeaders(loadViewEntries(root)) });
  return true;
}

function editBooks(get: () => AppState, edit: (books: BooksSection) => void): boolean {
  const root = get().workspace?.rootPath;
  if (!root || !editBooksSection(root, edit)) {
    get().setToast({
      kind: 'error',
      text: root && isSidecarPrimed(root)
        ? "Books can't be changed: `books` in stemma.layout.json is not an object. Fix it by hand, then try again."
        : "Books can't be changed until stemma.layout.json has been read.",
    });
    return false;
  }
  get().reloadBooks();
  return true;
}

/**
 * Write a view to Views/*.cs (or delete it, for `null`). The list already shows the change; once
 * the engine answers, it is read again from the code, so a refused or lost write is put back as the
 * code has it rather than left looking saved — and the refusal is said, not just logged.
 */
function sendView(get: () => AppState, id: string, view: CustomView | null): void {
  const root = get().workspace?.rootPath;
  if (!root) return;
  const pending = { root, view };
  viewsInFlight.set(id, pending);
  const request = view
    ? saveServerView({ id: view.id, name: view.name, baseView: view.baseView, elementIds: view.elementIds })
    : deleteServerView(id);
  request
    .then((refused) => { if (refused) get().setToast({ kind: 'error', text: friendlyOpError(refused) }); })
    .catch((error) => {
      reportFailure('Views', ClientEvent.RequestFailed, view ? 'Saving the view' : 'Deleting the view')(error);
      get().setToast({ kind: 'error', text: view ? "The view couldn't be saved." : "The view couldn't be deleted." });
    })
    .finally(() => {
      if (viewsInFlight.get(id) === pending) viewsInFlight.delete(id);
      void get().syncViews();
    });
}

export const useApp = create<AppState>((set, get) => ({
  workspace: null,
  arch: null,
  view: 'moduleMap',
  customViews: [],
  activeCustomViewId: null,
  openViewIds: [],
  sidebarOpen: true,
  inspectorTab: null,
  lastElementTab: 'element.properties',
  lastLinkTab: 'link.properties',
  forceParams: { ...DEFAULT_FORCE_PARAMS },
  hierParams: { ...DEFAULT_HIER_PARAMS },
  byTypeParams: { ...DEFAULT_BYTYPE_PARAMS },
  viewLayouts: {},
  canvasSelection: 0,
  canvasSelectedIds: [],
  theme: initialTheme(),
  loading: false,
  selectedElementId: null,
  selectedLinkId: null,
  linkDraft: null,
  edgeStyles: {},
  nodeStyles: {},
  customProps: {},
  violations: [],
  violationsOpen: false,
  snapEnabled: typeof window !== 'undefined' && localStorage.getItem('stemma.snap') === '1',
  toast: null,
  paletteOpen: false,
  canvasMode: { kind: 'select' },
  shapes: {},
  selectedShapeId: null,
  depFocusMode: false,
  depKindFilter: null as Set<string> | null,
  depDepth: 1,
  collapsedBcs: new Set<string>(),
  books: [],
  activeBookId: null,
  activePageId: null,
  presenting: false,
  capturing: false,
  viewHeaders: {},
  setWorkspace: (ws) => {
    // Hydrate from localStorage only on first open of a given rootPath. Subsequent refresh()s
    // during the same session should NOT reset activeCustomViewId / selection — the user's
    // in-memory choices win over stale localStorage.
    const previous = get().workspace;
    set({ workspace: ws });
    if (!ws) {
      set({ customViews: [], activeCustomViewId: null, openViewIds: [], edgeStyles: {}, nodeStyles: {}, customProps: {}, collapsedBcs: new Set(), viewLayouts: {}, books: [], activeBookId: null, activePageId: null, presenting: false, viewHeaders: {} });
      return;
    }
    if (previous?.rootPath === ws.rootPath) return;
    // Another workspace's books and headers are not this one's; they arrive with its sidecar.
    set({ books: [], activeBookId: null, activePageId: null, presenting: false, viewHeaders: {} });
    const views = loadViews(ws.rootPath);
    const active = loadActiveView(ws.rootPath);
    const persistedOpen = loadOpenViews(ws.rootPath);
    // First open of a workspace: start with only the previously-active view as a tab (built-ins
    // are always shown). Closing a tab never deletes the view — it stays in the Sidebar list.
    let openIds = (persistedOpen ?? (active ? [active] : [])).filter((id) => views.some((v) => v.id === id));
    if (active && !openIds.includes(active)) openIds = [...openIds, active];
    const eStyles = loadEdgeStyles(ws.rootPath);
    const nStyles = loadNodeStyles(ws.rootPath);
    const cProps = loadCustomProps(ws.rootPath);
    set({ customViews: views, activeCustomViewId: active, openViewIds: openIds, edgeStyles: eStyles, nodeStyles: nStyles, customProps: cProps, collapsedBcs: new Set(), viewLayouts: loadViewLayouts(ws.rootPath) });
    void get().syncViews();
  },
  syncViews: async () => {
    const ws = get().workspace;
    if (!ws) return;
    let fromCode: ServerView[];
    try { fromCode = await listServerViews(); }
    catch (error) { reportFailure('Views', ClientEvent.RequestFailed, 'Reading the views')(error); return; }
    if (get().workspace?.rootPath !== ws.rootPath) return;

    const views = viewsFromCode(ws.rootPath, fromCode, get().customViews);
    const ids = new Set(views.map((v) => v.id));
    const openViewIds = get().openViewIds.filter((id) => ids.has(id));
    const active = get().activeCustomViewId;
    const stillActive = active !== null && ids.has(active);
    set({ customViews: views, openViewIds, ...(stillActive ? {} : { activeCustomViewId: null }) });
    saveViews(ws.rootPath, views);
    saveOpenViews(ws.rootPath, openViewIds);
    if (active !== null && !stillActive) saveActiveView(ws.rootPath, null);
  },
  // Re-read styles/custom-props from the committed sidecar once it finishes loading
  // (the localStorage values loaded synchronously on open are then superseded by the repo copy).
  rehydratePresentation: () => {
    const ws = get().workspace;
    if (!ws) return;
    set({
      nodeStyles: loadNodeStyles(ws.rootPath),
      edgeStyles: loadEdgeStyles(ws.rootPath),
      customProps: loadCustomProps(ws.rootPath),
      viewLayouts: loadViewLayouts(ws.rootPath),
      viewHeaders: readViewHeaders(loadViewEntries(ws.rootPath)),
    });
  },
  addViewHeader: (viewKey) => editHeader(get, set, viewKey, (h) => h ?? {}),
  removeViewHeader: (viewKey) => editHeader(get, set, viewKey, () => null),
  setViewHeaderField: (viewKey, field, value) => editHeader(get, set, viewKey, (h) => {
    const next = { ...(h ?? {}) };
    if (value.trim() === '') delete next[field]; else next[field] = value;
    return next;
  }),
  setArch: (a) => set({ arch: a }),
  // Switch to a built-in view. A custom view keeps `view` at its base (e.g. 'moduleMap') while
  // activeCustomViewId is set, so guarding on `view` alone made clicking "Module Map" a silent
  // no-op whenever a custom view was layered on top (incl. the persisted one restored on open) —
  // that's the "can't get back to Module Map until I toggle another tab / refresh" bug. Only skip
  // when we're genuinely already on that built-in with no custom view active.
  setView: (v) => {
    const s = get();
    if (v === s.view && s.activeCustomViewId === null) return;
    set({ view: v, activeCustomViewId: null, selectedElementId: null });
  },
  setCustomViews: (vs) => {
    set({ customViews: vs });
    const ws = get().workspace;
    if (ws) saveViews(ws.rootPath, vs);
  },
  upsertCustomView: (v) => {
    const current = get().customViews;
    const idx = current.findIndex((x) => x.id === v.id);
    const next = idx >= 0 ? current.map((x) => x.id === v.id ? v : x) : [...current, v];
    set({ customViews: next });
    const ws = get().workspace;
    if (ws) saveViews(ws.rootPath, next);
    sendView(get, v.id, v);
  },
  removeCustomView: (id) => {
    const next = get().customViews.filter((v) => v.id !== id);
    const nextOpen = get().openViewIds.filter((x) => x !== id);
    const wasActive = get().activeCustomViewId === id;
    set({ customViews: next, openViewIds: nextOpen, ...(wasActive ? { activeCustomViewId: null } : {}) });
    const ws = get().workspace;
    if (ws) {
      saveViews(ws.rootPath, next);
      saveOpenViews(ws.rootPath, nextOpen);
      if (wasActive) saveActiveView(ws.rootPath, null);
    }
    sendView(get, id, null);
  },
  setActiveCustomView: (id) => {
    // Activating a saved view also opens it as a bottom tab (closing later only hides the tab).
    const open = id && !get().openViewIds.includes(id) ? [...get().openViewIds, id] : get().openViewIds;
    set({ activeCustomViewId: id, selectedElementId: null, openViewIds: open });
    const ws = get().workspace;
    if (ws) {
      saveActiveView(ws.rootPath, id);
      saveOpenViews(ws.rootPath, open);
    }
  },
  openCustomView: (id) => get().setActiveCustomView(id),
  closeCustomView: (id) => {
    // Close the tab only — the view itself is untouched and stays in the Sidebar list.
    const nextOpen = get().openViewIds.filter((x) => x !== id);
    const wasActive = get().activeCustomViewId === id;
    set({ openViewIds: nextOpen, ...(wasActive ? { activeCustomViewId: null, view: 'moduleMap', selectedElementId: null } : {}) });
    const ws = get().workspace;
    if (ws) {
      saveOpenViews(ws.rootPath, nextOpen);
      if (wasActive) saveActiveView(ws.rootPath, null);
    }
  },
  addElementToActiveView: (elementId) => {
    const { activeCustomViewId, customViews, workspace } = get();
    if (!activeCustomViewId) return;
    const next = customViews.map((v) =>
      v.id === activeCustomViewId && !v.elementIds.includes(elementId)
        ? { ...v, elementIds: [...v.elementIds, elementId] }
        : v
    );
    set({ customViews: next });
    if (workspace) saveViews(workspace.rootPath, next);
    const updated = next.find((v) => v.id === activeCustomViewId);
    if (updated) sendView(get, updated.id, updated);
  },
  addElementsToActiveView: (elementIds) => {
    const { activeCustomViewId, customViews, workspace } = get();
    if (!activeCustomViewId) return;
    const view = customViews.find((v) => v.id === activeCustomViewId);
    const fresh = elementIds.filter((id) => !view?.elementIds.includes(id));
    if (!view || fresh.length === 0) return;
    const updated = { ...view, elementIds: [...view.elementIds, ...fresh] };
    const next = customViews.map((v) => (v.id === activeCustomViewId ? updated : v));
    set({ customViews: next });
    if (workspace) saveViews(workspace.rootPath, next);
    sendView(get, updated.id, updated);
  },
  removeElementFromActiveView: (elementId) => {
    const { activeCustomViewId, customViews, workspace } = get();
    if (!activeCustomViewId) return;
    const next = customViews.map((v) =>
      v.id === activeCustomViewId
        ? { ...v, elementIds: v.elementIds.filter((id) => id !== elementId) }
        : v
    );
    set({ customViews: next });
    if (workspace) saveViews(workspace.rootPath, next);
    const updated = next.find((v) => v.id === activeCustomViewId);
    if (updated) sendView(get, updated.id, updated);
  },
  setSidebarOpen: (b) => set({ sidebarOpen: b }),
  // Remember the user's explicit panel choice per domain so selection changes restore it.
  setInspectorTab: (id) => set((s) => ({
    inspectorTab: id,
    lastElementTab: id?.startsWith('element.') ? id : s.lastElementTab,
    lastLinkTab: id?.startsWith('link.') ? id : s.lastLinkTab,
  })),
  setForceParams: (p) => set((s) => ({ forceParams: { ...s.forceParams, ...p } })),
  resetForceParams: () => set({ forceParams: { ...DEFAULT_FORCE_PARAMS } }),
  setHierParams: (p) => set((s) => ({ hierParams: { ...s.hierParams, ...p } })),
  resetHierParams: () => set({ hierParams: { ...DEFAULT_HIER_PARAMS } }),
  setByTypeParams: (p) => set((s) => ({ byTypeParams: { ...s.byTypeParams, ...p } })),
  resetByTypeParams: () => set({ byTypeParams: { ...DEFAULT_BYTYPE_PARAMS } }),
  setViewLayout: (viewKey, mode) => set((s) => {
    if (s.viewLayouts[viewKey] === mode) return {} as Partial<AppState>;
    const next = { ...s.viewLayouts, [viewKey]: mode };
    if (s.workspace) saveViewLayouts(s.workspace.rootPath, next, viewKey);
    return { viewLayouts: next };
  }),
  setCanvasSelection: (n, ids = []) => set({ canvasSelection: n, canvasSelectedIds: ids }),
  setTheme: (t) => {
    if (typeof window !== 'undefined') localStorage.setItem(THEME_KEY, t);
    set({ theme: t });
  },
  toggleTheme: () => {
    const next: Theme = get().theme === 'dark' ? 'light' : 'dark';
    if (typeof window !== 'undefined') localStorage.setItem(THEME_KEY, next);
    set({ theme: next });
  },
  setLoading: (b) => set({ loading: b }),
  // The user's tab choice is sticky: selecting never forces a default panel and a collapsed blade
  // stays collapsed. Only crossing domains (element ↔ link) swaps to the tab the user last chose
  // for that domain; changing or clearing the selection inside a domain leaves the tab alone.
  selectElement: (id) => set((s) => ({
    selectedElementId: id, selectedLinkId: null, selectedShapeId: null, linkDraft: null,
    inspectorTab: id && s.inspectorTab?.startsWith('link.') ? s.lastElementTab : s.inspectorTab,
  })),
  selectLink: (id) => set((s) => ({
    selectedLinkId: id, selectedElementId: null, selectedShapeId: null,
    // A draft only survives while its link stays selected.
    linkDraft: s.linkDraft && s.linkDraft.linkId === id ? s.linkDraft : null,
    inspectorTab: id && s.inspectorTab?.startsWith('element.') ? s.lastLinkTab : s.inspectorTab,
  })),
  setLinkDraft: (d) => set({ linkDraft: d }),
  setEdgeStyleFor: (linkId, style) => {
    const ws = get().workspace;
    const before = get().edgeStyles[linkId];
    if (!ws) {
      set((s) => ({ edgeStyles: { ...s.edgeStyles, [linkId]: style } }));
      return;
    }
    const all = setEdgeStyle(ws.rootPath, linkId, style);
    set({ edgeStyles: all });
    // A look is undoable like everything else (F-015 AC6); a run of slider ticks is one step.
    history.recordPresentation([{ section: 'edgeStyles', id: linkId, before, after: style }], 'Change appearance', `edgeStyles:${linkId}`);
  },
  setNodeStyleFor: (nodeId, style) => {
    const ws = get().workspace;
    const before = get().nodeStyles[nodeId];
    if (!ws) {
      set((s) => ({ nodeStyles: { ...s.nodeStyles, [nodeId]: style } }));
      return;
    }
    const all = setNodeStyle(ws.rootPath, nodeId, style);
    set({ nodeStyles: all });
    history.recordPresentation([{ section: 'nodeStyles', id: nodeId, before, after: style }], describeStyleChange(before, style), `nodeStyles:${nodeId}`);
  },
  setCustomProp: (nodeId, k, v) => {
    const ws = get().workspace;
    if (!ws) {
      set((s) => ({
        customProps: { ...s.customProps, [nodeId]: { ...(s.customProps[nodeId] ?? {}), [k]: v } },
      }));
      return;
    }
    const all = setCP(ws.rootPath, nodeId, k, v);
    set({ customProps: all });
  },
  removeCustomProp: (nodeId, k) => {
    const ws = get().workspace;
    if (!ws) {
      set((s) => {
        const cur = { ...(s.customProps[nodeId] ?? {}) };
        delete cur[k];
        const next = { ...s.customProps };
        if (Object.keys(cur).length === 0) delete next[nodeId];
        else next[nodeId] = cur;
        return { customProps: next };
      });
      return;
    }
    const all = rmCP(ws.rootPath, nodeId, k);
    set({ customProps: all });
  },
  renameCustomProp: (nodeId, oldKey, newKey) => {
    const ws = get().workspace;
    if (!ws) return;
    const all = renameCP(ws.rootPath, nodeId, oldKey, newKey);
    set({ customProps: all });
  },
  setViolations: (v) => set({ violations: v }),
  setViolationsOpen: (b) => set({ violationsOpen: b }),
  toggleSnap: () => {
    const next = !get().snapEnabled;
    if (typeof window !== 'undefined') localStorage.setItem('stemma.snap', next ? '1' : '0');
    set({ snapEnabled: next });
  },
  setToast: (t) => set({ toast: t }),
  setPaletteOpen: (b) => set({ paletteOpen: b }),
  setCanvasMode: (m) => set({ canvasMode: m }),
  setShapesFor: (viewKey, shapes) => set((s) => ({ shapes: { ...s.shapes, [viewKey]: shapes } })),
  selectShape: (id) => set({ selectedShapeId: id, selectedElementId: null, selectedLinkId: null, linkDraft: null }),
  setDepFocusMode: (b) => set({ depFocusMode: b }),
  setDepKindFilter: (k) => set({ depKindFilter: k }),
  setDepDepth: (n) => set({ depDepth: Math.max(1, Math.min(5, n)) }),
  toggleBcCollapsed: (id) => set((s) => {
    const next = new Set(s.collapsedBcs);
    if (next.has(id)) next.delete(id); else next.add(id);
    return { collapsedBcs: next };
  }),
  reloadBooks: () => {
    const s = get();
    const root = s.workspace?.rootPath;
    const books = root ? readBooks(loadBooksSection(root)) : [];
    const book = books.find((b) => b.id === s.activeBookId) ?? null;
    // A pull can take away the book or the page on screen. The book closes; a page falls back to
    // the first one rather than leaving the presenter on nothing.
    const pageId = book?.pages.some((p) => p.id === s.activePageId) ? s.activePageId : book?.pages[0]?.id ?? null;
    set({
      books,
      activeBookId: book?.id ?? null,
      activePageId: pageId,
      presenting: s.presenting && !!book && book.pages.length > 0,
    });
    if (pageId && pageId !== s.activePageId) get().showPage(pageId);
  },
  createBook: (name) => {
    const id = newBookId(get().books.map((b) => b.id));
    if (!editBooks(get, (books) => addBookTo(books, id, name))) return null;
    get().openBook(id);
    return id;
  },
  renameBook: (id, name) => { editBooks(get, (books) => renameBookIn(books, id, name)); },
  setBookAudience: (id, audience) => { editBooks(get, (books) => setAudienceIn(books, id, audience)); },
  deleteBook: (id) => {
    if (get().activeBookId === id) set({ activeBookId: null, activePageId: null, presenting: false });
    editBooks(get, (books) => removeBookFrom(books, id));
  },
  addPageFromCanvas: (bookId) => {
    const s = get();
    const book = s.books.find((b) => b.id === bookId);
    const view = currentViewId(s);
    if (!book || !view) return null;
    const focus = s.canvasSelectedIds.length > 0 ? s.canvasSelectedIds : s.selectedElementId ? [s.selectedElementId] : [];
    const id = newPageId(book.pages.map((p) => p.id));
    const name = s.customViews.find((v) => v.id === view)?.name
      ?? (view === 'dependencyGraph' ? 'Dependencies' : 'Module Map');
    // After the page on screen, which is where a person building a walk expects the next step.
    const after = s.activeBookId === bookId && s.activePageId ? s.activePageId : undefined;
    if (!editBooks(get, (books) => addPage(books, bookId, { id, title: name, view, focus }, after))) return null;
    set({ activeBookId: bookId, activePageId: id });
    return id;
  },
  updateBookPage: (bookId, pageId, patch) => { editBooks(get, (books) => updatePage(books, bookId, pageId, patch)); },
  removeBookPage: (bookId, pageId) => {
    const book = get().books.find((b) => b.id === bookId);
    if (!book) return;
    const index = book.pages.findIndex((p) => p.id === pageId);
    const neighbour = book.pages[index + 1] ?? book.pages[index - 1] ?? null;
    const onScreen = get().activePageId === pageId;
    // Before the edit: reading the books back would otherwise fall back to the first page.
    if (onScreen) set({ activePageId: neighbour?.id ?? null });
    if (!editBooks(get, (books) => removePage(books, bookId, pageId))) {
      if (onScreen) set({ activePageId: pageId });
      return;
    }
    if (onScreen && neighbour) get().showPage(neighbour.id);
  },
  moveBookPage: (bookId, from, to) => {
    const pages = get().books.find((b) => b.id === bookId)?.pages ?? [];
    const [page, target] = [pages[from], pages[to]];
    if (page && target) editBooks(get, (books) => movePage(books, bookId, page.id, target.id));
  },
  duplicateBookPage: (bookId, pageId) => {
    const book = get().books.find((b) => b.id === bookId);
    if (!book) return;
    const id = newPageId(book.pages.map((p) => p.id));
    if (editBooks(get, (books) => duplicatePage(books, bookId, pageId, id))) get().showPage(id);
  },
  openBook: (id) => {
    const book = get().books.find((b) => b.id === id) ?? null;
    set({ activeBookId: book?.id ?? null, activePageId: null, presenting: false });
    if (book?.pages[0]) get().showPage(book.pages[0].id);
  },
  showPage: (pageId) => {
    const s = get();
    const page = activeBook(s)?.pages.find((p) => p.id === pageId);
    if (!page) return;
    set({ activePageId: pageId });
    if (page.view === 'moduleMap' || page.view === 'dependencyGraph') {
      if (s.view !== page.view || s.activeCustomViewId !== null) get().setView(page.view);
    } else if (s.customViews.some((v) => v.id === page.view)) {
      // Concerns is not a canvas, so a view from Views/ cannot be drawn over it.
      if (s.view === 'concerns') set({ view: 'moduleMap' });
      if (s.activeCustomViewId !== page.view) get().setActiveCustomView(page.view);
    }
    // A view that no longer exists: the canvas stays where it is, and the page says why.
  },
  stepPage: (delta) => {
    const s = get();
    const pages = activeBook(s)?.pages ?? [];
    const index = pages.findIndex((p) => p.id === s.activePageId);
    const next = pages[Math.max(0, Math.min(pages.length - 1, index + delta))];
    if (next && next.id !== s.activePageId) get().showPage(next.id);
  },
  edgePage: (which) => {
    const pages = activeBook(get())?.pages ?? [];
    const page = which === 'first' ? pages[0] : pages[pages.length - 1];
    if (page) get().showPage(page.id);
  },
  startPresenting: (bookId, pageId) => {
    const book = get().books.find((b) => b.id === bookId);
    if (!book || book.pages.length === 0) {
      get().setToast({ kind: 'info', text: 'Add a page before presenting this book.' });
      return;
    }
    const start = book.pages.find((p) => p.id === pageId) ?? book.pages[0];
    set({ activeBookId: bookId, presenting: true, selectedElementId: null, selectedLinkId: null });
    get().showPage(start.id);
  },
  stopPresenting: () => set({ presenting: false }),
  setCapturing: (b) => set({ capturing: b }),
}));
