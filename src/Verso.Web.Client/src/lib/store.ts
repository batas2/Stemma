import { create } from 'zustand';
import type { ArchModel, Book, BookPage, CustomView, ViewKind, Violation, WorkspaceModel } from './types';
import { loadViews, saveViews, loadActiveView, saveActiveView, loadOpenViews, saveOpenViews } from './views';
import { loadEdgeStyles, setEdgeStyle, type EdgeStyle } from './edgeStyles';
import { loadNodeStyles, setNodeStyle, type NodeStyle } from './nodeStyles';
import {
  loadCustomProps, setCustomProp as setCP, removeCustomProp as rmCP,
  renameCustomProp as renameCP, type CustomProps,
} from './customProps';
import { saveServerView, deleteServerView, listServerViews } from './api';
import type { Shape, ShapeKind } from './shapes';

/** What the canvas pointer is doing right now. `select` is the default (drag/select model nodes). */
export type CanvasMode =
  | { kind: 'select' }
  | { kind: 'shape'; tool: ShapeKind };

export type Theme = 'dark' | 'light';

const THEME_KEY = 'verso.theme';
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
  inspectorOpen: boolean;
  theme: Theme;
  loading: boolean;
  selectedElementId: string | null;
  selectedLinkId: string | null;
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
  // View Books — a presentation surface over the built-in views.
  books: Book[];
  activeBookId: string | null;
  activeBookPageIndex: number;
  setWorkspace: (ws: WorkspaceModel | null) => void;
  rehydratePresentation: () => void;
  setArch: (a: ArchModel | null) => void;
  setView: (v: ViewKind) => void;
  setCustomViews: (vs: CustomView[]) => void;
  upsertCustomView: (v: CustomView) => void;
  removeCustomView: (id: string) => void;
  setActiveCustomView: (id: string | null) => void;
  openCustomView: (id: string) => void;
  closeCustomView: (id: string) => void;
  addElementToActiveView: (elementId: string) => void;
  removeElementFromActiveView: (elementId: string) => void;
  setSidebarOpen: (b: boolean) => void;
  setInspectorOpen: (b: boolean) => void;
  setTheme: (t: Theme) => void;
  toggleTheme: () => void;
  setLoading: (b: boolean) => void;
  selectElement: (id: string | null) => void;
  selectLink: (id: string | null) => void;
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
  setBooks: (b: Book[]) => void;
  addBook: (b: Book) => void;
  removeBook: (id: string) => void;
  renameBook: (id: string, newName: string) => void;
  addBookPage: (bookId: string, page: BookPage) => void;
  removeBookPage: (bookId: string, pageIndex: number) => void;
  reorderBookPages: (bookId: string, newOrder: number[]) => void;
  setBookPageNarrative: (bookId: string, pageIndex: number, narrative: string) => void;
  setActiveBook: (id: string | null) => void;
  setActiveBookPageIndex: (i: number) => void;
  nextBookPage: () => void;
  prevBookPage: () => void;
}

export const useApp = create<AppState>((set, get) => ({
  workspace: null,
  arch: null,
  view: 'moduleMap',
  customViews: [],
  activeCustomViewId: null,
  openViewIds: [],
  sidebarOpen: true,
  inspectorOpen: true,
  theme: initialTheme(),
  loading: false,
  selectedElementId: null,
  selectedLinkId: null,
  edgeStyles: {},
  nodeStyles: {},
  customProps: {},
  violations: [],
  violationsOpen: false,
  snapEnabled: typeof window !== 'undefined' && localStorage.getItem('verso.snap') === '1',
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
  activeBookPageIndex: 0,
  setWorkspace: (ws) => {
    // Hydrate from localStorage only on first open of a given rootPath. Subsequent refresh()s
    // during the same session should NOT reset activeCustomViewId / selection — the user's
    // in-memory choices win over stale localStorage.
    const previous = get().workspace;
    set({ workspace: ws });
    if (!ws) {
      set({ customViews: [], activeCustomViewId: null, openViewIds: [], edgeStyles: {}, nodeStyles: {}, customProps: {}, collapsedBcs: new Set() });
      return;
    }
    if (previous?.rootPath === ws.rootPath) return;
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
    set({ customViews: views, activeCustomViewId: active, openViewIds: openIds, edgeStyles: eStyles, nodeStyles: nStyles, customProps: cProps, collapsedBcs: new Set() });
    listServerViews().then((server) => {
      if (server.length === 0) return;
      const merged = [
        ...server.map((s) => ({ id: s.id, name: s.name, baseView: s.baseView as 'all', elementIds: s.elementIds, createdAt: new Date().toISOString() })),
        ...views.filter((v) => !server.some((s) => s.id === v.id)),
      ];
      set({ customViews: merged });
      saveViews(ws.rootPath, merged);
    }).catch(() => {});
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
    });
  },
  setArch: (a) => set({ arch: a }),
  // setView is a no-op when the requested view matches the current one — avoids clobbering
  // activeCustomViewId / selectedElementId on re-clicks.
  setView: (v) => {
    if (v === get().view) return;
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
    // Mirror to source as Views/<Name>.cs (best-effort; localStorage stays the in-flight cache).
    saveServerView({ id: v.id, name: v.name, baseView: v.baseView, elementIds: v.elementIds }).catch(() => {});
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
    deleteServerView(id).catch(() => {});
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
    if (updated) saveServerView({ id: updated.id, name: updated.name, baseView: updated.baseView, elementIds: updated.elementIds }).catch(() => {});
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
    if (updated) saveServerView({ id: updated.id, name: updated.name, baseView: updated.baseView, elementIds: updated.elementIds }).catch(() => {});
  },
  setSidebarOpen: (b) => set({ sidebarOpen: b }),
  setInspectorOpen: (b) => set({ inspectorOpen: b }),
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
  selectElement: (id) => set({ selectedElementId: id, selectedLinkId: null, selectedShapeId: null }),
  selectLink: (id) => set({ selectedLinkId: id, selectedElementId: null, selectedShapeId: null }),
  setEdgeStyleFor: (linkId, style) => {
    const ws = get().workspace;
    if (!ws) {
      set((s) => ({ edgeStyles: { ...s.edgeStyles, [linkId]: style } }));
      return;
    }
    const all = setEdgeStyle(ws.rootPath, linkId, style);
    set({ edgeStyles: all });
  },
  setNodeStyleFor: (nodeId, style) => {
    const ws = get().workspace;
    if (!ws) {
      set((s) => ({ nodeStyles: { ...s.nodeStyles, [nodeId]: style } }));
      return;
    }
    const all = setNodeStyle(ws.rootPath, nodeId, style);
    set({ nodeStyles: all });
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
    if (typeof window !== 'undefined') localStorage.setItem('verso.snap', next ? '1' : '0');
    set({ snapEnabled: next });
  },
  setToast: (t) => set({ toast: t }),
  setPaletteOpen: (b) => set({ paletteOpen: b }),
  setCanvasMode: (m) => set({ canvasMode: m }),
  setShapesFor: (viewKey, shapes) => set((s) => ({ shapes: { ...s.shapes, [viewKey]: shapes } })),
  selectShape: (id) => set({ selectedShapeId: id, selectedElementId: null, selectedLinkId: null }),
  setDepFocusMode: (b) => set({ depFocusMode: b }),
  setDepKindFilter: (k) => set({ depKindFilter: k }),
  setDepDepth: (n) => set({ depDepth: Math.max(1, Math.min(5, n)) }),
  toggleBcCollapsed: (id) => set((s) => {
    const next = new Set(s.collapsedBcs);
    if (next.has(id)) next.delete(id); else next.add(id);
    return { collapsedBcs: next };
  }),
  setBooks: (b) => set({ books: b }),
  addBook: (b) => set((s) => ({ books: [...s.books, b] })),
  removeBook: (id) => set((s) => {
    const next = s.books.filter((b) => b.id !== id);
    const stillActive = s.activeBookId && next.some((b) => b.id === s.activeBookId);
    return { books: next, activeBookId: stillActive ? s.activeBookId : null, activeBookPageIndex: stillActive ? s.activeBookPageIndex : 0 };
  }),
  renameBook: (id, newName) => set((s) => ({
    books: s.books.map((b) => b.id === id ? { ...b, name: newName } : b),
  })),
  addBookPage: (bookId, page) => set((s) => ({
    books: s.books.map((b) => b.id === bookId ? { ...b, pages: [...b.pages, page] } : b),
  })),
  removeBookPage: (bookId, pageIndex) => set((s) => ({
    books: s.books.map((b) => {
      if (b.id !== bookId) return b;
      if (pageIndex < 0 || pageIndex >= b.pages.length) return b;
      return { ...b, pages: b.pages.filter((_, i) => i !== pageIndex) };
    }),
    activeBookPageIndex: s.activeBookId === bookId && s.activeBookPageIndex >= pageIndex && s.activeBookPageIndex > 0
      ? s.activeBookPageIndex - 1 : s.activeBookPageIndex,
  })),
  reorderBookPages: (bookId, newOrder) => set((s) => ({
    books: s.books.map((b) => {
      if (b.id !== bookId) return b;
      if (newOrder.length !== b.pages.length) return b;
      if (new Set(newOrder).size !== newOrder.length) return b;
      return { ...b, pages: newOrder.map((i) => b.pages[i]) };
    }),
  })),
  setBookPageNarrative: (bookId, pageIndex, narrative) => set((s) => ({
    books: s.books.map((b) => {
      if (b.id !== bookId) return b;
      if (pageIndex < 0 || pageIndex >= b.pages.length) return b;
      return { ...b, pages: b.pages.map((p, i) => i === pageIndex ? { ...p, narrative } : p) };
    }),
  })),
  setActiveBook: (id) => set({ activeBookId: id, activeBookPageIndex: 0 }),
  setActiveBookPageIndex: (i) => {
    const book = get().books.find((b) => b.id === get().activeBookId);
    if (!book) return;
    const clamped = Math.max(0, Math.min(book.pages.length - 1, i));
    set({ activeBookPageIndex: clamped });
  },
  nextBookPage: () => {
    const s = get();
    const book = s.books.find((b) => b.id === s.activeBookId);
    if (!book) return;
    if (s.activeBookPageIndex < book.pages.length - 1) set({ activeBookPageIndex: s.activeBookPageIndex + 1 });
  },
  prevBookPage: () => {
    const s = get();
    if (s.activeBookPageIndex > 0) set({ activeBookPageIndex: s.activeBookPageIndex - 1 });
  },
}));
