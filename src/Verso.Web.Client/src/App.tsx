import { Suspense, lazy, useEffect, useRef, useState } from 'react';
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
import { ensureConnection, onOperationApplied, onExternalChange, undoOperation, redoOperation, applyOperation } from './lib/signalr';
import { friendlyOpError } from './lib/opError';
import { confirmAction } from './components/ConfirmDialog';
import { removeShape, saveShapes } from './lib/shapes';
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
  const setWs = useApp((s) => s.setWorkspace);
  const setArch = useApp((s) => s.setArch);
  const setView = useApp((s) => s.setView);
  const setViolations = useApp((s) => s.setViolations);
  const setBooks = useApp((s) => s.setBooks);

  useEffect(() => {
    ensureConnection().catch(() => {});
    snapshot().then((s) => { if (s) setWs(s); }).catch(() => {});
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

  // Load the active workspace's model + presentation whenever the workspace changes — on the
  // initial snapshot, but also when one is opened from Recents / by path / via Init. Previously
  // only the initial mount fetched these, so opening a workspace mid-session left the canvas
  // empty until a full page reload.
  const wsRoot = ws?.rootPath ?? null;
  useEffect(() => {
    if (!wsRoot) { setArch(null); return; }
    primeLayoutSidecar(wsRoot).catch(() => {});
    archModel().then((a) => setArch(a)).catch(() => setArch(null));
    fetchBooks().then((b) => { if (b) setBooks(b); }).catch(() => {});
    listViolations().then((v) => setViolations(v)).catch(() => {});
  }, [wsRoot, setArch, setBooks, setViolations]);

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
      { key: 'arrowup', shift: true, description: 'Nudge up 1px', handler: () => nudgeSelected(0, -1) },
      { key: 'arrowdown', shift: true, description: 'Nudge down 1px', handler: () => nudgeSelected(0, 1) },
      { key: 'arrowleft', shift: true, description: 'Nudge left 1px', handler: () => nudgeSelected(-1, 0) },
      { key: 'arrowright', shift: true, description: 'Nudge right 1px', handler: () => nudgeSelected(1, 0) },
      { key: 'enter', description: 'Open inspector for selected', handler: () => focusInspectorForSelected() },
      { key: 'delete', description: 'Delete selection', handler: () => { deleteSelection(); } },
      { key: 'backspace', description: 'Delete selection', handler: () => { deleteSelection(); } },
      { key: 'f2', description: 'Rename element / edit relationship', handler: () => window.dispatchEvent(new CustomEvent('verso:start-rename')) },
      { key: 'escape', description: 'Clear selection', handler: () => { setHelpOpen(false); clearSelection(); } },
      { key: 'a', primary: true, description: 'Select all elements', handler: () => window.dispatchEvent(new CustomEvent('verso:select-all')) },
      { key: '=', primary: true, description: 'Zoom in', handler: () => window.dispatchEvent(new CustomEvent('verso:zoom', { detail: { dir: 1 } })) },
      { key: '+', primary: true, description: 'Zoom in', handler: () => window.dispatchEvent(new CustomEvent('verso:zoom', { detail: { dir: 1 } })) },
      { key: '-', primary: true, description: 'Zoom out', handler: () => window.dispatchEvent(new CustomEvent('verso:zoom', { detail: { dir: -1 } })) },
      { key: '0', primary: true, description: 'Fit view', handler: () => window.dispatchEvent(new CustomEvent('verso:fit-view')) },
      { key: '1', description: 'Module Map view', handler: () => useApp.getState().setView('moduleMap') },
      { key: '2', description: 'Dependencies view', handler: () => useApp.getState().setView('dependencyGraph') },
      { key: '3', description: 'Concerns view', handler: () => useApp.getState().setView('concerns') },
    ]);
  }, [setPaletteOpen]); // eslint-disable-line react-hooks/exhaustive-deps

  // Delete whatever is selected: shape (presentation only, no confirm), relationship or element
  // (model operations, confirmed first — same flow as the context menu / inspector).
  async function deleteSelection() {
    const st = useApp.getState();
    if (st.selectedShapeId && st.workspace) {
      const viewKey = st.activeCustomViewId ? `custom:${st.activeCustomViewId}` : st.view;
      const next = removeShape(st.shapes[viewKey] ?? [], st.selectedShapeId);
      st.setShapesFor(viewKey, next);
      saveShapes(st.workspace.rootPath, viewKey, next);
      st.selectShape(null);
      st.setToast({ kind: 'info', text: 'Shape removed' });
      return;
    }
    if (st.selectedLinkId) {
      const linkId = st.selectedLinkId;
      const ok = await confirmAction({ title: 'Remove this relationship?', confirmLabel: 'Remove', destructive: true });
      if (!ok) return;
      const r = await applyOperation({ kind: 'RemoveLink', opId: `op_${Date.now()}`, linkId });
      if ('reason' in r) st.setToast({ kind: 'error', text: friendlyOpError(r) });
      else { st.setToast({ kind: 'success', text: 'Relationship removed' }); useApp.getState().selectLink(null); }
      return;
    }
    if (st.selectedElementId) {
      const el = st.arch?.elements.find((x) => x.id === st.selectedElementId);
      if (!el) return;
      const ok = await confirmAction({
        title: `Remove ${el.name}?`,
        body: 'This element will be removed from the model. Linked relationships and decisions will be detached.',
        confirmLabel: 'Remove',
        destructive: true,
      });
      if (!ok) return;
      const r = await applyOperation({ kind: 'RemoveElement', opId: `op_${Date.now()}`, elementId: el.id });
      if ('reason' in r) st.setToast({ kind: 'error', text: friendlyOpError(r) });
      else { st.setToast({ kind: 'success', text: 'Removed' }); useApp.getState().selectElement(null); }
    }
  }

  function clearSelection() {
    const st = useApp.getState();
    st.selectElement(null);
    st.selectLink(null);
    st.selectShape(null);
    // Also clear React Flow's own node/edge highlight, which lives in canvas state.
    window.dispatchEvent(new CustomEvent('verso:clear-selection'));
  }

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
            <ArchOrShapeInspector />
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
