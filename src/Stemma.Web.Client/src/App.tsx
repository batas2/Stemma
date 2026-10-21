import { Suspense, lazy, useEffect, useMemo, useRef, useState } from 'react';
import { reportFailure, ClientEvent } from '@/lib/log';
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
import { ensureConnection, onOperationApplied, onExternalChange, onSidecarChanged, onCommentsChanged, onReconnected, applyOperation, isOwnOperation } from './lib/signalr';
import { modelRefresh, type RefreshScope } from './lib/modelRefresh';
import { friendlyOpError } from './lib/opError';
import { confirmAction } from './components/ConfirmDialog';
import { confirmAndRemoveElements } from './components/removeElements';
import { removeShape, saveShapes } from './lib/shapes';
import { archModel, listViolations, snapshot } from './lib/api';
import { primeLayoutSidecar, rereadLayoutSidecar } from './lib/layout';
import { configureHistory, redo, undo } from './lib/undo';
import { history } from './lib/history';
import { layoutUndo } from './lib/layoutUndo';
import { RenderShell } from './components/RenderShell';
import { currentRenderParams } from './lib/renderMode';
import { ViolationsPanel } from './components/ViolationsPanel';
import { BookFooter } from './components/BookFooter';
import { BookPresenter } from './components/BookPresenter';
import { ConfirmDialog } from './components/ConfirmDialog';
import { PromptDialog } from './components/PromptDialog';
import { ToastQueue } from './components/ToastQueue';
import { TopProgressBar } from './components/LoadingOverlay';
import { bindShortcuts, focusIsOnCanvas, hasTextSelection } from './lib/shortcuts';
import { filterByView } from './lib/viewFilter';
import { hashFor, readHash, placeOf } from './lib/navigation';
import { revealElement } from './lib/canvasReveal';
import { refreshHeadModel, stopCompare } from './lib/compare';
import { CompareBar } from './components/CompareBar';
import { WhatsNew } from './components/WhatsNew';
import { SidecarBanner } from './components/SidecarBanner';

const ShortcutHelp = lazy(() => import('./components/ShortcutHelp').then((m) => ({ default: m.ShortcutHelp })));

/** Renders the shape inspector when a shape is selected; otherwise the arch inspector.
 *  Defined at module scope so it has stable identity across App renders. */
function ArchOrShapeInspector() {
  const selectedShapeId = useApp((s) => s.selectedShapeId);
  const workspace = useApp((s) => s.workspace);
  const customViews = useApp((s) => s.customViews);
  const activeId = useApp((s) => s.activeCustomViewId);
  const view = useApp((s) => s.view);
  if (selectedShapeId && workspace) {
    const activeCustomView = customViews.find((v) => v.id === activeId);
    // The view on screen, as the canvas keys it: a shape on Dependencies is not on the Module Map.
    const layoutKey = activeCustomView ? `custom:${activeCustomView.id}` : view;
    return <ShapeInspector viewKey={layoutKey} workspaceRoot={workspace.rootPath} />;
  }
  return <ArchInspector />;
}

export default function App() {
  // Parsed once: the query string does not change without a reload.
  const renderParams = useMemo(() => currentRenderParams(), []);
  const ws = useApp((s) => s.workspace);
  const view = useApp((s) => s.view);
  const setWs = useApp((s) => s.setWorkspace);
  const setArch = useApp((s) => s.setArch);
  const setView = useApp((s) => s.setView);
  const setViolations = useApp((s) => s.setViolations);

  useEffect(() => {
    ensureConnection().catch(reportFailure('Signalr', ClientEvent.ConnectionLost, 'Opening the live connection'));
    snapshot().then((s) => { if (s) setWs(s); }).catch(reportFailure('Api', ClientEvent.RequestFailed, 'Reading the workspace snapshot'));
    // One read at a time, newest drawn (lib/modelRefresh). An operation this window sent changed the
    // model and nothing else; one from another window, or an undo, may come with more.
    const refresh = (scope: RefreshScope = 'workspace') => modelRefresh.refresh(scope);
    configureHistory();
    const offOp = onOperationApplied((r) => { void refresh(isOwnOperation(r.opId) ? 'model' : 'workspace'); });
    // An edit from outside makes the engine forget what could be redone; so does the journal.
    const offExt = onExternalChange(() => { history.dropRedo(); void refresh(); });
    // A pull or a hand edit changed the sidecar: read it again, with this session's unsent edits laid over it.
    const offSidecar = onSidecarChanged(() => {
      const root = useApp.getState().workspace?.rootPath;
      if (root) rereadLayoutSidecar(root).catch(reportFailure('Sidecar', ClientEvent.RequestFailed, 'Reading the changed layout sidecar'));
    });
    // The comments changed outside: whichever panel is open reads them again.
    const offComments = onCommentsChanged(() => window.dispatchEvent(new Event('stemma:comments-changed')));
    // Back after a drop: nothing announced meanwhile is announced again, so read all of it afresh.
    const offReconnect = onReconnected(() => {
      void refresh();
      const root = useApp.getState().workspace?.rootPath;
      if (root) rereadLayoutSidecar(root).catch(reportFailure('Sidecar', ClientEvent.RequestFailed, 'Reading the layout sidecar after reconnecting'));
      window.dispatchEvent(new Event('stemma:comments-changed'));
    });
    return () => { offOp(); offExt(); offSidecar(); offComments(); offReconnect(); };
  }, [setWs]);

  // Load the active workspace's model + presentation whenever the workspace changes — on the
  // initial snapshot, but also when one is opened from Recents / by path / via Init. Previously
  // only the initial mount fetched these, so opening a workspace mid-session left the canvas
  // empty until a full page reload.
  const wsRoot = ws?.rootPath ?? null;
  // The last commit's model, for the count of uncommitted changes (F-017 AC6): read on open, and again
  // when the window comes back into focus — a commit is usually made from a terminal.
  // Another workspace: none of the steps in the undo history are about it (F-015).
  useEffect(() => {
    history.clear();
    layoutUndo.clear();
  }, [wsRoot]);
  useEffect(() => {
    if (!wsRoot) return;
    void refreshHeadModel();
    const onFocus = () => { void refreshHeadModel(); };
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [wsRoot]);
  useEffect(() => {
    // This workspace's turn: a refresh still on its way for the last one is not drawn over it.
    const current = modelRefresh.claim();
    if (!wsRoot) { setArch(null); return; }
    primeLayoutSidecar(wsRoot).catch(reportFailure('Sidecar', ClientEvent.SidecarWriteFailed, 'Priming the layout sidecar'));
    archModel().then((a) => { if (current()) setArch(a); }).catch(() => { if (current()) setArch(null); });
    listViolations().then((v) => { if (current()) setViolations(v); }).catch(reportFailure('Api', ClientEvent.RequestFailed, 'Loading violations'));
  }, [wsRoot, setArch, setViolations]);

  const setPaletteOpen = useApp((s) => s.setPaletteOpen);
  const rehydratePresentation = useApp((s) => s.rehydratePresentation);

  // When the committed sidecar finishes loading, re-read styles/notes/props/positions from it.
  useEffect(() => {
    function onPrimed() {
      rehydratePresentation();
      // Books live in the sidecar (ADR-0022): read on open, and again whenever it changed outside.
      useApp.getState().reloadBooks();
      window.dispatchEvent(new CustomEvent('stemma:layout-changed', { detail: { viewKey: 'all' } }));
      window.dispatchEvent(new CustomEvent('stemma:notes-changed'));
    }
    window.addEventListener('stemma:sidecar-primed', onPrimed);
    return () => window.removeEventListener('stemma:sidecar-primed', onPrimed);
  }, [rehydratePresentation]);

  const presenting = useApp((s) => s.presenting);
  // The PDF export takes its pictures with the chrome out of the way too, so a page is as large as
  // it is when presented rather than squeezed above the editor.
  const capturing = useApp((s) => s.capturing);
  const bare = presenting || capturing;

  useEffect(() => {
    return bindShortcuts([
      { key: 'z', primary: true, description: 'Undo', handler: () => { void undo(); } },
      { key: 'z', primary: true, shift: true, description: 'Redo', handler: () => { void redo(); } },
      { key: 'y', primary: true, description: 'Redo', handler: () => { void redo(); } },
      { key: 'k', primary: true, description: 'Command palette', handler: () => setPaletteOpen(true) },
      // Copy and paste (F-015). ⌘C leaves selected text to the browser; the ⌥ pair names the key,
      // because ⌥ changes the letter it types.
      { key: 'c', primary: true, description: 'Copy', when: () => !hasTextSelection(), handler: () => fire('stemma:copy') },
      { key: 'v', primary: true, description: 'Paste', handler: () => fire('stemma:paste') },
      { key: 'd', primary: true, description: 'Duplicate', handler: () => fire('stemma:duplicate') },
      { key: 'c', code: 'KeyC', primary: true, alt: true, description: 'Copy style', handler: () => fire('stemma:copy-style') },
      { key: 'v', code: 'KeyV', primary: true, alt: true, description: 'Paste style', handler: () => fire('stemma:paste-style') },
      { key: '/', description: 'Focus search', handler: () => focusSidebarSearch() },
      { key: '?', shift: true, description: 'Show keyboard shortcuts', handler: () => setHelpOpen((v) => !v) },
      { key: 'tab', description: 'Cycle elements', when: focusIsOnCanvas, handler: () => cycleElement(1) },
      { key: 'tab', shift: true, description: 'Cycle elements (back)', when: focusIsOnCanvas, handler: () => cycleElement(-1) },
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
      { key: 'f2', description: 'Rename element / edit relationship', handler: () => window.dispatchEvent(new CustomEvent('stemma:start-rename')) },
      {
        key: 'escape', description: 'Clear selection',
        handler: () => {
          setHelpOpen(false);
          const st = useApp.getState();
          // The most passing thing goes first: an open find bar, then a comparison, then the selection.
          if (st.find.open) { st.setFind({ open: false, query: '' }); return; }
          // With nothing selected, Escape ends a comparison (F-017); otherwise it clears the selection first.
          if (st.compare && !st.selectedElementId && !st.selectedLinkId && !st.selectedShapeId && st.canvasSelection === 0) { stopCompare(); return; }
          clearSelection();
        },
      },
      { key: 'a', primary: true, description: 'Select all elements', handler: () => window.dispatchEvent(new CustomEvent('stemma:select-all')) },
      { key: '=', primary: true, description: 'Zoom in', handler: () => window.dispatchEvent(new CustomEvent('stemma:zoom', { detail: { dir: 1 } })) },
      { key: '+', primary: true, description: 'Zoom in', handler: () => window.dispatchEvent(new CustomEvent('stemma:zoom', { detail: { dir: 1 } })) },
      { key: '-', primary: true, description: 'Zoom out', handler: () => window.dispatchEvent(new CustomEvent('stemma:zoom', { detail: { dir: -1 } })) },
      { key: '0', primary: true, description: 'Fit view', handler: () => window.dispatchEvent(new CustomEvent('stemma:fit-view')) },
      // Find on this view (F-018): the bar opens, or takes the focus again when it is open.
      {
        key: 'f', primary: true, description: 'Find on this view',
        handler: () => {
          if (useApp.getState().view === 'concerns') return;
          useApp.getState().setFind({ open: true });
          window.dispatchEvent(new CustomEvent('stemma:find'));
        },
      },
      // Back and forward through the views visited (F-016), as in a browser or a file manager.
      { key: '[', primary: true, description: 'Back', handler: () => useApp.getState().goBack() },
      { key: ']', primary: true, description: 'Forward', handler: () => useApp.getState().goForward() },
      { key: '1', description: 'Module Map view', handler: () => useApp.getState().setView('moduleMap') },
      { key: '2', description: 'Dependencies view', handler: () => useApp.getState().setView('dependencyGraph') },
      { key: '3', description: 'Concerns view', handler: () => useApp.getState().setView('concerns') },
    ]);
  }, [setPaletteOpen]); // eslint-disable-line react-hooks/exhaustive-deps

  function fire(name: string) { window.dispatchEvent(new CustomEvent(name)); }

  // Delete whatever is selected: shape (presentation only, no confirm), relationship or element
  // (model operations, confirmed first — same flow as the context menu / inspector).
  async function deleteSelection() {
    const st = useApp.getState();
    if (st.selectedShapeId && st.workspace) {
      const viewKey = st.activeCustomViewId ? `custom:${st.activeCustomViewId}` : st.view;
      const next = removeShape(st.shapes[viewKey] ?? [], st.selectedShapeId);
      st.setShapesFor(viewKey, next);
      saveShapes(st.workspace.rootPath, viewKey, next, 'Delete shape');
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
    // Every selected box — a marquee selects without the inspector showing one — or the one shown.
    const ids = st.canvasSelectedIds.length > 0 ? st.canvasSelectedIds : st.selectedElementId ? [st.selectedElementId] : [];
    if (ids.length > 0) await confirmAndRemoveElements(ids);
  }

  function clearSelection() {
    const st = useApp.getState();
    st.selectElement(null);
    st.selectLink(null);
    st.selectShape(null);
    // Also clear React Flow's own node/edge highlight, which lives in canvas state.
    window.dispatchEvent(new CustomEvent('stemma:clear-selection'));
  }

  function focusSidebarSearch() {
    const input = document.querySelector('aside input[placeholder*="Search"]') as HTMLInputElement | null;
    input?.focus();
  }

  function focusInspectorForSelected() {
    const aside = document.querySelector('aside.shrink-0') as HTMLElement | null;
    aside?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  // Tab walks the cards on screen, in reading order by name — not every element of the model, most of
  // which a given view does not draw.
  function cycleElement(direction: 1 | -1) {
    const st = useApp.getState();
    if (!st.arch) return;
    const custom = st.customViews.find((v) => v.id === st.activeCustomViewId) ?? null;
    const drawn = filterByView(st.arch, st.view, custom).elements;
    if (drawn.length === 0) return;
    const ids = [...drawn].sort((a, b) => a.name.localeCompare(b.name)).map((e) => e.id);
    const cur = st.selectedElementId;
    const idx = cur ? ids.indexOf(cur) : -1;
    const next = ids[((idx + direction) + ids.length) % ids.length];
    st.selectElement(next);
    window.dispatchEvent(new CustomEvent('stemma:focus-node', { detail: { nodeId: next } }));
  }

  function nudgeSelected(dx: number, dy: number) {
    const id = useApp.getState().selectedElementId;
    const ws = useApp.getState().workspace;
    if (!id || !ws) return;
    window.dispatchEvent(new CustomEvent('stemma:nudge', { detail: { nodeId: id, dx, dy } }));
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
  // Where the address said to go when the page loaded (F-016 AC6), honoured once the model is in.
  const pendingAddress = useRef(typeof window !== 'undefined' ? readHash(window.location.hash) : { view: null, select: null });
  useEffect(() => {
    if (!ws) { initialisedFor.current = null; return; }
    if (initialisedFor.current === ws.rootPath) return;
    initialisedFor.current = ws.rootPath;
    setView('moduleMap');
    // Opening is not a visit: there is nothing to go back to yet.
    useApp.setState({ trail: { back: [], forward: [] } });
  }, [ws]); // eslint-disable-line react-hooks/exhaustive-deps

  const arch = useApp((s) => s.arch);
  const customViews = useApp((s) => s.customViews);
  useEffect(() => {
    const wanted = pendingAddress.current;
    if (!arch || (!wanted.view && !wanted.select)) return;
    const viewKnown = !wanted.view || ['moduleMap', 'dependencyGraph', 'concerns'].includes(wanted.view) || customViews.some((v) => v.id === wanted.view);
    // A view from Views/ arrives with the views list, a moment after the model; wait for it.
    if (!viewKnown && customViews.length === 0) return;
    pendingAddress.current = { view: null, select: null };
    if (wanted.view && viewKnown) useApp.getState().goTo(placeOf(wanted.view));
    useApp.setState({ trail: { back: [], forward: [] } });
    if (wanted.select && arch.elements.some((e) => e.id === wanted.select)) {
      const id = wanted.select;
      setTimeout(() => revealElement(id), 50);
    }
  }, [arch, customViews]);

  // The address follows the view and the selection, so a reload comes back to the same place. Replaced,
  // not pushed: the browser's own history is not where Stemma keeps its trail.
  useEffect(() => useApp.subscribe((s, prev) => {
    if (s.view === prev.view && s.activeCustomViewId === prev.activeCustomViewId && s.selectedElementId === prev.selectedElementId) return;
    if (!s.workspace || s.presenting || currentRenderParams()) return;
    const next = hashFor({ view: s.view, customViewId: s.activeCustomViewId }, s.selectedElementId);
    if (window.location.hash !== next) window.history.replaceState(null, '', next);
  }), []);

  useEffect(() => {
    const show = () => setHelpOpen(true);
    window.addEventListener('stemma:show-shortcuts', show);
    return () => window.removeEventListener('stemma:show-shortcuts', show);
  }, []);

  const [whatsNewOpen, setWhatsNewOpen] = useState(false);
  useEffect(() => {
    const show = () => setWhatsNewOpen(true);
    window.addEventListener('stemma:whats-new', show);
    return () => window.removeEventListener('stemma:whats-new', show);
  }, []);

  // Headless render mode strips every affordance meant for a person and reports when the canvas
  // has settled. Declared after all hooks so hook order is identical in both modes.
  if (renderParams) return <RenderShell params={renderParams} />;

  return (
    <div className="h-screen flex flex-col">
      <a href="#stemma-canvas" className="skip-link">Skip to canvas</a>
      <TopProgressBar />
      {/* Presenting, the diagram is the whole window: everything meant for editing steps aside. */}
      {!bare && <Topbar />}
      <div className="flex-1 flex min-h-0">
        {ws ? (
          <>
            {!bare && <Sidebar />}
            <main id="stemma-canvas" tabIndex={-1} role="main" aria-label="Canvas" className="flex-1 min-w-0 flex flex-col">
              {!bare && <SidecarBanner />}
              <div className="flex-1 min-h-0 relative">
                {view === 'concerns' ? <ConcernsView /> : <ArchCanvas />}
                {view !== 'concerns' && <CompareBar />}
                {presenting && <BookPresenter />}
              </div>
            </main>
            {!bare && <ArchOrShapeInspector />}
          </>
        ) : (
          <EmptyState />
        )}
      </div>
      {ws && !bare && <ViewTabs />}
      {!bare && <BookFooter />}
      {!bare && <ViolationsPanel />}
      {!bare && <StatusBar />}
      <CommandPalette />
      <Suspense fallback={null}>
        <ShortcutHelp open={helpOpen} onClose={() => setHelpOpen(false)} />
      </Suspense>
      <WhatsNew open={whatsNewOpen} onClose={() => { setWhatsNewOpen(false); window.dispatchEvent(new Event('stemma:whats-new-seen')); }} />
      <ConfirmDialog />
      <PromptDialog />
      <ToastQueue />
      <ConnectionIndicator />
    </div>
  );
}
