import { Suspense, lazy, useEffect, useRef, useState } from 'react';
import { Topbar } from './components/Topbar';
import { Sidebar } from './components/Sidebar';
import { Canvas } from './components/Canvas';
import { ArchCanvas } from './components/ArchCanvas';
import { Inspector } from './components/Inspector';
import { ArchInspector } from './components/ArchInspector';
import { ShapeInspector } from './components/ShapeInspector';
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
import { ConfirmDialog } from './components/ConfirmDialog';
import { PromptDialog } from './components/PromptDialog';
import { ToastQueue } from './components/ToastQueue';
import { TopProgressBar } from './components/LoadingOverlay';
import { FirstRunHints } from './components/FirstRunHints';
import { bindShortcuts } from './lib/shortcuts';

const DecisionLog = lazy(() => import('./components/DecisionLog').then((m) => ({ default: m.DecisionLog })));
const ShortcutHelp = lazy(() => import('./components/ShortcutHelp').then((m) => ({ default: m.ShortcutHelp })));

/** Renders the shape inspector when a shape is selected; otherwise falls back to the
 *  arch inspector. Defined at module scope so it has stable identity across App renders —
 *  inlining it inside App() caused unmount/remount churn that re-fired narrative fetches. */
function ArchOrShapeInspector() {
  const selectedShapeId = useApp((s) => s.selectedShapeId);
  const workspace = useApp((s) => s.workspace);
  const customViews = useApp((s) => s.customViews);
  const activeId = useApp((s) => s.activeCustomViewId);
  if (selectedShapeId && workspace) {
    const activeCustomView = customViews.find((v) => v.id === activeId);
    const layoutKey = activeCustomView ? `custom:${activeCustomView.id}` : 'moduleMap';
    return <ShapeInspector viewKey={layoutKey} workspaceRoot={workspace.rootPath} />;
  }
  return <ArchInspector />;
}

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
    // UX bug fix #5: a transient archModel() failure must NOT clobber a previously good arch.
    // Use a sentinel so refresh() can preserve the prior in-memory model on a 404 / network blip.
    const PRESERVE = Symbol('preserve');
    async function refresh() {
      const [s, a, v] = await Promise.all([
        snapshot(),
        archModel().catch(() => PRESERVE as unknown as null),
        listViolations().catch(() => []),
      ]);
      if (s) {
        setWs(s);
        primeLayoutSidecar(s.rootPath).catch(() => {});
      }
      if ((a as unknown) !== PRESERVE) setArch(a);
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
      { key: '/', description: 'Focus search', handler: () => focusSidebarSearch() },
      { key: '?', shift: true, description: 'Show keyboard shortcuts', handler: () => setHelpOpen((v) => !v) },
      { key: 'tab', description: 'Cycle elements', handler: () => cycleElement(1) },
      { key: 'tab', shift: true, description: 'Cycle elements (back)', handler: () => cycleElement(-1) },
      { key: 'arrowup', description: 'Nudge up', handler: () => nudgeSelected(0, -10) },
      { key: 'arrowdown', description: 'Nudge down', handler: () => nudgeSelected(0, 10) },
      { key: 'arrowleft', description: 'Nudge left', handler: () => nudgeSelected(-10, 0) },
      { key: 'arrowright', description: 'Nudge right', handler: () => nudgeSelected(10, 0) },
      { key: 'enter', description: 'Open inspector for selected', handler: () => focusInspectorForSelected() },
    ]);
  }, [setPaletteOpen]); // eslint-disable-line react-hooks/exhaustive-deps

  function focusSidebarSearch() {
    const input = document.querySelector('aside input[placeholder*="Search"]') as HTMLInputElement | null;
    input?.focus();
  }

  function focusInspectorForSelected() {
    // Scroll the inspector into view; a no-op if nothing is selected.
    const aside = document.querySelector('aside.shrink-0') as HTMLElement | null;
    aside?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  function cycleElement(direction: 1 | -1) {
    const archNow = useApp.getState().arch;
    if (!archNow || archNow.elements.length === 0) return;
    const ids = archNow.elements.map((e) => e.id).sort();
    const cur = useApp.getState().selectedElementId;
    const idx = cur ? ids.indexOf(cur) : -1;
    const next = ids[((idx + direction) + ids.length) % ids.length];
    useApp.getState().selectElement(next);
    window.dispatchEvent(new CustomEvent('verso:focus-node', { detail: { nodeId: next } }));
  }

  function nudgeSelected(dx: number, dy: number) {
    const id = useApp.getState().selectedElementId;
    const ws = useApp.getState().workspace;
    if (!id || !ws) return;
    window.dispatchEvent(new CustomEvent('verso:nudge', { detail: { nodeId: id, dx, dy } }));
  }

  const [helpOpen, setHelpOpen] = useState(false);

  // Theme: toggle the `dark` class on <html>; Tailwind reads it.
  const theme = useApp((s) => s.theme);
  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
    document.body.style.backgroundColor = theme === 'dark' ? 'rgb(9 9 11)' : 'rgb(250 250 250)';
    document.body.style.color = theme === 'dark' ? 'rgb(244 244 245)' : 'rgb(24 24 27)';
  }, [theme]);

  // UX bug fix #1: pick a default view ONCE per workspace open, not on every arch refresh.
  // Anchored on rootPath; subsequent op refreshes that briefly null `arch` won't flip the view.
  const initialisedFor = useRef<string | null>(null);
  useEffect(() => {
    if (!ws) { initialisedFor.current = null; return; }
    if (initialisedFor.current === ws.rootPath) return;
    initialisedFor.current = ws.rootPath;
    setView(arch ? 'moduleMap' : 'engineer');
    // Intentionally omit `view` and `arch` from deps — we deliberately run only on workspace
    // boundary changes. eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ws]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="h-screen flex flex-col">
      <a href="#verso-canvas" className="skip-link">Skip to canvas</a>
      <TopProgressBar />
      <Topbar />
      <div className="flex-1 flex min-h-0">
        {ws ? (
          <>
            {view !== 'engineer' && view !== 'decisionLog' && <Sidebar />}
            <main id="verso-canvas" role="main" aria-label="Canvas" className="flex-1 min-w-0">
              {view === 'engineer' && <Canvas />}
              {view === 'decisionLog' && (
                <Suspense fallback={<div className="h-full flex items-center justify-center text-xs text-faint">Loading decisions…</div>}>
                  <DecisionLog />
                </Suspense>
              )}
              {view !== 'engineer' && view !== 'decisionLog' && <ArchCanvas />}
            </main>
            {view === 'engineer' && <Inspector />}
            {view !== 'engineer' && view !== 'decisionLog' && <ArchOrShapeInspector />}
          </>
        ) : (
          <EmptyState />
        )}
      </div>
      <ViolationsPanel />
      <StatusBar />
      <CommandPalette />
      <Suspense fallback={null}>
        <ShortcutHelp open={helpOpen} onClose={() => setHelpOpen(false)} />
      </Suspense>
      <ConfirmDialog />
      <PromptDialog />
      <ToastQueue />
      <FirstRunHints />
    </div>
  );
}
