import { create } from 'zustand';
import type { ArchModel, CustomView, Mode, ViewKind, WorkspaceModel } from './types';
import { loadViews, saveViews, loadActiveView, saveActiveView } from './views';

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
  toast: null,
  paletteOpen: false,
  setWorkspace: (ws) => {
    set({ workspace: ws });
    if (ws) {
      const views = loadViews(ws.rootPath);
      const active = loadActiveView(ws.rootPath);
      set({ customViews: views, activeCustomViewId: active });
    } else {
      set({ customViews: [], activeCustomViewId: null });
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
  selectElement: (id) => set({ selectedElementId: id }),
  setToast: (t) => set({ toast: t }),
  setPaletteOpen: (b) => set({ paletteOpen: b }),
}));
