import { create } from 'zustand';
import type { WorkspaceModel } from './types';

interface AppState {
  workspace: WorkspaceModel | null;
  loading: boolean;
  selectedTypeId: string | null;
  toast: { kind: 'info' | 'error' | 'success'; text: string } | null;
  paletteOpen: boolean;
  setWorkspace: (ws: WorkspaceModel | null) => void;
  setLoading: (b: boolean) => void;
  selectType: (id: string | null) => void;
  setToast: (t: AppState['toast']) => void;
  setPaletteOpen: (b: boolean) => void;
}

export const useApp = create<AppState>((set) => ({
  workspace: null,
  loading: false,
  selectedTypeId: null,
  toast: null,
  paletteOpen: false,
  setWorkspace: (ws) => set({ workspace: ws }),
  setLoading: (b) => set({ loading: b }),
  selectType: (id) => set({ selectedTypeId: id }),
  setToast: (t) => set({ toast: t }),
  setPaletteOpen: (b) => set({ paletteOpen: b }),
}));
