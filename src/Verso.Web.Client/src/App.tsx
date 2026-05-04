import { useEffect } from 'react';
import { Topbar } from './components/Topbar';
import { Sidebar } from './components/Sidebar';
import { Canvas } from './components/Canvas';
import { ArchCanvas } from './components/ArchCanvas';
import { Inspector } from './components/Inspector';
import { ArchInspector } from './components/ArchInspector';
import { CommandPalette } from './components/CommandPalette';
import { StatusBar } from './components/StatusBar';
import { EmptyState } from './components/EmptyState';
import { useApp } from './lib/store';
import { ensureConnection, onOperationApplied, onExternalChange, undoOperation, redoOperation } from './lib/signalr';
import { archModel, listViolations, snapshot } from './lib/api';
import { primeLayoutSidecar, loadLayout, saveLayout } from './lib/layout';
import { layoutUndo } from './lib/layoutUndo';
import type { ViewKind } from './lib/types';
import { ViolationsPanel } from './components/ViolationsPanel';
import { bindShortcuts } from './lib/shortcuts';

export default function App() {
  const ws = useApp((s) => s.workspace);
  const arch = useApp((s) => s.arch);
  const view = useApp((s) => s.view);
  const setWs = useApp((s) => s.setWorkspace);
  const setArch = useApp((s) => s.setArch);
  const setView = useApp((s) => s.setView);
  const setViolations = useApp((s) => s.setViolations);

  useEffect(() => {
    ensureConnection().catch(() => {});
    snapshot().then((s) => {
      if (s) {
        setWs(s);
        primeLayoutSidecar(s.rootPath).catch(() => {});
      }
    }).catch(() => {});
    archModel().then((a) => setArch(a)).catch(() => setArch(null));
    async function refresh() {
      const [s, a, v] = await Promise.all([
        snapshot(),
        archModel().catch(() => null),
        listViolations().catch(() => []),
      ]);
      if (s) {
        setWs(s);
        primeLayoutSidecar(s.rootPath).catch(() => {});
      }
      setArch(a);
      setViolations(v);
    }
    const offOp = onOperationApplied(refresh);
    const offExt = onExternalChange(refresh);
    return () => { offOp(); offExt(); };
  }, [setWs, setArch, setViolations]);

  const setPaletteOpen = useApp((s) => s.setPaletteOpen);

  function applyLayoutEntry(entry: { workspaceRoot: string; viewKey: string; positions: Record<string, { x: number; y: number }> }) {
    // Merge into existing layout for the view, then write back through the layout module
    // so localStorage and the verso.layout.json sidecar stay in sync.
    const current = loadLayout(entry.workspaceRoot, entry.viewKey as ViewKind);
    const merged = { ...current, ...entry.positions };
    saveLayout(entry.workspaceRoot, entry.viewKey as ViewKind, merged);
    // Notify the canvas to refresh by emitting a synthetic storage event; ArchCanvas listens
    // to view changes and re-reads layout when it's the active key.
    window.dispatchEvent(new CustomEvent('verso:layout-changed', { detail: { viewKey: entry.viewKey } }));
  }

  function tryLayoutUndo(): boolean {
    const entry = layoutUndo.popUndo();
    if (!entry) return false;
    applyLayoutEntry({ workspaceRoot: entry.workspaceRoot, viewKey: entry.viewKey, positions: entry.before });
    return true;
  }

  function tryLayoutRedo(): boolean {
    const entry = layoutUndo.popRedo();
    if (!entry) return false;
    applyLayoutEntry({ workspaceRoot: entry.workspaceRoot, viewKey: entry.viewKey, positions: entry.after });
    return true;
  }

  useEffect(() => {
    return bindShortcuts([
      {
        key: 'z', primary: true, description: 'Undo',
        handler: () => { if (!tryLayoutUndo()) undoOperation().catch(() => {}); },
      },
      {
        key: 'z', primary: true, shift: true, description: 'Redo',
        handler: () => { if (!tryLayoutRedo()) redoOperation().catch(() => {}); },
      },
      {
        key: 'y', primary: true, description: 'Redo',
        handler: () => { if (!tryLayoutRedo()) redoOperation().catch(() => {}); },
      },
      { key: 'k', primary: true, description: 'Command palette', handler: () => setPaletteOpen(true) },
    ]);
  }, [setPaletteOpen]);

  // Theme: toggle the `dark` class on <html>; Tailwind reads it.
  const theme = useApp((s) => s.theme);
  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
    document.body.style.backgroundColor = theme === 'dark' ? 'rgb(9 9 11)' : 'rgb(250 250 250)';
    document.body.style.color = theme === 'dark' ? 'rgb(244 244 245)' : 'rgb(24 24 27)';
  }, [theme]);

  // Auto-pick a sensible default view based on workspace contents.
  useEffect(() => {
    if (!ws) return;
    if (arch && view === 'engineer') setView('moduleMap');
    else if (!arch && view !== 'engineer') setView('engineer');
  }, [ws, arch, view, setView]);

  return (
    <div className="h-screen flex flex-col">
      <Topbar />
      <div className="flex-1 flex min-h-0">
        {ws ? (
          <>
            {view !== 'engineer' && <Sidebar />}
            <main className="flex-1 min-w-0">
              {view === 'engineer' ? <Canvas /> : <ArchCanvas />}
            </main>
            {view === 'engineer' ? <Inspector /> : <ArchInspector />}
          </>
        ) : (
          <EmptyState />
        )}
      </div>
      <ViolationsPanel />
      <StatusBar />
      <CommandPalette />
    </div>
  );
}
