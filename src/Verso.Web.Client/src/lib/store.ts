import { create } from 'zustand';
import type { ArchModel, CustomView, Mode, ViewKind, Violation, WorkspaceModel } from './types';
import { loadViews, saveViews, loadActiveView, saveActiveView } from './views';
import { loadEdgeStyles, setEdgeStyle, type EdgeStyle } from './edgeStyles';
import { loadNodeStyles, setNodeStyle, type NodeStyle } from './nodeStyles';
import {
  loadCustomProps, setCustomProp as setCP, removeCustomProp as rmCP,
  renameCustomProp as renameCP, type CustomProps,
} from './customProps';
import { saveServerView, deleteServerView, listServerViews } from './api';

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
  mode: Mode;
  customViews: CustomView[];
  activeCustomViewId: string | null;
  sidebarOpen: boolean;
  theme: Theme;
  loading: boolean;
  selectedTypeId: string | null;
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
  setWorkspace: (ws: WorkspaceModel | null) => void;
  setArch: (a: ArchModel | null) => void;
  setView: (v: ViewKind) => void;
  setMode: (m: Mode) => void;
  toggleMode: () => void;
  setCustomViews: (vs: CustomView[]) => void;
  upsertCustomView: (v: CustomView) => void;
  removeCustomView: (id: string) => void;
  setActiveCustomView: (id: string | null) => void;
  addElementToActiveView: (elementId: string) => void;
  removeElementFromActiveView: (elementId: string) => void;
  setSidebarOpen: (b: boolean) => void;
  setTheme: (t: Theme) => void;
  toggleTheme: () => void;
  setLoading: (b: boolean) => void;
  selectType: (id: string | null) => void;
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
}

export const useApp = create<AppState>((set, get) => ({
  workspace: null,
  arch: null,
  view: 'moduleMap',
  mode: 'edit',
  customViews: [],
  activeCustomViewId: null,
  sidebarOpen: true,
  theme: initialTheme(),
  loading: false,
  selectedTypeId: null,
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
  setWorkspace: (ws) => {
    set({ workspace: ws });
    if (ws) {
      const views = loadViews(ws.rootPath);
      const active = loadActiveView(ws.rootPath);
      const eStyles = loadEdgeStyles(ws.rootPath);
      const nStyles = loadNodeStyles(ws.rootPath);
      const cProps = loadCustomProps(ws.rootPath);
      set({ customViews: views, activeCustomViewId: active, edgeStyles: eStyles, nodeStyles: nStyles, customProps: cProps });
      // Merge in source-stored views (Views/<Name>.cs). Server-side wins on conflict so the
      // checked-in code is canonical.
      listServerViews().then((server) => {
        if (server.length === 0) return;
        const merged = [
          ...server.map((s) => ({ id: s.id, name: s.name, baseView: s.baseView as 'all', elementIds: s.elementIds, createdAt: new Date().toISOString() })),
          ...views.filter((v) => !server.some((s) => s.id === v.id)),
        ];
        set({ customViews: merged });
        saveViews(ws.rootPath, merged);
      }).catch(() => {});
    } else {
      set({ customViews: [], activeCustomViewId: null, edgeStyles: {}, nodeStyles: {}, customProps: {} });
    }
  },
  setArch: (a) => set({ arch: a }),
  setView: (v) => set({ view: v, activeCustomViewId: null, selectedElementId: null }),
  setMode: (m) => set({ mode: m }),
  toggleMode: () => set({ mode: get().mode === 'edit' ? 'view' : 'edit' }),
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
    set({ customViews: next });
    if (get().activeCustomViewId === id) set({ activeCustomViewId: null });
    const ws = get().workspace;
    if (ws) {
      saveViews(ws.rootPath, next);
      if (get().activeCustomViewId === id) saveActiveView(ws.rootPath, null);
    }
    deleteServerView(id).catch(() => {});
  },
  setActiveCustomView: (id) => {
    set({ activeCustomViewId: id, selectedElementId: null });
    const ws = get().workspace;
    if (ws) saveActiveView(ws.rootPath, id);
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
  selectType: (id) => set({ selectedTypeId: id }),
  selectElement: (id) => set({ selectedElementId: id, selectedLinkId: null }),
  selectLink: (id) => set({ selectedLinkId: id, selectedElementId: null }),
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
}));
