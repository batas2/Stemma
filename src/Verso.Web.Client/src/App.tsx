import { Suspense, lazy, useEffect, useRef, useState } from 'react';
import { ChevronsLeft, PanelRight } from 'lucide-react';
import { Topbar } from './components/Topbar';
import { Sidebar } from './components/Sidebar';
import { ArchCanvas } from './components/ArchCanvas';
import { ConcernsView } from './components/ConcernsView';
import { ViewTabs } from './components/ViewTabs';
import { ConnectionIndicator } from './components/ConnectionIndicator';
import { ArchInspector } from './components/ArchInspector';
import { ShapeInspector } from './components/ShapeInspector';
import { CommandPalette } from './components/CommandPalette';
import { StatusBar } from './components/StatusBar';
import { EmptyState } from './components/EmptyState';
import { useApp } from './lib/store';
import { ensureConnection, onOperationApplied, onExternalChange, undoOperation, redoOperation } from './lib/signalr';
import { archModel, books as fetchBooks, listViolations, snapshot } from './lib/api';
import { primeLayoutSidecar, loadLayout, saveLayout } from './lib/layout';
import { layoutUndo } from './lib/layoutUndo';
import type { ViewKind } from './lib/types';
import { ViolationsPanel } from './components/ViolationsPanel';
import { BookFooter } from './components/BookFooter';
import { ConfirmDialog } from './components/ConfirmDialog';
import { PromptDialog } from './components/PromptDialog';
import { ToastQueue } from './components/ToastQueue';
import { TopProgressBar } from './components/LoadingOverlay';
import { bindShortcuts } from './lib/shortcuts';

const ShortcutHelp = lazy(() => import('./components/ShortcutHelp').then((m) => ({ default: m.ShortcutHelp })));

/** Renders the shape inspector when a shape is selected; otherwise the arch inspector.
 *  Defined at module scope so it has stable identity across App renders. */
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
  const view = useApp((s) => s.view);
  const inspectorOpen = useApp((s) => s.inspectorOpen);
  const setInspectorOpen = useApp((s) => s.setInspectorOpen);
  const setWs = useApp((s) => s.setWorkspace);
  const setArch = useApp((s) => s.setArch);
  const setView = useApp((s) => s.setView);
  const setViolations = useApp((s) => s.setViolations);
  const setBooks = useApp((s) => s.setBooks);

  useEffect(() => {
    ensureConnection().catch(() => {});
    snapshot().then((s) => {
      if (s) {
        setWs(s);
        primeLayoutSidecar(s.rootPath).catch(() => {});
      }
    }).catch(() => {});
    archModel().then((a) => setArch(a)).catch(() => setArch(null));
    fetchBooks().then((b) => { if (b) setBooks(b); }).catch(() => {});
    // A transient archModel() failure must NOT clobber a previously good arch — use a sentinel
    // so refresh() can preserve the prior in-memory model on a 404 / network blip.
    const PRESERVE = Symbol('preserve');
    async function refresh() {
      const [s, a, v, b] = await Promise.all([
        snapshot(),
        archModel().catch(() => PRESERVE as unknown as null),
        listViolations().catch(() => []),
        fetchBooks().catch(() => null),
      ]);
      if (s) {
        setWs(s);
        primeLayoutSidecar(s.rootPath).catch(() => {});
      }
      if ((a as unknown) !== PRESERVE) setArch(a);
      setViolations(v);
      if (b) setBooks(b);
    }
    const offOp = onOperationApplied(refresh);
    const offExt = onExternalChange(refresh);
    return () => { offOp(); offExt(); };
  }, [setWs, setArch, setViolations, setBooks]);

  const setPaletteOpen = useApp((s) => s.setPaletteOpen);
  const rehydratePresentation = useApp((s) => s.rehydratePresentation);

  // When the committed sidecar finishes loading, re-read styles/notes/props/positions from it.
  useEffect(() => {
    function onPrimed() {
      rehydratePresentation();
      window.dispatchEvent(new CustomEvent('verso:layout-changed', { detail: { viewKey: 'all' } }));
      window.dispatchEvent(new CustomEvent('verso:notes-changed'));
    }
    window.addEventListener('verso:sidecar-primed', onPrimed);
    return () => window.removeEventListener('verso:sidecar-primed', onPrimed);
  }, [rehydratePresentation]);

  // Book mode: when the active page changes, drive `view` to follow.
  const activeBookId = useApp((s) => s.activeBookId);
  const activeBookPageIndex = useApp((s) => s.activeBookPageIndex);
  const books = useApp((s) => s.books);
  useEffect(() => {
    if (!activeBookId) return;
    const book = books.find((b) => b.id === activeBookId);
    if (!book || book.pages.length === 0) return;
    const target = book.pages[activeBookPageIndex];
    if (target && (target.viewId === 'moduleMap' || target.viewId === 'dependencyGraph')) {
      setView(target.viewId as ViewKind);
    }
  }, [activeBookId, activeBookPageIndex, books, setView]);

  function applyLayoutEntry(entry: { workspaceRoot: string; viewKey: string; positions: Record<string, { x: number; y: number }> }) {
    const current = loadLayout(entry.workspaceRoot, entry.viewKey as ViewKind);
    const merged = { ...current, ...entry.positions };
    saveLayout(entry.workspaceRoot, entry.viewKey as ViewKind, merged);
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

  // Pick a default view ONCE per workspace open, anchored on rootPath.
  const initialisedFor = useRef<string | null>(null);
  useEffect(() => {
    if (!ws) { initialisedFor.current = null; return; }
    if (initialisedFor.current === ws.rootPath) return;
    initialisedFor.current = ws.rootPath;
    setView('moduleMap');
  }, [ws]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="h-screen flex flex-col">
      <a href="#verso-canvas" className="skip-link">Skip to canvas</a>
      <TopProgressBar />
      <Topbar />
      <div className="flex-1 flex min-h-0">
        {ws ? (
          <>
            <Sidebar />
            <main id="verso-canvas" role="main" aria-label="Canvas" className="flex-1 min-w-0 flex flex-col">
              <div className="flex-1 min-h-0 relative">
                {view === 'concerns' ? <ConcernsView /> : <ArchCanvas />}
              </div>
            </main>
            {inspectorOpen && <ArchOrShapeInspector />}
            {!inspectorOpen && (
              <aside className="w-10 shrink-0 border-l border-default bg-zinc-50 dark:bg-zinc-950/60 flex flex-col items-center py-3 gap-3">
                <button
                  onClick={() => setInspectorOpen(true)}
                  title="Show inspector panel"
                  aria-label="Show inspector"
                  className="p-1.5 rounded hover:bg-zinc-200 dark:hover:bg-zinc-800 text-zinc-500 dark:text-zinc-400 hover:text-body"
                >
                  <ChevronsLeft className="w-4 h-4" />
                </button>
                <PanelRight className="w-4 h-4 text-zinc-300 dark:text-zinc-700" />
              </aside>
            )}
          </>
        ) : (
          <EmptyState />
        )}
      </div>
      {ws && <ViewTabs />}
      <BookFooter />
      <ViolationsPanel />
      <StatusBar />
      <CommandPalette />
      <Suspense fallback={null}>
        <ShortcutHelp open={helpOpen} onClose={() => setHelpOpen(false)} />
      </Suspense>
      <ConfirmDialog />
      <PromptDialog />
      <ToastQueue />
      <ConnectionIndicator />
    </div>
  );
}
