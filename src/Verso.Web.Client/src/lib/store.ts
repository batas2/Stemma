import { create } from 'zustand';
import type { ArchModel, ViewKind, WorkspaceModel } from './types';

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
  theme: Theme;
  loading: boolean;
  selectedTypeId: string | null;
  selectedElementId: string | null;
  toast: { kind: 'info' | 'error' | 'success'; text: string } | null;
  paletteOpen: boolean;
  setWorkspace: (ws: WorkspaceModel | null) => void;
  setArch: (a: ArchModel | null) => void;
  setView: (v: ViewKind) => void;
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
  theme: initialTheme(),
  loading: false,
  selectedTypeId: null,
  selectedElementId: null,
  toast: null,
  paletteOpen: false,
  setWorkspace: (ws) => set({ workspace: ws }),
  setArch: (a) => set({ arch: a }),
  setView: (v) => set({ view: v }),
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
