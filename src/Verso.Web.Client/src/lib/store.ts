import { create } from 'zustand';
import type { ArchModel, ViewKind, WorkspaceModel } from './types';

interface AppState {
  workspace: WorkspaceModel | null;
  arch: ArchModel | null;
  view: ViewKind;
  loading: boolean;
  selectedTypeId: string | null;
  selectedElementId: string | null;
  toast: { kind: 'info' | 'error' | 'success'; text: string } | null;
  paletteOpen: boolean;
  setWorkspace: (ws: WorkspaceModel | null) => void;
  setArch: (a: ArchModel | null) => void;
  setView: (v: ViewKind) => void;
  setLoading: (b: boolean) => void;
  selectType: (id: string | null) => void;
  selectElement: (id: string | null) => void;
  setToast: (t: AppState['toast']) => void;
  setPaletteOpen: (b: boolean) => void;
}

export const useApp = create<AppState>((set) => ({
  workspace: null,
  arch: null,
  view: 'moduleMap',
  loading: false,
  selectedTypeId: null,
  selectedElementId: null,
  toast: null,
  paletteOpen: false,
  setWorkspace: (ws) => set({ workspace: ws }),
  setArch: (a) => set({ arch: a }),
  setView: (v) => set({ view: v }),
  setLoading: (b) => set({ loading: b }),
  selectType: (id) => set({ selectedTypeId: id }),
  selectElement: (id) => set({ selectedElementId: id }),
  setToast: (t) => set({ toast: t }),
  setPaletteOpen: (b) => set({ paletteOpen: b }),
}));
