import { useMemo, useEffect, useState, useCallback, useRef, useDeferredValue } from 'react';
import { reportFailure, ClientEvent } from '@/lib/log';
import clsx from 'clsx';
import {
  ReactFlow,
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  type Node,
  type Edge,
  type NodeChange,
  applyNodeChanges,
  ConnectionMode,
  ReactFlowProvider,
  useReactFlow,
  type NodeMouseHandler,
  type EdgeMouseHandler,
  type EdgeMarker,
  type Connection,
  MarkerType,
  ViewportPortal,
  getNodesBounds,
  getViewportForBounds,
  type FitViewOptions,
} from '@xyflow/react';
import { ArchNodeView } from './nodes/ArchNodeView';
import { WaypointEdge } from './edges/WaypointEdge';
import { EdgeMarkerDefs, customMarkerId, type CustomMarker } from './edges/EdgeMarkerDefs';
import { LAYOUT_ACTION_EVENT, type LayoutAction } from './LayoutPanel';
import { ShapeLayer } from './ShapeLayer';
import { ViewHeader, viewHeaderHeight } from './ViewHeader';
import { currentRenderParams } from '@/lib/renderMode';
import type { DrawnView } from '@/lib/viewHeader';
import { StencilDrawer } from './StencilDrawer';
import { loadShapes, primeShapeCache, type Shape } from '@/lib/shapes';
import { resolveExportOptions, exportFileName, type ExportRequest } from '@/lib/exportImage';
import { resolveLayout, offsetForDrag, constraintIds } from '@/lib/layoutDsl';
import { linkLabel, linkLabelField, linkIsDashedByDefault, LINK_FIELD_LABEL } from '@/lib/linkLabel';
import { sizesFor } from '@/lib/textMetrics';

/** Bounding box of a shape (for the "fit everything" image export). */
function shapeBoundsRect(s: Shape): { x: number; y: number; width: number; height: number } | null {
  if (s.kind === 'rect' || s.kind === 'ellipse' || s.kind === 'triangle' || s.kind === 'image') {
    return { x: s.x, y: s.y, width: s.w, height: s.h };
  }
  if (s.kind === 'label') return { x: s.x, y: s.y - 14, width: 140, height: 24 };
  if (s.kind === 'arrow') {
    return { x: Math.min(s.fromX, s.toX), y: Math.min(s.fromY, s.toY), width: Math.abs(s.toX - s.fromX) || 1, height: Math.abs(s.toY - s.fromY) || 1 };
  }
  return null;
}

type Rect = { x: number; y: number; width: number; height: number };

function unionRects(rects: Rect[]): Rect {
  const minX = Math.min(...rects.map((r) => r.x)), minY = Math.min(...rects.map((r) => r.y));
  const maxX = Math.max(...rects.map((r) => r.x + r.width)), maxY = Math.max(...rects.map((r) => r.y + r.height));
  return { x: minX, y: minY, width: Math.max(1, maxX - minX), height: Math.max(1, maxY - minY) };
}

/**
 * Padding for a fit that leaves the view's header free (F-014): the header covers the top of the
 * canvas, so what is framed starts below it. Without a header, the plain fraction.
 */
function paddingUnderHeader(fraction: number): NonNullable<FitViewOptions['padding']> {
  const header = viewHeaderHeight();
  if (header === 0) return fraction;
  return { top: `${header + 24}px`, bottom: fraction, left: fraction, right: fraction };
}

/** Approximate box rect of a node, for picking dock dots (uses measured size when available). */
function nodeRect(n: Node): DockRect {
  const w = n.measured?.width ?? (n.style?.width as number | undefined) ?? 220;
  const h = n.measured?.height ?? (n.style?.height as number | undefined) ?? 120;
  return { x: n.position.x, y: n.position.y, w, h };
}
import { ContextMenu, ContextIcons, type ContextMenuState } from './ContextMenu';
import { EmptyCanvasGuide } from './EmptyCanvasGuide';
import { FirstElementStrip } from './FirstElementStrip';
import { elementSource, type DeclarationSource } from '@/lib/api';
import {
  hasSeenFirstElementExplainer, markFirstElementExplained,
  shouldExplainFirstElement, shouldShowEmptyCanvasGuide,
} from '@/lib/onboarding';
import { confirmAction } from './ConfirmDialog';
import { promptText, pickFromList } from './PromptDialog';
import { suggestElementName } from '@/lib/naming';
import { revealNewElement, revealToast } from '@/lib/canvasReveal';
import {
  buildClip, clipText, heldClip, heldStyleFor, holdClip, holdStyle, lookOf, nextPasteCount, pasteLook,
  pasteOrigin, planPaste, CASCADE, type Clip, type Point,
} from '@/lib/clipboard';
import { executePaste } from '@/lib/paste';
import { focusIsOnCanvas, keyBelongsToFocus, SHORTCUT_HINTS } from '@/lib/shortcuts';
import { history, type PresentationChange } from '@/lib/history';
import { viewRendersKind } from '@/lib/lenses';
import { positionsAt, sizesAt, useCompareDiff } from '@/lib/compare';
import { kindLabel } from '@/lib/modelDiff';
import { facets as findFacets, matches as findMatchesCard, parseQuery, spotlightLighting, type CardFacts } from '@/lib/spotlight';
import { FindBar } from './FindBar';
import { useApp, activePage } from '@/lib/store';
import { stepMark, stepsLit, viewKeyOf } from '@/lib/books';
import { frameDuration, pageLighting, prefersReducedMotion } from '@/lib/bookFrame';
import { addedId, applyOperation, fetchUndoState } from '@/lib/signalr';
import { friendlyOpError } from '@/lib/opError';
import { relink } from '@/lib/relink';
import { applyOrSay } from '@/lib/applyOp';
import { confirmAndRemoveElements } from './removeElements';
import { isSidecarPrimed, loadLayout, saveLayout, loadEdgeWaypoints, saveEdgeWaypoints, loadEdgeHandles, saveEdgeHandles, loadViewConstraint, loadViewOffsets, saveViewOffset, type EdgeHandlePair, type SavedPosition } from '@/lib/layout';
import { autoDock, type DockId, type DockRect } from '@/lib/edgeDock';
import { loadNote, loadNotes, saveNote } from '@/lib/elementNotes';
import { hashtagProps } from '@/lib/hashtags';
import { layoutUndo, diffPositions, isEmptyDiff } from '@/lib/layoutUndo';
import {
  layoutHierarchical, layoutForceDirected, layoutFocused, layoutByType,
  alignSelected, distributeSelected,
  type LayoutAlgorithm,
} from '@/lib/autoLayout';
import { dashArrayFor, DEFAULT_EDGE_STYLE, type EdgeArrow } from '@/lib/edgeStyles';
import { type RelationshipType } from '@/lib/relationshipTypes';

/** React Flow's default edge stroke — markers must carry an explicit colour because RF renders
 *  a built-in marker with `color: undefined` as stroke/fill "none", i.e. an invisible arrowhead. */
const DEFAULT_MARKER_COLOR = '#b1b1b7';

/** Resolve an endpoint style to a React Flow marker. Common arrows use built-in (reliably
 *  coloured) markers; the exotic shapes use the custom SVG markers in EdgeMarkerDefs. */
function edgeMarkerSpec(a: EdgeArrow | undefined, color?: string): EdgeMarker | string | undefined {
  const c = color ?? DEFAULT_MARKER_COLOR;
  switch (a) {
    case 'closed': return { type: MarkerType.ArrowClosed, color: c, width: 18, height: 18 };
    case 'open': return { type: MarkerType.Arrow, color: c, width: 18, height: 18 };
    case 'circle': case 'diamond': case 'pipe': return `url(#${customMarkerId(a, color)})`;
    default: return undefined; // 'none' / unset
  }
}
import type { ArchElement, ArchElementKind, OperationEnvelope, ViewKind } from '@/lib/types';
import { filterByView } from '@/lib/viewFilter';

const nodeTypes = { arch: ArchNodeView };
const edgeTypes = { waypointed: WaypointEdge };

/** Equal by value: a model refresh brings new objects for elements and tags that have not changed. */
function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  return JSON.stringify(a) === JSON.stringify(b);
}

/** Whether a rebuilt card says nothing the card on screen does not: same place, state, size and data. */
function sameNode(a: Node, b: Node): boolean {
  if (a.position.x !== b.position.x || a.position.y !== b.position.y) return false;
  if (a.selected !== b.selected || a.draggable !== b.draggable || a.type !== b.type) return false;
  if (!sameValue(a.style, b.style)) return false;
  const ad = a.data as Record<string, unknown>;
  const bd = b.data as Record<string, unknown>;
  for (const key of Object.keys(bd)) if (!sameValue(ad[key], bd[key])) return false;
  return Object.keys(ad).length === Object.keys(bd).length;
}

const LAYOUT_LABEL: Record<LayoutAlgorithm, string> = {
  hierarchical: 'hierarchical', force: 'force-directed',
  focused: 'focused', byType: 'architectural (by type)',
};

function defaultPositions(elements: ArchElement[]): Record<string, SavedPosition> {
  return layoutHierarchical(elements, []);
}

// Bounded-Context container geometry: padding around the contained modules + a header strip.
const BC_PAD = 26;
const BC_HEADER = 26;

/** Best-effort rendered size of a node: explicit style → user resize → measured DOM → default. */
function nodeSize(n: Node): { w: number; h: number } {
  const style = n.style as { width?: number; height?: number } | undefined;
  const ns = (n.data as { nodeStyle?: { width?: number; height?: number } }).nodeStyle;
  const measured = (n as { measured?: { width?: number; height?: number } }).measured;
  const w = (typeof style?.width === 'number' ? style.width : undefined) ?? ns?.width ?? measured?.width ?? 200;
  const h = (typeof style?.height === 'number' ? style.height : undefined) ?? ns?.height ?? measured?.height ?? 92;
  return { w, h };
}

/** Bounding box (with BC padding + header) around a set of child nodes. */
function boundingBox(kids: Node[]): { x: number; y: number; w: number; h: number } {
  let l = Infinity, t = Infinity, r = -Infinity, b = -Infinity;
  for (const k of kids) {
    const { w, h } = nodeSize(k);
    l = Math.min(l, k.position.x);
    t = Math.min(t, k.position.y);
    r = Math.max(r, k.position.x + w);
    b = Math.max(b, k.position.y + h);
  }
  return { x: l - BC_PAD, y: t - BC_PAD - BC_HEADER, w: (r - l) + BC_PAD * 2, h: (b - t) + BC_PAD * 2 + BC_HEADER };
}

type Box = { x: number; y: number; w: number; h: number };

/** Bounding boxes of every Bounded Context that owns modules, keyed by BC id. `excludeId`
 *  drops one node from the calculation (used while dragging it out of its own box). */
function bcBoxes(nodes: Node[], excludeId?: string): Map<string, Box> {
  const bcIds = new Set(
    nodes.filter((n) => (n.data as { element?: ArchElement }).element?.kind === 'boundedContext').map((n) => n.id),
  );
  const byCtx = new Map<string, Node[]>();
  for (const n of nodes) {
    if (n.id === excludeId) continue;
    const el = (n.data as { element?: ArchElement }).element;
    if (!el || el.kind !== 'module') continue;
    const ctx = el.attributes.contextId ?? undefined;
    if (!ctx || !bcIds.has(ctx)) continue;
    (byCtx.get(ctx) ?? byCtx.set(ctx, []).get(ctx)!).push(n);
  }
  const out = new Map<string, Box>();
  for (const [ctx, kids] of byCtx) out.set(ctx, boundingBox(kids));
  return out;
}

/** What an exported picture of the canvas leaves out: its controls, not its content. */
function notCanvasChrome(node: HTMLElement): boolean {
  const cl = (node as Element).classList;
  return !(cl && (cl.contains('react-flow__controls') || cl.contains('react-flow__minimap') || cl.contains('react-flow__attribution') || cl.contains('react-flow__panel')));
}

/** The id of the BC whose box contains point `p`, or null. */
function bcAtPoint(boxes: Map<string, Box>, p: { x: number; y: number }): string | null {
  for (const [id, b] of boxes) {
    if (p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h) return id;
  }
  return null;
}

/** Each view's last pan and zoom this session, keyed by workspace and view (F-016 AC5). */
const viewportMemory = new Map<string, { x: number; y: number; zoom: number }>();

function CanvasInner() {
  const arch = useApp((s) => s.arch);
  const view = useApp((s) => s.view);
  const customViews = useApp((s) => s.customViews);
  const activeId = useApp((s) => s.activeCustomViewId);
  // Only the folder, as an object that stays the same while the folder does. Each refresh after an edit
  // replaces the store's workspace with a new object, and with it as a dependency every card and every
  // arrow was rebuilt after every edit — a rename took up to 1.9 s to show on a 300-box model.
  const rootPath = useApp((s) => s.workspace?.rootPath ?? null);
  const workspace = useMemo(() => (rootPath ? { rootPath } : null), [rootPath]);
  const theme = useApp((s) => s.theme);
  const snapEnabled = useApp((s) => s.snapEnabled);
  const edgeStyles = useApp((s) => s.edgeStyles);
  const nodeStyles = useApp((s) => s.nodeStyles);
  const customProps = useApp((s) => s.customProps);
  const violations = useApp((s) => s.violations);
  const select = useApp((s) => s.selectElement);
  const selectLink = useApp((s) => s.selectLink);
  const selectedLinkId = useApp((s) => s.selectedLinkId);
  const setToast = useApp((s) => s.setToast);
  const addElementToActiveView = useApp((s) => s.addElementToActiveView);
  const { fitView, screenToFlowPosition, getNodes, getViewport, setViewport, zoomIn, zoomOut } = useReactFlow();
  const wrapperRef = useRef<HTMLDivElement>(null);

  const activeCustomView = customViews.find((v) => v.id === activeId) ?? null;
  const layoutKey = activeCustomView ? `custom:${activeCustomView.id}` : view;

  // Books (F-013). A page lights and frames the canvas only on the view it is about: open another
  // view while editing a book and the canvas is that view, untouched.
  const presenting = useApp((s) => s.presenting);
  const capturing = useApp((s) => s.capturing);
  const activeBookId = useApp((s) => s.activeBookId);
  const openPage = useApp(activePage);
  const bookPage = openPage && viewKeyOf(openPage.view) === layoutKey ? openPage : null;
  // Keyed on what lights the page, not on the page: typing its narrative makes a new page object on
  // every keystroke, and re-lighting the whole canvas for each one is work for nothing.
  const focusKey = bookPage ? bookPage.focus.join('\u0000') : null;
  const pageLit = useMemo(
    () => (bookPage && arch ? pageLighting(bookPage, arch.elements) : null),
    [focusKey, arch], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const pageHides = bookPage?.others === 'hide';
  // F-020: a page's steps. The ones reached so far light their two ends and wear their number; the
  // last one reached is the one being talked about. Captured for the PDF, the whole flow is lit.
  const activeStep = useApp((s) => s.activeStep);
  const stepState = useMemo(
    () => (bookPage ? stepsLit(bookPage, activeStep, capturing) : { shown: [], current: null }),
    [bookPage, activeStep, capturing],
  );
  const stepNumber = useMemo(() => new Map(stepState.shown.map((st, i) => [st.link, i + 1])), [stepState]);
  const stepLit = useMemo(() => {
    if (!arch || stepState.shown.length === 0) return null;
    const ids = new Set<string>(pageLit ?? []);
    const links = new Map(arch.links.map((l) => [l.id, l]));
    const elements = new Map(arch.elements.map((e) => [e.id, e]));
    for (const st of stepState.shown) {
      const l = links.get(st.link);
      if (!l) continue;
      for (const id of [l.fromId, l.toId]) {
        ids.add(id);
        const ctx = elements.get(id)?.attributes.contextId;
        if (ctx) ids.add(ctx);
      }
    }
    return ids;
  }, [arch, stepState, pageLit]);
  const readOnly = presenting || capturing;
  // Read by the ordinary fit-on-open, which must not fight the page's own framing.
  const bookPageApplies = useRef(false);
  bookPageApplies.current = bookPage !== null;
  // Free-form annotations (frames / text / shapes) are available on every view now — they live in
  // the committed sidecar keyed by view, so they travel with the repo and never touch the model.
  const shapesEnabled = !!workspace;
  // `stemma render` draws a figure, and a figure takes its caption from the document it is placed in.
  const renderMode = useMemo(() => currentRenderParams() !== null, []);

  /**
   * Frame the whole view — its cards and its annotations — under its header. A view's frames,
   * zones and legends are part of the picture, so a fit that saw only the cards cut them off.
   */
  const fitWholeView = useCallback((padding: NonNullable<FitViewOptions['padding']>, duration: number, maxZoom = 2.5) => {
    const rfEl = wrapperRef.current?.querySelector('.react-flow') as HTMLElement | null;
    const ns = getNodes().filter((n) => !n.hidden);
    // Before React Flow has measured the cards their bounds are guesses; its own fit waits for them.
    if (ns.some((n) => !n.measured?.width)) { fitView({ padding, duration, maxZoom }); return; }
    const rects: Rect[] = ns.length ? [getNodesBounds(ns)] : [];
    for (const s of (useApp.getState().shapes[layoutKey] ?? [])) {
      const b = shapeBoundsRect(s);
      if (b) rects.push(b);
    }
    if (!rfEl || rects.length === 0) return;
    const vp = getViewportForBounds(unionRects(rects), rfEl.clientWidth, rfEl.clientHeight, 0.05, maxZoom, padding);
    setViewport(vp, { duration });
  }, [getNodes, setViewport, fitView, layoutKey]);

  const depKindFilter = useApp((s) => s.depKindFilter);
  const depFocusMode = useApp((s) => s.depFocusMode);
  const depDepth = useApp((s) => s.depDepth);
  const selectedElementId = useApp((s) => s.selectedElementId);
  const collapsedBcs = useApp((s) => s.collapsedBcs);
  const toggleBcCollapsed = useApp((s) => s.toggleBcCollapsed);

  // Bumped when an element's notes change, so the on-node text preview re-reads localStorage.
  const [notesVersion, setNotesVersion] = useState(0);
  useEffect(() => {
    function bump() { setNotesVersion((v) => v + 1); }
    window.addEventListener('stemma:notes-changed', bump);
    return () => window.removeEventListener('stemma:notes-changed', bump);
  }, []);

  // Modules hidden because their Bounded Context is collapsed — used to hide both the nodes
  // and any edges touching them.
  const hiddenIds = useMemo(() => {
    const hidden = new Set<string>();
    if (!arch || collapsedBcs.size === 0) return hidden;
    const present = new Set(arch.elements.map((e) => e.id));
    for (const e of arch.elements) {
      const ctx = e.attributes.contextId;
      if (e.kind === 'module' && ctx && collapsedBcs.has(ctx) && present.has(ctx)) hidden.add(e.id);
    }
    return hidden;
  }, [arch, collapsedBcs]);

  const filtered = useMemo(() => {
    const base = arch ? filterByView(arch, view, activeCustomView) : { elements: [], links: [] };
    // Dependency view supports a per-kind filter so architects can mute "uses" while focusing on
    // "calls" / "consumes" without leaving the canvas.
    if (view !== 'dependencyGraph' || !depKindFilter) return base;
    const links = base.links.filter((l) => l.kind !== 'dependency' || depKindFilter.has(l.attributes.kind ?? 'uses'));
    return { ...base, links };
  }, [arch, view, activeCustomView, depKindFilter]);

  // What the view draws, for its header's legend (F-014): the cards and links on screen, as styled.
  const drawn = useMemo<DrawnView>(() => ({
    elements: filtered.elements.filter((e) => !hiddenIds.has(e.id)),
    links: filtered.links.filter((l) => !hiddenIds.has(l.fromId) && !hiddenIds.has(l.toId)),
    tags: arch?.tags ?? [],
    nodeStyles,
    edgeStyles,
  }), [filtered, hiddenIds, arch?.tags, nodeStyles, edgeStyles]);
  const viewName = activeCustomView?.name ?? (view === 'dependencyGraph' ? 'Dependencies' : 'Module Map');

  /**
   * Fan-in / fan-out for the dependency view, computed off the *unfiltered* arch so the badge
   * always reflects the architect's intent — not whatever they happen to be filtering today.
   */
  const fanCounts = useMemo(() => {
    const map = new Map<string, { in: number; out: number }>();
    if (view !== 'dependencyGraph' || !arch) return map;
    for (const e of filtered.elements) map.set(e.id, { in: 0, out: 0 });
    for (const l of arch.links) {
      if (l.kind !== 'dependency') continue;
      const o = map.get(l.fromId);
      const i = map.get(l.toId);
      if (o) o.out++;
      if (i) i.in++;
    }
    return map;
  }, [view, arch, filtered.elements]);

  /**
   * Focus mode — given the selected element, the related set is the union of:
   *   - the element itself,
   *   - everything it directly depends on (out-edges, up to depDepth hops),
   *   - everything that depends on it (in-edges, up to depDepth hops),
   *   - the BoundedContext that owns it (so the BC backdrop stays lit).
   * Returns null when the user has selected nothing — caller treats null as "no dimming".
   */
  const focusSet = useMemo<Set<string> | null>(() => {
    if (view !== 'dependencyGraph' || !depFocusMode || !arch) return null;
    const seed = selectedElementId;
    if (!seed) return null;
    const out = new Map<string, string[]>();
    const inMap = new Map<string, string[]>();
    for (const l of arch.links) {
      if (l.kind !== 'dependency') continue;
      if (depKindFilter && !depKindFilter.has(l.attributes.kind ?? 'uses')) continue;
      (out.get(l.fromId) ?? out.set(l.fromId, []).get(l.fromId)!).push(l.toId);
      (inMap.get(l.toId) ?? inMap.set(l.toId, []).get(l.toId)!).push(l.fromId);
    }
    const visited = new Set<string>([seed]);
    function walk(start: string, edges: Map<string, string[]>, depth: number) {
      let frontier = [start];
      for (let d = 0; d < depth; d++) {
        const next: string[] = [];
        for (const id of frontier) {
          const adj = edges.get(id) ?? [];
          for (const n of adj) if (!visited.has(n)) { visited.add(n); next.push(n); }
        }
        frontier = next;
        if (frontier.length === 0) break;
      }
    }
    walk(seed, out, depDepth);
    walk(seed, inMap, depDepth);
    // Always include the seed's containing BC (so its backdrop doesn't dim).
    const seedEl = arch.elements.find((e) => e.id === seed);
    const ctxId = seedEl?.attributes?.contextId;
    if (ctxId) visited.add(ctxId);
    return visited;
  }, [view, depFocusMode, arch, depKindFilter, depDepth, selectedElementId]);

  const [edgeWaypoints, setEdgeWaypoints] = useState<Record<string, SavedPosition[]>>({});
  useEffect(() => {
    if (!workspace) { setEdgeWaypoints({}); return; }
    setEdgeWaypoints(loadEdgeWaypoints(workspace.rootPath, layoutKey as ViewKind));
    function refresh() {
      if (!workspace) return;
      setEdgeWaypoints(loadEdgeWaypoints(workspace.rootPath, layoutKey as ViewKind));
    }
    window.addEventListener('stemma:layout-changed', refresh);
    return () => window.removeEventListener('stemma:layout-changed', refresh);
  }, [workspace, layoutKey, view, activeId]);

  // The bends as last set, for handlers that change them: written and recorded once per gesture, not
  // inside a state updater React may run twice.
  const waypointsNow = useRef(edgeWaypoints);
  waypointsNow.current = edgeWaypoints;
  const changeWaypoints = useCallback((edgeId: string, change: (current: SavedPosition[]) => SavedPosition[], description: string) => {
    if (!workspace) return;
    const current = waypointsNow.current[edgeId] ?? [];
    const next = change(current);
    waypointsNow.current = { ...waypointsNow.current, [edgeId]: next };
    setEdgeWaypoints(waypointsNow.current);
    saveEdgeWaypoints(workspace.rootPath, layoutKey as ViewKind, edgeId, next);
    history.recordPresentation([{ section: 'waypoints', id: edgeId, view: String(layoutKey), before: current, after: next }], description);
  }, [workspace, layoutKey]);

  const handleAddWaypoint = useCallback((edgeId: string, point: SavedPosition) => {
    changeWaypoints(edgeId, (current) => [...current, point], 'Add bend');
  }, [changeWaypoints]);

  const handleRemoveWaypoint = useCallback((edgeId: string, index: number) => {
    changeWaypoints(edgeId, (current) => current.filter((_, i) => i !== index), 'Remove bend');
  }, [changeWaypoints]);

  // ---- Dock handles: which of the 6 connection dots each relationship anchors to. A user's
  // explicit choice (drawing / reconnecting) is persisted and always wins; otherwise an auto dock
  // is computed once per edge from geometry (see the effect below) so it never churns as boxes move.
  const [edgeHandles, setEdgeHandles] = useState<Record<string, EdgeHandlePair>>({});
  const [autoDocks, setAutoDocks] = useState<Record<string, { source: DockId; target: DockId }>>({});
  // Dots chosen while drawing/reconnecting, waiting for the engine-assigned link id to come back.
  const pendingDock = useRef<{ from: string; to: string; handles: EdgeHandlePair }[]>([]);
  useEffect(() => {
    if (!workspace) { setEdgeHandles({}); return; }
    setEdgeHandles(loadEdgeHandles(workspace.rootPath, layoutKey as ViewKind));
    function refresh() {
      if (!workspace) return;
      setEdgeHandles(loadEdgeHandles(workspace.rootPath, layoutKey as ViewKind));
    }
    window.addEventListener('stemma:layout-changed', refresh);
    return () => window.removeEventListener('stemma:layout-changed', refresh);
  }, [workspace, layoutKey, view, activeId]);

  // ---- Inline payload/kind editing: double-click a relationship (or its label) to edit the
  // payload (data flow) / kind (dependency) in place. The draft lives in the store so the
  // inspector's field mirrors every keystroke, and vice versa.
  const linkDraft = useApp((s) => s.linkDraft);
  const [editingEdgeId, setEditingEdgeId] = useState<string | null>(null);

  const startEdgeEdit = useCallback((edgeId: string) => {
    const link = useApp.getState().arch?.links.find((l) => l.id === edgeId);
    if (!link) return;
    selectLink(edgeId);
    const field = linkLabelField(link.kind);
    const value = linkLabel(link);
    useApp.getState().setLinkDraft({ linkId: edgeId, field, value });
    setEditingEdgeId(edgeId);
  }, [selectLink]);

  const handleEdgeEditChange = useCallback((edgeId: string, value: string) => {
    const prev = useApp.getState().linkDraft;
    if (prev?.linkId === edgeId) useApp.getState().setLinkDraft({ ...prev, value });
  }, []);

  const cancelEdgeEdit = useCallback((edgeId: string) => {
    setEditingEdgeId((cur) => (cur === edgeId ? null : cur));
    if (useApp.getState().linkDraft?.linkId === edgeId) useApp.getState().setLinkDraft(null);
  }, []);

  const commitEdgeEdit = useCallback(async (edgeId: string, value: string) => {
    // Enter commits and the input may then blur on unmount — the draft guard makes this idempotent.
    const wasMine = useApp.getState().linkDraft?.linkId === edgeId;
    cancelEdgeEdit(edgeId);
    if (!wasMine) return;
    const link = useApp.getState().arch?.links.find((l) => l.id === edgeId);
    if (!link) return;
    const field = linkLabelField(link.kind);
    const current = linkLabel(link);
    const next = value.trim();
    if (!next || next === current) return;
    const r = await applyOperation({
      kind: 'SetLinkAttribute', opId: `op_${Date.now()}`,
      linkId: edgeId, attributeName: field, value: next,
    });
    if ('reason' in r) setToast({ kind: 'error', text: friendlyOpError(r) });
    else setToast({ kind: 'success', text: `${LINK_FIELD_LABEL[field]} updated` });
  }, [cancelEdgeEdit, setToast]);

  // ---- Selection toolbar on the edge: each end's arrowhead is an independent toggle
  // (presentation only, edge style). Click to add the arrowhead, click again to remove it.
  const handleToggleEdgeArrow = useCallback((edgeId: string, end: 'start' | 'end') => {
    const st = useApp.getState();
    const cur = st.edgeStyles[edgeId] ?? DEFAULT_EDGE_STYLE;
    // Keep the user's marker shape if one is set anywhere; default to the closed arrowhead.
    const pick = (a?: EdgeArrow) => (a && a !== 'none' ? a : undefined);
    const shape: EdgeArrow = pick(cur.arrowEnd) ?? pick(cur.arrowStart) ?? pick(cur.arrow) ?? 'closed';
    if (end === 'start') {
      const active = (cur.arrowStart ?? 'none') !== 'none';
      st.setEdgeStyleFor(edgeId, { ...cur, arrowStart: active ? 'none' : shape });
    } else {
      // The target end defaults to a closed arrow when unset (legacy `arrow` included).
      const active = (cur.arrowEnd ?? cur.arrow ?? 'closed') !== 'none';
      st.setEdgeStyleFor(edgeId, { ...cur, arrow: undefined, arrowEnd: active ? 'none' : shape });
    }
  }, []);

  // Apply a predefined relationship type: write the attribute into the model (kind for a
  // dependency, payload for a data flow, label for a relation) and apply the type's style preset, keeping the
  // user's routing/docking choices.
  const handleSetEdgeType = useCallback(async (edgeId: string, t: RelationshipType) => {
    const st = useApp.getState();
    const link = st.arch?.links.find((l) => l.id === edgeId);
    if (!link) return;
    const cur = st.edgeStyles[edgeId] ?? DEFAULT_EDGE_STYLE;
    st.setEdgeStyleFor(edgeId, { ...cur, ...t.style });
    const field = linkLabelField(link.kind);
    if ((link.attributes[field] ?? '') === t.value) { setToast({ kind: 'success', text: `Styled as ${t.value}` }); return; }
    const r = await applyOperation({
      kind: 'SetLinkAttribute', opId: `op_${Date.now()}`,
      linkId: edgeId, attributeName: field, value: t.value,
    });
    if ('reason' in r) setToast({ kind: 'error', text: friendlyOpError(r) });
    else setToast({ kind: 'success', text: `Relationship set to ${t.value}` });
  }, [setToast]);

  const edges = useMemo<Edge[]>(() => filtered.links.filter((l) => !hiddenIds.has(l.fromId) && !hiddenIds.has(l.toId)).map((l) => {
    const userStyle = edgeStyles[l.id] ?? DEFAULT_EDGE_STYLE;
    // While a draft edit is in flight (inline editor or inspector), the label shows it live.
    const draftValue = linkDraft && linkDraft.linkId === l.id ? linkDraft.value : null;
    const label = draftValue ?? linkLabel(l);
    const dash = dashArrayFor(userStyle.lineStyle) ?? (linkIsDashedByDefault(l.kind) ? '4 4' : undefined);
    const waypoints = edgeWaypoints[l.id];
    // Dim edges that connect dimmed nodes in focus mode. Both endpoints have to be in
    // the focus set for the edge to stay lit — otherwise it's irrelevant to the selection.
    const dimmed = focusSet !== null && !(focusSet.has(l.fromId) && focusSet.has(l.toId));
    // Still unless asked for: flowing dashes on every dependency and relation by default redrew the
    // whole picture each frame (8 fps at 330 arrows), and the inspector's toggle said "off" meanwhile.
    const animated = userStyle.animated === true;
    const arrowEnd = userStyle.arrowEnd ?? userStyle.arrow ?? 'closed';
    const arrowStart = userStyle.arrowStart ?? 'none';
    const dock = edgeHandles[l.id] ?? autoDocks[l.id];
    return {
      id: l.id,
      source: l.fromId,
      target: l.toId,
      sourceHandle: dock?.source,
      targetHandle: dock?.target,
      reconnectable: true,
      selected: l.id === selectedLinkId,
      type: 'waypointed',
      label,
      animated,
      // Flow speed via a className that overrides the dashdraw duration (see styles.css).
      className: animated && userStyle.animSpeed && userStyle.animSpeed !== 'normal' ? `stemma-edge-${userStyle.animSpeed}` : undefined,
      // Per-end markers (both ends configurable).
      markerStart: edgeMarkerSpec(arrowStart, userStyle.color),
      markerEnd: edgeMarkerSpec(arrowEnd, userStyle.color),
      style: {
        strokeWidth: userStyle.thickness,
        strokeDasharray: dash,
        stroke: userStyle.color,
        opacity: dimmed ? 0.18 : 1,
      },
      labelStyle: dimmed ? { opacity: 0.4 } : undefined,
      data: {
        waypoints,
        routing: userStyle.routing,
        labelSize: userStyle.labelSize,
        onAddWaypoint: handleAddWaypoint,
        onRemoveWaypoint: handleRemoveWaypoint,
        editing: l.id === editingEdgeId,
        editValue: draftValue ?? label,
        onEditStart: startEdgeEdit,
        onEditChange: handleEdgeEditChange,
        onEditCommit: commitEdgeEdit,
        onEditCancel: cancelEdgeEdit,
        arrowStartActive: arrowStart !== 'none',
        arrowEndActive: arrowEnd !== 'none',
        onToggleArrow: handleToggleEdgeArrow,
        typeValue: label,
        onSetType: handleSetEdgeType,
      },
    };
  }), [filtered.links, edgeStyles, edgeWaypoints, edgeHandles, autoDocks, selectedLinkId, handleAddWaypoint, handleRemoveWaypoint, focusSet, hiddenIds, linkDraft, editingEdgeId, startEdgeEdit, handleEdgeEditChange, commitEdgeEdit, cancelEdgeEdit, handleToggleEdgeArrow, handleSetEdgeType]);

  // The unique (shape, colour) custom markers (circle / diamond / bar) actually used by edges.
  const customMarkers = useMemo<CustomMarker[]>(() => {
    const m = new Map<string, CustomMarker>();
    for (const l of filtered.links) {
      const st = edgeStyles[l.id];
      for (const a of [st?.arrowStart, st?.arrowEnd ?? st?.arrow]) {
        if (a === 'circle' || a === 'diamond' || a === 'pipe') {
          const color = st?.color ?? '#94a3b8';
          const id = customMarkerId(a, color);
          if (!m.has(id)) m.set(id, { id, type: a, color });
        }
      }
    }
    return [...m.values()];
  }, [filtered.links, edgeStyles]);

  // "About" relationships (Question / Assumption / Risk → the element they concern). These are not
  // model links (they live on the element's aboutId), so they're rendered as dotted edges only.
  const aboutRels = useMemo(() => {
    const present = new Set(filtered.elements.map((e) => e.id));
    return filtered.elements
      .filter((e) => e.kind === 'question' || e.kind === 'assumption' || e.kind === 'risk')
      .map((e) => ({ id: `__about__${e.id}`, from: e.id, to: e.attributes.aboutId ?? '' }))
      .filter((r) => r.to && present.has(r.to) && !hiddenIds.has(r.from) && !hiddenIds.has(r.to));
  }, [filtered.elements, hiddenIds]);

  const aboutEdges = useMemo<Edge[]>(() => aboutRels.map((r) => {
    const dock = autoDocks[r.id];
    return {
      id: r.id,
      source: r.from,
      target: r.to,
      sourceHandle: dock?.source,
      targetHandle: dock?.target,
      type: 'waypointed',
      label: 'about',
      selectable: false,
      reconnectable: false,
      style: { stroke: '#a1a1aa', strokeDasharray: '3 4', strokeWidth: 1.5, opacity: 0.7 },
      labelStyle: { fontSize: 9, fill: '#a1a1aa' },
      labelBgStyle: { fill: 'transparent' },
    };
  }), [aboutRels, autoDocks]);

  const allEdges = useMemo<Edge[]>(() => aboutEdges.length ? [...edges, ...aboutEdges] : edges, [edges, aboutEdges]);

  const [nodes, setNodes] = useState<Node[]>([]);

  const handleNodeResize = useCallback((nodeId: string, w: number, h: number) => {
    const current = useApp.getState().nodeStyles[nodeId] ?? { borderWidth: 1, borderStyle: 'solid' as const };
    useApp.getState().setNodeStyleFor(nodeId, { ...current, width: w, height: h });
  }, []);

  // Fill an auto dock (nearest sensible dots) for any relationship without an explicit anchor.
  // Idempotent — only fills *missing* entries, so it never re-docks while boxes are dragged.
  useEffect(() => {
    if (nodes.length === 0) return;
    setAutoDocks((prev) => {
      const rectById = new Map(nodes.map((n) => [n.id, nodeRect(n)]));
      let changed = false;
      const next = { ...prev };
      const consider = (id: string, from: string, to: string) => {
        if (next[id] || edgeHandles[id]) return;
        const a = rectById.get(from);
        const b = rectById.get(to);
        if (!a || !b) return;
        next[id] = autoDock(a, b);
        changed = true;
      };
      for (const l of filtered.links) consider(l.id, l.fromId, l.toId);
      for (const r of aboutRels) consider(r.id, r.from, r.to);
      return changed ? next : prev;
    });
  }, [nodes, filtered.links, aboutRels, edgeHandles]);

  // Reconcile dots chosen while drawing/reconnecting with the engine-assigned link id, once the
  // model refresh brings the new link in.
  useEffect(() => {
    if (pendingDock.current.length === 0 || !workspace) return;
    const remaining: typeof pendingDock.current = [];
    for (const p of pendingDock.current) {
      const link = filtered.links.find((l) => l.fromId === p.from && l.toId === p.to && !edgeHandles[l.id]);
      if (link) {
        saveEdgeHandles(workspace.rootPath, layoutKey as ViewKind, link.id, p.handles);
        setEdgeHandles((prev) => ({ ...prev, [link.id]: p.handles }));
      } else {
        remaining.push(p);
      }
    }
    pendingDock.current = remaining;
  }, [filtered.links, edgeHandles, workspace, layoutKey]);

  // Inline edit (Q "puting text into box on canvas") — double-click a node to
  // edit its name. We carry the editing id in component state and pass the
  // commit/cancel callbacks down through node data so the renderer stays
  // dumb.
  const [editingNodeId, setEditingNodeId] = useState<string | null>(null);
  const [notesEditingId, setNotesEditingId] = useState<string | null>(null);

  // Double-click a node → write its text in-place (boxes are text). Bounded Contexts are
  // structural, so double-clicking one renames it instead.
  const onNodeDoubleClick: NodeMouseHandler = useCallback((_, node) => {
    if (node.type !== 'arch') return;
    const kind = (node.data as { element?: { kind?: string } })?.element?.kind;
    // Bounded Contexts and Person are structural — double-click renames them.
    if (kind === 'boundedContext' || kind === 'person') { setEditingNodeId(node.id); setNotesEditingId(null); return; }
    // Everything else: write its text in-place, and select it so the inspector mirrors it live.
    select(node.id);
    setNotesEditingId(node.id);
    setEditingNodeId(null);
  }, [select]);

  // Rename is reached by double-clicking the title text.
  const handleStartRename = useCallback((nodeId: string) => {
    setEditingNodeId(nodeId);
    setNotesEditingId(null);
  }, []);

  // Global keyboard shortcuts (bound in App) drive the canvas through window events:
  // F2 rename / edit, ⌘= / ⌘- zoom, ⌘0 fit, ⌘A select all.
  useEffect(() => {
    function onStartRename() {
      const st = useApp.getState();
      if (st.selectedLinkId) { startEdgeEdit(st.selectedLinkId); return; }
      if (st.selectedElementId) { setEditingNodeId(st.selectedElementId); setNotesEditingId(null); }
    }
    function onZoom(ev: Event) {
      const dir = ((ev as CustomEvent).detail?.dir as number) ?? 1;
      if (dir > 0) zoomIn({ duration: 150 }); else zoomOut({ duration: 150 });
    }
    function onFit() { fitWholeView(paddingUnderHeader(0.2), 300); }
    function onSelectAll() { setNodes((ns) => ns.map((n) => (n.selected ? n : { ...n, selected: true }))); }
    function onClearSelection() {
      setNodes((ns) => ns.some((n) => n.selected) ? ns.map((n) => (n.selected ? { ...n, selected: false } : n)) : ns);
      setEditingNodeId(null);
      setNotesEditingId(null);
    }
    window.addEventListener('stemma:start-rename', onStartRename);
    window.addEventListener('stemma:zoom', onZoom);
    window.addEventListener('stemma:fit-view', onFit);
    window.addEventListener('stemma:select-all', onSelectAll);
    window.addEventListener('stemma:clear-selection', onClearSelection);
    return () => {
      window.removeEventListener('stemma:start-rename', onStartRename);
      window.removeEventListener('stemma:zoom', onZoom);
      window.removeEventListener('stemma:fit-view', onFit);
      window.removeEventListener('stemma:select-all', onSelectAll);
      window.removeEventListener('stemma:clear-selection', onClearSelection);
    };
  }, [startEdgeEdit, zoomIn, zoomOut, fitView, fitWholeView]);

  const handleCommitName = useCallback(async (nodeId: string, next: string) => {
    setEditingNodeId(null);
    const r = await applyOperation({
      kind: 'RenameElement', opId: `op_${Date.now()}`, elementId: nodeId, newName: next,
    });
    if ('reason' in r) setToast({ kind: 'error', text: friendlyOpError(r) });
    else setToast({ kind: 'success', text: 'Renamed' });
  }, [setToast]);

  const handleCancelEdit = useCallback(() => setEditingNodeId(null), []);

  // In-place notes: persist text as it is typed; on commit also reflect #tags into custom props.
  const handleChangeNotes = useCallback((nodeId: string, text: string) => {
    const ws = useApp.getState().workspace;
    if (ws) saveNote(ws.rootPath, nodeId, text);
    // Mirror keystrokes into the inspector's "Text & attributes" editor.
    window.dispatchEvent(new CustomEvent('stemma:note-live', { detail: { id: nodeId, text } }));
  }, []);

  // Persist text + reflect #tags into custom props. Does NOT close the editor (blur fires this).
  const handleCommitNotes = useCallback((nodeId: string, text: string) => {
    const ws = useApp.getState().workspace;
    if (!ws) return;
    saveNote(ws.rootPath, nodeId, text);
    const props = hashtagProps(text);
    const current = useApp.getState().customProps[nodeId] ?? {};
    for (const [k, v] of Object.entries(props)) if (current[k] !== v) useApp.getState().setCustomProp(nodeId, k, v);
    window.dispatchEvent(new CustomEvent('stemma:notes-changed'));
  }, []);

  const handleCloseNotes = useCallback(() => setNotesEditingId(null), []);

  // Notes are read once per change here — NOT inside the node rebuild, which also fires on the
  // 1.5s violations poll and other churn. Keeps the canvas light on large graphs.
  const notesById = useMemo(() => {
    const m = new Map<string, string>();
    if (!workspace) return m;
    // The section once, not once per element.
    const all = loadNotes(workspace.rootPath);
    for (const el of filtered.elements) { const t = all[el.id]; if (t) m.set(el.id, t); }
    return m;
  }, [workspace, filtered.elements, notesVersion]);

  // Positions captured when a drag begins (null when not dragging). Declared here — above the
  // node-build effect — because that effect reads it to avoid rebuilding nodes mid-drag.
  const dragStartPositions = useRef<Record<string, SavedPosition> | null>(null);

  // Bumped when the committed sidecar finishes loading. The node-build effect below depends on it,
  // because that effect can otherwise run first — against default positions — and never re-run, so
  // the committed layout (and any constraint) would silently lose to a grid nobody authored.
  const [sidecarTick, setSidecarTick] = useState(0);
  useEffect(() => {
    function onPrimed() { setSidecarTick((n) => n + 1); }
    window.addEventListener('stemma:sidecar-primed', onPrimed);
    return () => window.removeEventListener('stemma:sidecar-primed', onPrimed);
  }, []);

  // Sizes React Flow has actually measured. The layout solver prefers these and estimates only for
  // nodes that have never been drawn — an estimate is close but not exact, and a track sized from
  // one is visibly wrong for a node carrying an explicit width.
  //
  // Read off React Flow's own `measured` rather than the DOM: no query, no timer, and it is already
  // the number the canvas laid out with.
  const measuredSizesRef = useRef<Record<string, { w: number; h: number }>>({});
  useEffect(() => {
    let changed = false;
    const next = { ...measuredSizesRef.current };
    for (const n of nodes) {
      const w = n.measured?.width, h = n.measured?.height;
      if (!w || !h) continue;
      const prev = next[n.id];
      if (prev?.w === w && prev?.h === h) continue;
      next[n.id] = { w, h };
      changed = true;
    }
    if (changed) measuredSizesRef.current = next;
  }, [nodes]);

  useEffect(() => {
    if (!workspace || !arch) {
      setNodes([]);
      return;
    }
    const saved = loadLayout(workspace.rootPath, layoutKey as ViewKind);
    const defaults = defaultPositions(filtered.elements);
    // A declarative constraint, when the view has one, governs the nodes it names; everything else
    // keeps its stored position. Sizes come from what React Flow has measured, falling back to an
    // estimate for nodes it has not drawn yet, so the arrangement does not jump on first paint.
    const constraint = loadViewConstraint(workspace.rootPath, String(layoutKey));
    const merged = constraint
      ? resolveLayout({
          constraint,
          offsets: loadViewOffsets(workspace.rootPath, String(layoutKey)),
          stored: { ...defaults, ...saved },
          sizes: sizesFor(
            filtered.elements.map((e) => ({ id: e.id, name: e.name })),
            measuredSizesRef.current,
          ),
        })
      : { ...defaults, ...saved };
    const governedIds = new Set(constraint ? constraintIds(constraint) : []);

    setNodes((prev) => {
      // Never rebuild node objects while a drag is in flight: swapping the dragged node's identity
      // mid-drag makes React Flow abandon the gesture and the node snaps back to its pre-drag spot.
      // The ~1.5s violations poll (and other store churn) re-runs this effect under the user's
      // cursor otherwise. Any skipped update re-applies on the first render after the drop.
      if (dragStartPositions.current !== null) return prev;
      const prevById = new Map(prev.map((n) => [n.id, n]));
      const tagsById = new Map((arch?.tags ?? []).map((t) => [t.targetId, t]));
      // Build per-element worst-severity map.
      const sevByElement = new Map<string, 'info' | 'warning' | 'error'>();
      const sevRank = (s: string) => s === 'error' ? 3 : s === 'warning' ? 2 : 1;
      for (const v of violations) {
        for (const id of v.elementIds) {
          const cur = sevByElement.get(id);
          if (!cur || sevRank(v.severity) > sevRank(cur)) sevByElement.set(id, v.severity);
        }
      }
      // Quick lookup for the BC backing each element so the inspector / badges can show context name.
      const ctxById = new Map(arch?.elements.filter((x) => x.kind === 'boundedContext').map((x) => [x.id, x.name]) ?? []);
      return filtered.elements.map((e) => {
        const existing = prevById.get(e.id);
        // Precedence, and the order matters more than it looks (B-002).
        //
        // A node the constraint governs takes the solved position: it is *derived*, so a re-solve
        // has to win or the constraint could never take effect.
        //
        // Otherwise an **authored** position wins next. `saved` is what the sidecar says, and a
        // sidecar entry is data somebody wrote — unlike `existing`, which on a never-opened view is
        // a default this component invented a moment earlier. Ranking `existing` above it meant a
        // headless render of a hand-written workspace painted defaults first, then discarded the
        // authored layout when the sidecar arrived. Safe against a drag: `persistPositions` updates
        // the sidecar cache synchronously, so after a drop `saved` already holds the dropped
        // position, and a rebuild mid-drag is refused above.
        //
        // `existing` is the fallback for a node with no authored position, so the violations poll
        // still cannot shuffle an unplaced node around under the cursor.
        const authored = saved[e.id];
        const pos = (governedIds.has(e.id) ? merged[e.id] : authored ?? existing?.position ?? merged[e.id])
          ?? { x: 0, y: 0 };
        const ns = nodeStyles[e.id];
        const editing = editingNodeId === e.id;
        const notesEditing = notesEditingId === e.id;
        const dimmed = focusSet !== null && !focusSet.has(e.id);
        const fan = fanCounts.get(e.id);
        const ctxId = e.attributes?.contextId ?? null;
        const ctxName = ctxId ? ctxById.get(ctxId) ?? null : null;
        const noteText = notesById.get(e.id) ?? '';
        const built = {
          id: e.id,
          type: 'arch',
          position: pos,
          // Preserve React Flow's selection across rebuilds — otherwise the ~1.5s violations poll
          // (and any other rebuild) wipes a Ctrl-click / marquee multi-selection a moment after it's made.
          selected: existing?.selected ?? false,
          draggable: !editing && !notesEditing,
          ...(ns?.width && ns?.height ? { style: { width: ns.width, height: ns.height } } : {}),
          data: {
            element: e,
            tag: tagsById.get(e.id),
            nodeStyle: ns,
            customProps: customProps[e.id],
            violationSeverity: sevByElement.get(e.id),
            resizable: !editing,
            onResize: handleNodeResize,
            editing,
            notesEditing,
            noteFull: noteText,
            onStartRename: handleStartRename,
            onChangeNotes: handleChangeNotes,
            onCommitNotes: handleCommitNotes,
            onCloseNotes: handleCloseNotes,
            onCommitName: handleCommitName,
            onCancelEdit: handleCancelEdit,
            // Architect-grade dep view extras — read by ArchNodeView.
            dimmed,
            fanIn: fan?.in,
            fanOut: fan?.out,
            contextName: ctxName,
            isDependencyView: view === 'dependencyGraph',
          },
        } satisfies Node;
        // The same card when nothing about it changed: React Flow then leaves it alone, and only the
        // boxes an edit touched are drawn again.
        return existing && sameNode(existing, built) ? existing : built;
      });
    });
  }, [arch, view, workspace, filtered.elements, layoutKey, nodeStyles, customProps, violations, handleNodeResize, editingNodeId, notesEditingId, handleStartRename, handleChangeNotes, handleCommitNotes, handleCloseNotes, handleCommitName, handleCancelEdit, activeCustomView, focusSet, fanCounts, notesById, sidecarTick]);

  // Fit a view once, when it is first shown with its cards on the canvas and the committed positions
  // read: a fit taken before them frames where the cards are about to stop being, and a second fit
  // when they land moves the canvas under a pointer already at work. Keyed on the view rather than
  // on the cards, so a drag or an edit never re-frames anything; keyed on the cards existing at all,
  // because the model can arrive after the view is chosen — the Module Map on a fresh load used to
  // open unfitted, at whatever zoom the canvas started with.
  const fittedFor = useRef<string | null>(null);
  // F-016: an element being revealed — the open's fit must not fight the move to it — and the card
  // that wears the ring for a moment once it is there.
  const revealPending = useRef<string | null>(null);
  const [revealId, setRevealId] = useState<string | null>(null);
  // Cards an undo or redo just changed, ringed for a moment so the change is seen (HIG, Undo and redo).
  const [flashIds, setFlashIds] = useState<Set<string>>(() => new Set());
  const flashTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(flashTimer.current), []);
  const revealTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(revealTimer.current), []);
  // F-016 AC5: each view keeps its pan and zoom for the session, so looking elsewhere for a moment
  // does not lose the framing someone set up. Saved as a view is left, restored when it is opened.
  const memoryKey = `${workspace?.rootPath ?? ''}|${layoutKey}`;
  // Only a view that settled on screen — fitted, restored or revealed into — has a viewport worth
  // keeping. Opening the app passes through the last active view for a moment before the Module Map,
  // and remembering that unfitted moment made the view open unfitted the next time.
  const settledFor = useRef<string | null>(null);
  useEffect(() => {
    const key = memoryKey;
    return () => {
      if (settledFor.current === key && !useApp.getState().presenting) viewportMemory.set(key, getViewport());
      if (settledFor.current === key) settledFor.current = null;
    };
  }, [memoryKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const [positionsRead, setPositionsRead] = useState(() => !!workspace && isSidecarPrimed(workspace.rootPath));
  useEffect(() => {
    if (workspace && isSidecarPrimed(workspace.rootPath)) setPositionsRead(true);
    function onPrimed() { setPositionsRead(true); }
    window.addEventListener('stemma:sidecar-primed', onPrimed);
    return () => window.removeEventListener('stemma:sidecar-primed', onPrimed);
  }, [workspace?.rootPath]); // eslint-disable-line react-hooks/exhaustive-deps
  const hasCards = nodes.length > 0;
  const fitFor = `${layoutKey}|${arch?.filePath ?? ''}`;
  useEffect(() => {
    if (!hasCards || fittedFor.current === fitFor) return;
    // A sidecar that is never read — the server gone, say — must not leave the view unfitted for good.
    const wait = positionsRead ? 80 : 1500;
    const id = setTimeout(() => {
      fittedFor.current = fitFor;
      settledFor.current = memoryKey;
      // An element on its way to being revealed decides where the canvas goes.
      if (revealPending.current || bookPageApplies.current) return;
      const remembered = viewportMemory.get(memoryKey);
      if (remembered) { setViewport(remembered, { duration: 0 }); return; }
      // At once rather than animated: a view should open where it is going to stay, and an animated
      // fit flies out and back in under a pointer that may already be reaching for a card.
      fitWholeView(paddingUnderHeader(0.2), 0);
    }, wait);
    return () => clearTimeout(id);
  }, [fitFor, hasCards, positionsRead]); // eslint-disable-line react-hooks/exhaustive-deps

  // A book page frames its view: the whole of it, or only what it points at. Moving between pages
  // of one view is a camera move, which is what turns "first the context, then the detail" from a
  // cut into a zoom. Says when it has settled, so the PDF export knows when to take the picture.
  const nodesReady = nodes.length > 0;
  // The presenter asks again when its narrative is shown or hidden, since that changes the room left.
  // So does the canvas changing size while presenting: going full screen lands after the first
  // frame, and a frame computed for the editor's smaller canvas is off-centre on the big one.
  const [reframes, setReframes] = useState(0);
  useEffect(() => {
    const bump = () => setReframes((n) => n + 1);
    window.addEventListener('stemma:book-reframe', bump);
    return () => window.removeEventListener('stemma:book-reframe', bump);
  }, []);
  useEffect(() => {
    const el = wrapperRef.current;
    if (!readOnly || !el || typeof ResizeObserver === 'undefined') return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let first = true;
    const observer = new ResizeObserver(() => {
      // The observer reports the size it starts with; only a change is a reason to frame again.
      if (first) { first = false; return; }
      clearTimeout(timer);
      timer = setTimeout(() => setReframes((n) => n + 1), 150);
    });
    observer.observe(el);
    return () => { observer.disconnect(); clearTimeout(timer); };
  }, [readOnly]);
  const frameKey = bookPage
    ? `${activeBookId}|${bookPage.id}|${layoutKey}|${bookPage.frame}|${bookPage.others}|${bookPage.focus.join(',')}|${presenting}|${capturing}`
    : null;
  useEffect(() => {
    if (!frameKey || !nodesReady || !bookPage) return;
    const page = bookPage;
    const duration = frameDuration(prefersReducedMotion(), capturing);
    let settle: ReturnType<typeof setTimeout> | undefined;
    // After the view's nodes for this page are in place: a page on another view arrives with it.
    const start = setTimeout(() => {
      const present = new Set(getNodes().filter((n) => !n.hidden).map((n) => n.id));
      const targets = page.frame === 'focus' ? page.focus.filter((id) => present.has(id)) : [];
      // The view's header sits over the top of the canvas, so the frame starts below it (F-014).
      // Presenting, the narrative card sits in the bottom-left corner: the picture is framed either
      // above it or beside it, whichever draws it larger — a wide view goes above, a tall one beside.
      const rfEl = wrapperRef.current?.querySelector('.react-flow') as HTMLElement | null;
      const card = presenting ? document.querySelector<HTMLElement>('[data-book-narrative]') : null;
      const header = viewHeaderHeight();
      const top: `${number}px` | `${number}%` = header > 0 ? `${header + 28}px` : '5%';
      // Close enough to read, not so close that the boxes stop looking like a diagram.
      const maxZoom = 1.15;
      const nodes = getNodes().filter((n) => !n.hidden && (targets.length === 0 || targets.includes(n.id)));
      const rects: Rect[] = nodes.length && nodes.every((n) => n.measured?.width) ? [getNodesBounds(nodes)] : [];
      if (targets.length === 0 && !(page.others === 'hide' && page.focus.length > 0)) {
        for (const sh of (useApp.getState().shapes[layoutKey] ?? [])) {
          const b = shapeBoundsRect(sh);
          if (b) rects.push(b);
        }
      }
      if (!rfEl || rects.length === 0) {
        const fallback = card ? { top, left: '4%', right: '4%', bottom: '30%' } as const : (presenting || capturing ? 0.08 : 0.24);
        if (targets.length > 0) fitView({ padding: fallback, duration, maxZoom, nodes: targets.map((id) => ({ id })) });
        else fitView({ padding: fallback, duration, maxZoom });
      } else {
        const bounds = unionRects(rects);
        const w = rfEl.clientWidth, h = rfEl.clientHeight;
        const candidates: NonNullable<FitViewOptions['padding']>[] = [];
        if (card) {
          const area = rfEl.getBoundingClientRect(), c = card.getBoundingClientRect();
          candidates.push({ top, left: '4%', right: '4%', bottom: `${Math.round(area.bottom - c.top + 20)}px` });
          candidates.push({ top, left: `${Math.round(c.right - area.left + 28)}px`, right: '4%', bottom: '5%' });
        } else if (header > 0) {
          candidates.push({ top, left: '5%', right: '5%', bottom: presenting || capturing ? '6%' : '10%' });
        } else {
          candidates.push(presenting || capturing ? 0.08 : 0.24);
        }
        const best = candidates
          .map((padding) => getViewportForBounds(bounds, w, h, 0.05, maxZoom, padding))
          .reduce((a, b) => (b.zoom > a.zoom ? b : a));
        setViewport(best, { duration });
      }
      settle = setTimeout(() => requestAnimationFrame(() => requestAnimationFrame(() => {
        window.dispatchEvent(new CustomEvent('stemma:book-framed', { detail: { pageId: page.id } }));
      })), duration + 40);
    }, capturing ? 250 : 120);
    return () => { clearTimeout(start); if (settle) clearTimeout(settle); };
  }, [frameKey, nodesReady, reframes]); // eslint-disable-line react-hooks/exhaustive-deps

  // The PDF export's picture of a page: the viewport exactly as framed, without the chrome.
  useEffect(() => {
    async function onCapture(ev: Event) {
      const resolve = (ev as CustomEvent).detail?.resolve as ((dataUrl: string | null) => void) | undefined;
      if (!resolve) return;
      const rfEl = document.querySelector('.react-flow') as HTMLElement | null;
      if (!rfEl) { resolve(null); return; }
      try {
        const { toPng } = await import('html-to-image');
        // Sharp on paper without making a deck of window-sized bitmaps: the long edge stops at 2400 px.
        const pixelRatio = Math.min(2, 2400 / Math.max(rfEl.clientWidth, rfEl.clientHeight, 1));
        resolve(await toPng(rfEl, { backgroundColor: getComputedStyle(document.body).backgroundColor, pixelRatio, filter: notCanvasChrome }));
      } catch (error) {
        reportFailure('Canvas', ClientEvent.RequestFailed, 'Capturing a book page')(error);
        resolve(null);
      }
    }
    window.addEventListener('stemma:capture-viewport', onCapture);
    return () => window.removeEventListener('stemma:capture-viewport', onCapture);
  }, []);

  // Export the WHOLE canvas — every node AND every free-form shape — by fitting their combined
  // bounds into view, snapshotting the .react-flow element (which holds the shape overlay too),
  // then restoring the viewport. Chrome (controls / minimap) is filtered out.
  useEffect(() => {
    async function onExport(ev: Event) {
      const req = (ev as CustomEvent).detail as ExportRequest;
      const format = req?.format ?? 'png';
      const rfEl = document.querySelector('.react-flow') as HTMLElement | null;
      if (!rfEl) { setToast({ kind: 'error', text: 'Canvas not ready' }); return; }
      const rects: { x: number; y: number; width: number; height: number }[] = [];
      const ns = getNodes();
      if (ns.length) rects.push(getNodesBounds(ns));
      for (const s of (useApp.getState().shapes[layoutKey] ?? [])) {
        const b = shapeBoundsRect(s);
        if (b) rects.push(b);
      }
      if (rects.length === 0) { setToast({ kind: 'error', text: 'Nothing to export' }); return; }
      const minX = Math.min(...rects.map((r) => r.x)), minY = Math.min(...rects.map((r) => r.y));
      const maxX = Math.max(...rects.map((r) => r.x + r.width)), maxY = Math.max(...rects.map((r) => r.y + r.height));
      const bounds = { x: minX, y: minY, width: Math.max(1, maxX - minX), height: Math.max(1, maxY - minY) };
      const saved = getViewport();
      try {
        const ex = resolveExportOptions(req ?? { format }, getComputedStyle(document.body).backgroundColor);
        const vp = getViewportForBounds(bounds, rfEl.clientWidth, rfEl.clientHeight, 0.05, 2.5, ex.padding);
        setViewport(vp);
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
        const { toPng, toSvg } = await import('html-to-image');
        // A single image is a figure; its caption belongs to the document it goes into (ADR-0023).
        const filter = (node: HTMLElement) => notCanvasChrome(node) && !(node as Element).hasAttribute?.('data-view-header');
        // `backgroundColor: undefined` is how html-to-image is told to leave the backdrop alone —
        // passing a colour of any kind, including 'transparent', paints one.
        const opts = { backgroundColor: ex.backgroundColor, pixelRatio: ex.pixelRatio, filter };
        const dataUrl = ex.format === 'svg' ? await toSvg(rfEl, opts) : await toPng(rfEl, opts);
        const blob = await (await fetch(dataUrl)).blob();
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = exportFileName(ex);
        a.click();
        URL.revokeObjectURL(a.href);
        setToast({
          kind: 'success',
          text: `Exported ${ex.format.toUpperCase()} at ${ex.pixelRatio}×${ex.backgroundColor ? '' : ', transparent'}`,
        });
      } catch (e) {
        setToast({ kind: 'error', text: `Export failed: ${(e as Error).message}` });
      } finally {
        setViewport(saved);
      }
    }
    window.addEventListener('stemma:export-image', onExport);
    return () => window.removeEventListener('stemma:export-image', onExport);
  }, [getNodes, getViewport, setViewport, setToast, layoutKey]);

  // Headless render: place the content once, instantly, and say so.
  //
  // The ordinary fit is animated, which is right on screen and wrong for a capture — waiting for
  // the pan to stop is a race against whichever fit fires last, and the same view rendered twice
  // came out at slightly different sizes. This sets the viewport in one step with no animation, so
  // the crop is a function of the model and the layout rather than of timing.
  useEffect(() => {
    function onRenderFit(ev: Event) {
      const padding = (ev as CustomEvent).detail?.padding ?? 0.06;
      const rfEl = document.querySelector('.react-flow') as HTMLElement | null;
      const ns = getNodes();
      if (!rfEl || ns.length === 0) return;
      const rects = [getNodesBounds(ns)];
      for (const s of (useApp.getState().shapes[layoutKey] ?? [])) {
        const b = shapeBoundsRect(s);
        if (b) rects.push(b);
      }
      const minX = Math.min(...rects.map((r) => r.x)), minY = Math.min(...rects.map((r) => r.y));
      const maxX = Math.max(...rects.map((r) => r.x + r.width)), maxY = Math.max(...rects.map((r) => r.y + r.height));
      const bounds = { x: minX, y: minY, width: Math.max(1, maxX - minX), height: Math.max(1, maxY - minY) };
      const vp = getViewportForBounds(bounds, rfEl.clientWidth, rfEl.clientHeight, 0.05, 2.5, padding);
      setViewport(vp);

      // Publish where the content sits, in screen pixels. The node hull comes from the same numbers
      // that produced the transform — measuring it from the DOM instead was not reproducible,
      // because element rects include bezier overshoot that moved by tens of pixels between runs.
      //
      // Edge labels are the exception and have to be measured: they are positioned by the edge
      // renderer, not by the node bounds, so a label on a leftmost edge sits outside the hull and
      // gets sliced off by the crop. The transform is fixed and unanimated by this point, so
      // measuring is stable here in a way it was not before.
      const hull = {
        left: bounds.x * vp.zoom + vp.x,
        top: bounds.y * vp.zoom + vp.y,
        right: (bounds.x + bounds.width) * vp.zoom + vp.x,
        bottom: (bounds.y + bounds.height) * vp.zoom + vp.y,
      };

      requestAnimationFrame(() => requestAnimationFrame(() => {
        const labels = document.querySelectorAll(
          '.react-flow__edge-text, .react-flow__edge-textwrapper, .react-flow__edgelabel-renderer > *'
        );
        for (const el of labels) {
          const r = el.getBoundingClientRect();
          if (r.width === 0 && r.height === 0) continue;
          hull.left = Math.min(hull.left, r.left);
          hull.top = Math.min(hull.top, r.top);
          hull.right = Math.max(hull.right, r.right);
          hull.bottom = Math.max(hull.bottom, r.bottom);
        }
        const box = {
          x: hull.left, y: hull.top, width: hull.right - hull.left, height: hull.bottom - hull.top,
        };

        // Never publish a box that is not four real numbers. `JSON.stringify` writes NaN as `null`,
        // and the renderer read it back with `GetDouble()` and died on a JSON type error naming
        // neither the view nor the cause. A coordinate that is not finite means something upstream
        // produced nonsense, so say that here, where the reason is still in reach.
        if (!Object.values(box).every(Number.isFinite)) {
          window.dispatchEvent(new CustomEvent('stemma:render-failed', {
            detail: { reason: "the layout solved to coordinates that are not numbers — check this view's `layout` constraint in stemma.layout.json" },
          }));
          return;
        }

        document.documentElement.dataset.stemmaRenderBox = JSON.stringify(box);
        window.dispatchEvent(new CustomEvent('stemma:render-fitted'));
      }));
    }
    function onBake(ev: Event) {
      // Freeze what is drawn right now into absolute positions. Dropping a constraint is a change
      // of authoring model, not a change of picture, so nothing may move.
      const key = String((ev as CustomEvent).detail?.layoutKey ?? layoutKey);
      if (!workspace) return;
      const positions: Record<string, SavedPosition> = {};
      for (const n of getNodes()) positions[n.id] = { x: n.position.x, y: n.position.y };
      saveLayout(workspace.rootPath, key as ViewKind, positions);
    }
    window.addEventListener('stemma:bake-constraint', onBake);
    window.addEventListener('stemma:render-fit', onRenderFit);
    return () => {
      window.removeEventListener('stemma:bake-constraint', onBake);
      window.removeEventListener('stemma:render-fit', onRenderFit);
    };
  }, [getNodes, setViewport, layoutKey, workspace]);

  const arrange = useRef<{ persistPositions: (next: Node[]) => void; recordArrangement: (before: Node[], after: Node[], description: string, key?: string) => void }>({
    persistPositions: () => {}, recordArrangement: () => {},
  });

  // Re-read layout when an external event (layout undo/redo) signals it changed.
  useEffect(() => {
    function refreshFromLayout() {
      if (!workspace) return;
      // A view arranged by a constraint is solved again — applying a Row from the Layout panel used to
      // be written and then shown only after a reload, because only stored positions were read here.
      if (loadViewConstraint(workspace.rootPath, String(layoutKey))) { setSidecarTick((n) => n + 1); return; }
      const fresh = loadLayout(workspace.rootPath, layoutKey as ViewKind);
      setNodes((current) => current.map((n) => fresh[n.id] ? { ...n, position: fresh[n.id] } : n));
    }
    function nudge(ev: Event) {
      const detail = (ev as CustomEvent).detail as { nodeId: string; dx: number; dy: number };
      if (!workspace) return;
      // Worked out here rather than in a state updater, which React may run twice: a move is recorded once.
      const current = getNodes();
      // Every selected box moves, as a drag of them would; with none selected on the canvas, the one
      // the inspector shows.
      const selected = new Set(current.filter((n) => n.selected).map((n) => n.id));
      if (selected.size === 0) selected.add(detail.nodeId);
      const next = current.map((n) => selected.has(n.id)
        ? { ...n, position: { x: n.position.x + detail.dx, y: n.position.y + detail.dy } }
        : n);
      setNodes(next);
      arrange.current.persistPositions(next);
      arrange.current.recordArrangement(current, next, selected.size === 1 ? 'Nudge' : `Nudge ${selected.size} boxes`, `nudge:${[...selected].sort().join(',')}`);
    }
    // Authoritatively place a just-created node where it was dropped (overrides the default
    // grid slot the arch refresh may have assigned). No-op if the node isn't built yet — the
    // saved layout will position it on first build.
    function placeNode(ev: Event) {
      const detail = (ev as CustomEvent).detail as { nodeId: string; pos: SavedPosition };
      if (!workspace) return;
      // A newly-placed element takes this view off an auto layout (it would otherwise be re-arranged).
      useApp.getState().setViewLayout(String(layoutKey), 'custom');
      setNodes((current) => {
        if (!current.some((n) => n.id === detail.nodeId)) return current;
        const next = current.map((n) => n.id === detail.nodeId ? { ...n, position: detail.pos } : n);
        const positions: Record<string, SavedPosition> = {};
        for (const n of next) positions[n.id] = { x: n.position.x, y: n.position.y };
        saveLayout(workspace.rootPath, layoutKey as ViewKind, positions);
        return next;
      });
    }
    function focusNode(ev: Event) {
      const detail = (ev as CustomEvent).detail as { nodeId: string };
      // F-016: the element may be on a view that is only now opening. Hold off the open's own fit, and
      // wait for the card to be drawn and measured before moving to it.
      revealPending.current = detail.nodeId;
      let tries = 0;
      const attempt = () => {
        if (revealPending.current !== detail.nodeId) return;
        const node = getNodes().find((n) => n.id === detail.nodeId);
        if (!node?.measured?.width) {
          if (tries++ < 40) { setTimeout(attempt, 50); return; }
          // Never drawn here after all: the view the reveal opened gets the fit it stood down for.
          revealPending.current = null;
          window.dispatchEvent(new CustomEvent('stemma:fit-view'));
          return;
        }
        setNodes((current) => current.map((n) => (n.selected === (n.id === detail.nodeId) ? n : { ...n, selected: n.id === detail.nodeId })));
        // Keyboard focus goes with the selection while it is on the canvas, so Tab and a screen reader
        // are on the box that is selected.
        if (focusIsOnCanvas()) {
          (document.querySelector(`.react-flow__node[data-id="${CSS.escape(detail.nodeId)}"]`) as HTMLElement | null)?.focus({ preventScroll: true });
        }
        try {
          fitView({ nodes: [{ id: detail.nodeId }], padding: 0.45, duration: prefersReducedMotion() ? 0 : 450, maxZoom: 1.2 });
        } catch { /* not on canvas */ }
        // Kept a little past the move, so a view's fit-on-open that was about to fire stands down.
        setTimeout(() => { if (revealPending.current === detail.nodeId) revealPending.current = null; }, 700);
        setRevealId(detail.nodeId);
        clearTimeout(revealTimer.current);
        revealTimer.current = setTimeout(() => setRevealId(null), 1600);
      };
      setTimeout(attempt, 30);
    }
    // Epic 13 — the stencil library opens from the sidebar "Add new" palette now.
    function openStencils() { setStencilOpen(true); }
    window.addEventListener('stemma:layout-changed', refreshFromLayout);
    window.addEventListener('stemma:nudge', nudge);
    window.addEventListener('stemma:place-node', placeNode);
    window.addEventListener('stemma:focus-node', focusNode);
    window.addEventListener('stemma:open-stencils', openStencils);
    return () => {
      window.removeEventListener('stemma:layout-changed', refreshFromLayout);
      window.removeEventListener('stemma:nudge', nudge);
      window.removeEventListener('stemma:place-node', placeNode);
      window.removeEventListener('stemma:focus-node', focusNode);
      window.removeEventListener('stemma:open-stencils', openStencils);
    };
  }, [workspace, layoutKey]);

  // ---- Copy, paste, duplicate, and copying a look (F-015). The gestures arrive as window events
  // from the shortcuts and menus; what a copy holds and where a paste lands are decided in
  // lib/clipboard, and the operations are carried out by lib/paste.

  /** What is selected on the canvas: the marquee / Ctrl-click set, or the one selected element. */
  const selectedForCopy = useCallback((): string[] => {
    const multi = getNodes().filter((n) => n.selected).map((n) => n.id);
    if (multi.length > 0) return multi;
    const one = useApp.getState().selectedElementId;
    return one ? [one] : [];
  }, [getNodes]);

  const clipOf = useCallback((ids: string[]): Clip | null => {
    const st = useApp.getState();
    if (!st.arch || !workspace) return null;
    const boxes: Record<string, { x: number; y: number; w: number; h: number }> = {};
    for (const n of getNodes()) {
      if (n.hidden) continue;
      const { w, h } = nodeSize(n);
      boxes[n.id] = { x: n.position.x, y: n.position.y, w: n.measured?.width ?? w, h: n.measured?.height ?? h };
    }
    return buildClip(st.arch, ids, {
      viewKey: String(layoutKey), boxes,
      nodeStyles: st.nodeStyles, edgeStyles: st.edgeStyles, customProps: st.customProps,
      note: (id) => loadNote(workspace.rootPath, id),
    });
  }, [getNodes, layoutKey, workspace]);

  /** The middle of what is on screen, and whether a box in flow coordinates is on screen at all. */
  const screenInFlow = useCallback(() => {
    const rect = wrapperRef.current?.getBoundingClientRect();
    if (!rect) return { centre: { x: 200, y: 160 }, shows: () => false };
    const a = screenToFlowPosition({ x: rect.left, y: rect.top });
    const b = screenToFlowPosition({ x: rect.right, y: rect.bottom });
    return {
      centre: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
      shows: (p: Point, size: { w: number; h: number }) => p.x < b.x && p.x + size.w > a.x && p.y < b.y && p.y + size.h > a.y,
    };
  }, [screenToFlowPosition]);

  useEffect(() => {
    function onFlash(ev: Event) {
      const wanted = new Set(((ev as CustomEvent).detail?.ids as string[] | undefined) ?? []);
      const move = (ev as CustomEvent).detail?.move !== false;
      // After the undo has been drawn: a move lands on the next render.
      requestAnimationFrame(() => requestAnimationFrame(() => {
        const here = getNodes().filter((n) => wanted.has(n.id) && !n.hidden);
        if (here.length === 0) return;
        const screen = screenInFlow();
        const seen = here.some((n) => screen.shows(n.position, { w: n.measured?.width ?? 200, h: n.measured?.height ?? 92 }));
        if (!seen && move) fitView({ nodes: here.map((n) => ({ id: n.id })), padding: 0.4, duration: prefersReducedMotion() ? 0 : 450, maxZoom: 1.2 });
        setFlashIds(new Set(here.map((n) => n.id)));
        clearTimeout(flashTimer.current);
        flashTimer.current = setTimeout(() => setFlashIds(new Set()), 1400);
      }));
    }
    window.addEventListener('stemma:flash', onFlash);
    return () => window.removeEventListener('stemma:flash', onFlash);
  }, [getNodes, screenInFlow, fitView]);

  const pasteClip = useCallback(async (clip: Clip, at: Point, description: string) => {
    const st = useApp.getState();
    if (!st.arch) return;
    const plan = planPaste(clip, st.arch, {
      at,
      contextAt: (p) => bcAtPoint(bcBoxes(getNodes()), p),
      sizeOf: (id) => { const e = clip.elements.find((x) => x.id === id); return { w: e?.nodeStyle?.width ?? 200, h: e?.nodeStyle?.height ?? 92 }; },
    });
    const result = await executePaste(plan, String(layoutKey), description);
    if (result.created.length > 0) {
      // The copies are what the next gesture is about: drag them, duplicate again, delete them.
      if (result.created.length === 1) useApp.getState().selectElement(result.created[0]);
      else useApp.getState().selectElement(null);
      window.dispatchEvent(new CustomEvent('stemma:select-nodes', { detail: { ids: result.created } }));
    }
    if (result.failed) { setToast({ kind: 'error', text: result.failed }); return; }
    const kinds = plan.elements.map((e) => e.kind);
    const unseen = activeCustomView ? 0 : kinds.filter((k) => !viewRendersKind(view, k)).length;
    setToast({
      kind: 'success',
      text: unseen > 0 ? `${description} — ${unseen} not drawn on this lens; they are in the model` : description,
    });
  }, [getNodes, layoutKey, setToast, activeCustomView, view]);

  useEffect(() => {
    function described(verb: string, clip: Clip): string {
      return clip.elements.length === 1 ? `${verb} ${clip.elements[0].name}` : `${verb} ${clip.elements.length} elements`;
    }
    function onCopy() {
      const clip = clipOf(selectedForCopy());
      if (!clip) return;
      holdClip(clip);
      // The names, as text, for whatever the person pastes into next. Refused on an insecure origin.
      navigator.clipboard?.writeText(clipText(clip)).catch(reportFailure('Canvas', ClientEvent.Unhandled, 'Copying names as text'));
      // No toast: a copy is expected to work, and the paste that follows is what shows it did. The
      // copied boxes are ringed for a moment instead, so the person sees what went onto the clipboard.
      window.dispatchEvent(new CustomEvent('stemma:flash', { detail: { ids: clip.elements.map((e) => e.id), move: false } }));
    }
    function onPaste(ev: Event) {
      const clip = heldClip();
      if (!clip || history.groupOpen) return;
      const at = (ev as CustomEvent).detail?.at as { clientX: number; clientY: number } | undefined;
      const screen = screenInFlow();
      let origin: Point;
      if (at) {
        // Paste here: the copy's corner where the menu was opened.
        origin = screenToFlowPosition({ x: at.clientX, y: at.clientY });
      } else {
        origin = pasteOrigin(clip, {
          viewKey: String(layoutKey), pasteCount: nextPasteCount(),
          originalsOnScreen: screen.shows(clip.origin, clip.size), viewportCentre: screen.centre,
        });
      }
      void pasteClip(clip, origin, described('Pasted', clip));
    }
    function onDuplicate() {
      if (history.groupOpen) return;
      const clip = clipOf(selectedForCopy());
      if (!clip) return;
      // In place, a step down and right; the clipboard is left as it was.
      void pasteClip(clip, { x: clip.origin.x + CASCADE, y: clip.origin.y + CASCADE }, described('Duplicated', clip));
    }
    function onCopyStyle() {
      const st = useApp.getState();
      if (st.selectedLinkId) {
        holdStyle({ target: 'edge', style: { ...(st.edgeStyles[st.selectedLinkId] ?? DEFAULT_EDGE_STYLE) } });
        setToast({ kind: 'info', text: 'Copied the relationship\'s style' });
        return;
      }
      const id = selectedForCopy()[0];
      if (!id) return;
      holdStyle({ target: 'node', style: lookOf(st.nodeStyles[id] ?? { borderWidth: 1, borderStyle: 'solid' }) });
      const name = st.arch?.elements.find((e) => e.id === id)?.name ?? 'the element';
      setToast({ kind: 'info', text: `Copied ${name}'s style` });
    }
    function onPasteStyle() {
      const st = useApp.getState();
      if (st.selectedLinkId) {
        const held = heldStyleFor('edge');
        if (!held || held.target !== 'edge') { setToast({ kind: 'info', text: 'Copy a relationship\'s style first (⌥⌘C)' }); return; }
        if (!history.beginGroup('Paste style')) return;
        st.setEdgeStyleFor(st.selectedLinkId, { ...held.style });
        history.endGroup();
        setToast({ kind: 'success', text: 'Pasted the style' });
        return;
      }
      const ids = selectedForCopy();
      const held = heldStyleFor('node');
      if (ids.length === 0) return;
      if (!held || held.target !== 'node') { setToast({ kind: 'info', text: 'Copy an element\'s style first (⌥⌘C)' }); return; }
      const description = ids.length === 1 ? 'Paste style' : `Paste style to ${ids.length} elements`;
      // While a paste is still being written its group is open; this waits its turn rather than join it.
      if (!history.beginGroup(description)) return;
      for (const id of ids) st.setNodeStyleFor(id, pasteLook(useApp.getState().nodeStyles[id], held.style));
      history.endGroup();
      setToast({ kind: 'success', text: ids.length === 1 ? 'Pasted the style' : `Pasted the style to ${ids.length} elements` });
    }
    function onSelectNodes(ev: Event) {
      const ids = new Set(((ev as CustomEvent).detail?.ids as string[] | undefined) ?? []);
      if (ids.size === 0) return;
      // The copies arrive with the model read back after the last operation; wait for them, briefly.
      let tries = 0;
      const attempt = () => {
        const present = getNodes().filter((n) => ids.has(n.id)).length;
        if (present < ids.size && tries++ < 30) { setTimeout(attempt, 60); return; }
        setNodes((current) => current.map((n) => ({ ...n, selected: ids.has(n.id) })));
      };
      attempt();
    }
    window.addEventListener('stemma:copy', onCopy);
    window.addEventListener('stemma:paste', onPaste);
    window.addEventListener('stemma:duplicate', onDuplicate);
    window.addEventListener('stemma:copy-style', onCopyStyle);
    window.addEventListener('stemma:paste-style', onPasteStyle);
    window.addEventListener('stemma:select-nodes', onSelectNodes);
    return () => {
      window.removeEventListener('stemma:copy', onCopy);
      window.removeEventListener('stemma:paste', onPaste);
      window.removeEventListener('stemma:duplicate', onDuplicate);
      window.removeEventListener('stemma:copy-style', onCopyStyle);
      window.removeEventListener('stemma:paste-style', onPasteStyle);
      window.removeEventListener('stemma:select-nodes', onSelectNodes);
    };
  }, [clipOf, selectedForCopy, pasteClip, screenInFlow, screenToFlowPosition, layoutKey, setToast, getNodes]);

  const persistPositions = useCallback((next: Node[]) => {
    if (!workspace) return;
    const key = String(layoutKey);
    const constraint = loadViewConstraint(workspace.rootPath, key);

    if (constraint) {
      // Record the delta from the solved slot rather than the absolute position. That is what keeps
      // the constraint alive: nudging one label to line up with an arrow must not dissolve the grid
      // aligning the other six, and a nudge has to travel with its slot when the grid is re-solved.
      const governed = new Set(constraintIds(constraint));
      const sizes = sizesFor(next.map((n) => ({ id: n.id, name: String((n.data as { element?: { name?: string } })?.element?.name ?? n.id) })), measuredSizesRef.current);
      const positions: Record<string, SavedPosition> = {};
      for (const n of next) {
        if (governed.has(n.id)) {
          saveViewOffset(workspace.rootPath, key, n.id, offsetForDrag(n.id, n.position, constraint, sizes));
        } else {
          positions[n.id] = { x: n.position.x, y: n.position.y };
        }
      }
      if (Object.keys(positions).length > 0) saveLayout(workspace.rootPath, layoutKey as ViewKind, positions);
      return;
    }

    const positions: Record<string, SavedPosition> = {};
    for (const n of next) positions[n.id] = { x: n.position.x, y: n.position.y };
    saveLayout(workspace.rootPath, layoutKey as ViewKind, positions);
  }, [workspace, layoutKey]);

  // An arrangement is a move like a drag: one ⌘Z puts every box back where it was. Before, an auto
  // layout, an align or a nudge could not be undone, and ⌘Z undid the model edit before it instead.
  const recordArrangement = useCallback((before: Node[], after: Node[], description: string, key?: string) => {
    if (!workspace) return;
    const at = (ns: Node[]) => Object.fromEntries(ns.map((n) => [n.id, { x: n.position.x, y: n.position.y }]));
    const diff = diffPositions(at(before), at(after));
    if (isEmptyDiff(diff)) return;
    layoutUndo.push({ workspaceRoot: workspace.rootPath, viewKey: String(layoutKey), before: diff.before, after: diff.after, description, ts: Date.now(), key });
  }, [workspace, layoutKey]);
  // For handlers bound earlier in this component than the two above.
  arrange.current = { persistPositions, recordArrangement };

  const onNodesChange = useCallback((changes: NodeChange[]) => {
    setNodes((current) => {
      // Capture pre-drag positions on the first `dragging: true` change of a session.
      const startedDragging = changes.some((c) => c.type === 'position' && c.dragging);
      if (startedDragging && dragStartPositions.current === null) {
        const snap: Record<string, SavedPosition> = {};
        for (const n of current) snap[n.id] = { x: n.position.x, y: n.position.y };
        dragStartPositions.current = snap;
      }

      const next = applyNodeChanges(changes, current);
      const positionEnded = changes.some((c) => c.type === 'position' && c.position && !c.dragging);
      if (positionEnded) {
        persistPositions(next);
        if (workspace && dragStartPositions.current) {
          const after: Record<string, SavedPosition> = {};
          for (const n of next) after[n.id] = { x: n.position.x, y: n.position.y };
          const diff = diffPositions(dragStartPositions.current, after);
          if (!isEmptyDiff(diff)) {
            const movedCount = Object.keys(diff.after).length;
            layoutUndo.push({
              workspaceRoot: workspace.rootPath,
              viewKey: String(layoutKey),
              before: diff.before,
              after: diff.after,
              description: movedCount === 1 ? 'Move node' : `Move ${movedCount} nodes`,
              ts: Date.now(),
            });
            // A manual move takes this view off an auto layout so it stops re-arranging. Deferred
            // out of the setNodes updater so it doesn't set another store mid-render.
            queueMicrotask(() => useApp.getState().setViewLayout(String(layoutKey), 'custom'));
          }
          dragStartPositions.current = null;
        }
      }
      return next;
    });
  }, [persistPositions, workspace, layoutKey]);

  // Group-drag: dragging a Bounded Context container translates all its child modules with it.
  const groupDrag = useRef<{ id: string; last: { x: number; y: number }; childIds: string[] } | null>(null);

  const onNodeDragStart = useCallback((_: unknown, node: Node) => {
    if (!(node.data as { isContainer?: boolean }).isContainer || !arch) return;
    const childIds = arch.elements
      .filter((e) => e.kind === 'module' && e.attributes.contextId === node.id)
      .map((e) => e.id);
    groupDrag.current = { id: node.id, last: { x: node.position.x, y: node.position.y }, childIds };
  }, [arch]);

  const onNodeDrag = useCallback((_: unknown, node: Node) => {
    const g = groupDrag.current;
    if (!g || g.id !== node.id) return;
    const dx = node.position.x - g.last.x;
    const dy = node.position.y - g.last.y;
    if (dx === 0 && dy === 0) return;
    g.last = { x: node.position.x, y: node.position.y };
    const ids = new Set(g.childIds);
    setNodes((current) => current.map((n) => ids.has(n.id) ? { ...n, position: { x: n.position.x + dx, y: n.position.y + dy } } : n));
  }, []);

  // On drag stop: finish a BC group-drag (persist the moved children), or — for a module /
  // capability dropped over a different Bounded Context's box — re-parent it into that context
  // (writes contextId to Architecture.cs). Dropping among its own siblings does nothing.
  const onNodeDragStop = useCallback(async (_: unknown, node: Node) => {
    if (groupDrag.current?.id === node.id) {
      groupDrag.current = null;
      setNodes((current) => { persistPositions(current); return current; });
      return;
    }
    if (!arch) return;
    const el = arch.elements.find((x) => x.id === node.id);
    if (!el || (el.kind !== 'module' && el.kind !== 'capability')) return;
    const currentCtx = el.attributes.contextId ?? null;
    const { w, h } = nodeSize(node);
    const target = bcAtPoint(bcBoxes(nodes, node.id), { x: node.position.x + w / 2, y: node.position.y + h / 2 });
    if (!target || target === currentCtx) return;
    const r = await applyOperation({ kind: 'SetElementContext', opId: `op_${Date.now()}`, elementId: el.id, contextId: target });
    if ('reason' in r) setToast({ kind: 'error', text: friendlyOpError(r) });
    else {
      const bcName = arch.elements.find((x) => x.id === target)?.name ?? target;
      setToast({ kind: 'success', text: `Moved ${el.name} into ${bcName}` });
    }
  }, [arch, nodes, setToast, persistPositions]);

  const [menu, setMenu] = useState<ContextMenuState | null>(null);

  const onNodeClick: NodeMouseHandler = (_, node) => {
    if (notesEditingId && node.id !== notesEditingId) setNotesEditingId(null);
    select(node.id);
  };
  const onEdgeClick: EdgeMouseHandler = (_, edge) => {
    selectLink(edge.id);
    // F-020: recording a page's steps, a clicked relationship is the next one.
    const st = useApp.getState();
    // Only on the page's own view: an arrow the page does not draw is not a step it can play.
    if (!st.recordingSteps || !bookPage || edge.id.startsWith('__about__')) return;
    if (st.addStep(edge.id)) {
      const link = st.arch?.links.find((l) => l.id === edge.id);
      const name = (id: string) => st.arch?.elements.find((e) => e.id === id)?.name ?? id;
      const n = activePage(useApp.getState())?.steps.length ?? 0;
      setToast({ kind: 'info', text: `Step ${n}: ${link ? `${name(link.fromId)} → ${name(link.toId)}` : edge.id}` });
    }
  };
  // Double-click a relationship → edit its payload/kind in place (shift+dbl-click adds a waypoint).
  const onEdgeDoubleClick: EdgeMouseHandler = useCallback((ev, edge) => {
    if (ev.shiftKey || edge.id.startsWith('__about__')) return;
    startEdgeEdit(edge.id);
  }, [startEdgeEdit]);
  const onPaneClick = () => { if (notesEditingId) setNotesEditingId(null); select(null); selectLink(null); useApp.getState().selectShape(null); setMenu(null); };
  const onCanvasMove = useCallback(() => setMenu(null), []);

  const onNodeContextMenu = useCallback((e: React.MouseEvent, node: Node) => {
    e.preventDefault();
    select(node.id);
    // A right-click on a box outside the selection is about that box alone, as in a file browser;
    // one inside the selection is about all of it.
    setNodes((current) => current.some((n) => n.id === node.id && n.selected)
      ? current
      : current.map((n) => (n.selected === (n.id === node.id) ? n : { ...n, selected: n.id === node.id })));
    if (!arch) return;
    const elem = arch.elements.find((x) => x.id === node.id);
    if (!elem) return;
    const many = getNodes().filter((n) => n.selected && n.id !== node.id).length;
    const subject = many > 0 ? `${many + 1} elements` : null;
    const styleHeld = heldStyleFor('node') !== null;
    const fire = (name: string) => () => window.dispatchEvent(new CustomEvent(name));
    setMenu({
      x: e.clientX, y: e.clientY,
      items: [
        {
          id: 'rename', label: 'Rename', icon: ContextIcons.Edit3, opensDialog: true,
          hint: 'dbl-click',
          onClick: async () => {
            const next = await promptText({
              title: `Rename ${elem.name}`,
              initialValue: elem.name,
              confirmLabel: 'Rename',
            });
            if (!next || next === elem.name) return;
            await applyOrSay({ kind: 'RenameElement', opId: `op_${Date.now()}`, elementId: elem.id, newName: next });
          },
        },
        { id: 'sep-edit', label: '', onClick: () => {}, separator: true },
        { id: 'copy', label: subject ? `Copy ${subject}` : 'Copy', icon: ContextIcons.Copy, hint: SHORTCUT_HINTS.copy, onClick: fire('stemma:copy') },
        { id: 'duplicate', label: subject ? `Duplicate ${subject}` : 'Duplicate', icon: ContextIcons.CopyPlus, hint: SHORTCUT_HINTS.duplicate, onClick: fire('stemma:duplicate') },
        { id: 'copy-style', label: 'Copy style', icon: ContextIcons.Paintbrush, hint: SHORTCUT_HINTS.copyStyle, onClick: fire('stemma:copy-style') },
        {
          id: 'paste-style', label: subject ? `Paste style to ${subject}` : 'Paste style', icon: ContextIcons.PaintBucket,
          hint: SHORTCUT_HINTS.pasteStyle, disabled: !styleHeld, onClick: fire('stemma:paste-style'),
        },
        { id: 'sep-model', label: '', onClick: () => {}, separator: true },
        {
          id: 'copy-id', label: 'Copy id', icon: ContextIcons.Copy, hint: elem.id,
          onClick: () => {
            // Clipboard access is denied on an insecure origin and by user policy. The user sees
            // nothing copied, which is its own feedback, but the reason belongs in the log.
            navigator.clipboard?.writeText(elem.id).catch(reportFailure('Canvas', ClientEvent.Unhandled, 'Copying the element id'));
            setToast({ kind: 'success', text: `Copied ${elem.id}` });
          },
        },
        {
          id: 'set-status', label: 'Set status', icon: ContextIcons.TagIcon, opensDialog: true,
          onClick: async () => {
            const next = await pickFromList<string>({
              title: `Set status — ${elem.name}`,
              searchable: false,
              options: [
                { value: '', label: '(none)' },
                { value: 'current', label: 'Current', hint: '●' },
                { value: 'target', label: 'Target', hint: '◆' },
                { value: 'to-adapt', label: 'To adapt', hint: '◇' },
                { value: 'to-be-created', label: 'To be created', hint: '○' },
                { value: 'deprecated', label: 'Deprecated', hint: '━' },
                { value: 'proposed', label: 'Proposed', hint: '◇' },
              ],
            });
            if (next === null) return;
            // Only the status: the phase and dates already set stay as they are.
            const life = arch.tags.find((t) => t.targetId === elem.id)?.lifecycle;
            await applyOrSay({
              kind: 'SetLifecycle', opId: `op_${Date.now()}`,
              targetId: elem.id, status: next || null, phase: life?.phase ?? null, validFrom: life?.validFrom ?? null, validUntil: life?.validUntil ?? null,
            });
          },
        },
        ...((elem.kind === 'module' || elem.kind === 'capability') ? [{
          id: 'set-context', label: 'Move to Bounded Context…', icon: ContextIcons.Layers, opensDialog: true,
          onClick: async () => {
            const bcs = arch.elements.filter((x) => x.kind === 'boundedContext');
            if (bcs.length === 0) { setToast({ kind: 'info', text: 'No Bounded Contexts yet — add one first.' }); return; }
            const choice = await pickFromList<string>({
              title: `Move ${elem.name} to…`,
              options: [
                { value: '__none__', label: '(no context — top level)' },
                ...bcs.map((c) => ({ value: c.id, label: c.name, hint: c.id })),
              ],
            });
            if (choice === null) return;
            const ctxId = choice === '__none__' ? null : choice;
            const r = await applyOperation({ kind: 'SetElementContext', opId: `op_${Date.now()}`, elementId: elem.id, contextId: ctxId });
            if ('reason' in r) setToast({ kind: 'error', text: friendlyOpError(r) });
            else setToast({ kind: 'success', text: ctxId ? 'Moved into context' : 'Removed from context' });
          },
        }] : []),
        ...((elem.kind === 'question' || elem.kind === 'assumption' || elem.kind === 'risk') ? [{
          id: 'set-about', label: elem.attributes.aboutId ? 'Change what this is about…' : 'Link to an element (About)…',
          icon: ContextIcons.Workflow, opensDialog: true,
          onClick: async () => {
            const targets = arch.elements.filter((x) => x.id !== elem.id && x.kind !== 'question' && x.kind !== 'assumption' && x.kind !== 'risk');
            if (targets.length === 0) { setToast({ kind: 'info', text: 'Nothing to link to yet.' }); return; }
            const choice = await pickFromList<string>({
              title: `What is "${elem.name}" about?`,
              options: [
                { value: '__none__', label: '(nothing / clear the link)' },
                ...targets.map((t) => ({ value: t.id, label: t.name, hint: t.kind })),
              ],
            });
            if (choice === null) return;
            const value = choice === '__none__' ? null : choice;
            const r = await applyOperation({ kind: 'SetElementAttribute', opId: `op_${Date.now()}`, elementId: elem.id, attributeName: 'aboutId', value });
            if ('reason' in r) setToast({ kind: 'error', text: friendlyOpError(r) });
            else setToast({ kind: 'success', text: value ? 'Linked' : 'Unlinked' });
          },
        }] : []),
        { id: 'sep', label: '', onClick: () => {}, separator: true },
        {
          id: 'delete', label: `Delete ${elem.name}`, icon: ContextIcons.Trash2, destructive: true,
          onClick: async () => {
            const ok = await confirmAction({ title: `Remove ${elem.name}?`, confirmLabel: 'Remove', destructive: true });
            if (!ok) return;
            await applyOrSay({ kind: 'RemoveElement', opId: `op_${Date.now()}`, elementId: elem.id }, `Removed ${elem.name}`);
          },
        },
      ],
    });
  }, [arch, select, setToast, getNodes]);

  const onEdgeContextMenu = useCallback((e: React.MouseEvent, edge: Edge) => {
    e.preventDefault();
    selectLink(edge.id);
    const link = useApp.getState().arch?.links.find((l) => l.id === edge.id);
    const fire = (name: string) => () => window.dispatchEvent(new CustomEvent(name));
    setMenu({
      x: e.clientX, y: e.clientY,
      items: [
        { id: 'copy-style', label: 'Copy style', icon: ContextIcons.Paintbrush, hint: SHORTCUT_HINTS.copyStyle, onClick: fire('stemma:copy-style') },
        {
          id: 'paste-style', label: 'Paste style', icon: ContextIcons.PaintBucket, hint: SHORTCUT_HINTS.pasteStyle,
          disabled: heldStyleFor('edge') === null, onClick: fire('stemma:paste-style'),
        },
        { id: 'sep-style', label: '', onClick: () => {}, separator: true },
        {
          id: 'copy-id', label: 'Copy id', icon: ContextIcons.Copy, hint: edge.id,
          onClick: () => {
            navigator.clipboard?.writeText(edge.id).catch(reportFailure('Canvas', ClientEvent.Unhandled, 'Copying the relationship id'));
            setToast({ kind: 'success', text: `Copied ${edge.id}` });
          },
        },
        {
          id: 'edit-payload', label: `Edit ${LINK_FIELD_LABEL[linkLabelField(link?.kind ?? 'dependency')].toLowerCase()}`, icon: ContextIcons.Edit3, hint: 'dbl-click',
          onClick: () => startEdgeEdit(edge.id),
        },
        {
          // Found here, where an arrow is acted on, and not only under Appearance → Style.
          id: 'reverse', label: 'Reverse direction', icon: ContextIcons.ArrowLeftRight, disabled: !link,
          onClick: async () => {
            if (!link) return;
            const { id, error } = await relink(link, link.toId, link.fromId, 'Reverse relationship');
            if (error) setToast({ kind: 'error', text: error });
            else setToast({ kind: 'success', text: 'Relationship reversed' });
            selectLink(id);
          },
        },
        { id: 'sep', label: '', onClick: () => {}, separator: true },
        {
          id: 'delete', label: 'Delete relationship', icon: ContextIcons.Trash2, destructive: true,
          onClick: async () => {
            const ok = await confirmAction({ title: 'Remove this relationship?', confirmLabel: 'Remove', destructive: true });
            if (!ok) return;
            await applyOrSay({ kind: 'RemoveLink', opId: `op_${Date.now()}`, linkId: edge.id }, 'Relationship removed');
          },
        },
      ],
    });
  }, [selectLink, startEdgeEdit, setToast]);

  // AC7 — the strip that shows what the first element wrote. Held here rather than in the store
  // because it is a one-off piece of teaching, not application state anything else reads.
  const [firstSource, setFirstSource] = useState<DeclarationSource | null>(null);

  const explainFirstElement = useCallback(async (elementId: string, elementsBefore: number) => {
    if (!shouldExplainFirstElement(hasSeenFirstElementExplainer(), elementsBefore)) return;
    try {
      const source = await elementSource(elementId);
      // No source is a reason to stay quiet, never to show a reconstruction of what it probably says.
      if (source) setFirstSource(source);
    } catch (e) {
      reportFailure('Api', ClientEvent.RequestFailed, 'Reading the source of the first element')(e);
    }
  }, []);

  const dismissFirstSource = useCallback(() => {
    markFirstElementExplained();
    setFirstSource(null);
  }, []);

  const addElementAt = useCallback(async (kind: ArchElementKind, pos: SavedPosition) => {
    const fresh = useApp.getState().arch;
    const elementsBefore = fresh?.elements.length ?? 0;
    const name = suggestElementName(kind, fresh?.elements ?? []);
    const r = await applyOperation({ kind: 'AddElement', opId: `op_${Date.now()}`, elementKind: kind, name });
    if ('reason' in r) { setToast({ kind: 'error', text: friendlyOpError(r) }); return; }
    const revealed = await revealNewElement(r, { dropPos: pos });
    if (revealed) {
      setToast({ kind: 'success', text: revealToast(revealed) });
      // Land straight in the name field: creating an element is a typing flow, not a menu hunt.
      handleStartRename(revealed.id);
      // The one moment the premise can be demonstrated rather than asserted: this person has just
      // drawn their first box, so show them the line of C# it became (F-003 AC7).
      void explainFirstElement(revealed.id, elementsBefore);
    }
    else setToast({ kind: 'error', text: `Added ${name}, but it did not appear — try refreshing.` });
  }, [setToast, handleStartRename, explainFirstElement]);

  // A template is several elements added in one go: one step of the undo history, each box placed by
  // the id the engine gives it. It used to wait 80–200 ms and look the new boxes up by name, so a slow
  // engine or a name already in use left a box at a default slot, and a refused add went unsaid.
  const applyTemplate = useCallback(async (description: string, pos: SavedPosition, parts: { op: Omit<OperationEnvelope, 'opId'> | ((ids: string[]) => Omit<OperationEnvelope, 'opId'>); dx: number }[]): Promise<string[] | null> => {
    if (!workspace) return null;
    if (!history.beginGroup(description)) { setToast({ kind: 'error', text: 'Another change is still being written. Try again in a moment.' }); return null; }
    const ids: string[] = [];
    const placed: PresentationChange[] = [];
    try {
      for (const part of parts) {
        const op = typeof part.op === 'function' ? part.op(ids) : part.op;
        const r = await applyOperation({ ...op, opId: `op_${Date.now()}_t${ids.length}` } as OperationEnvelope);
        if ('reason' in r) { setToast({ kind: 'error', text: friendlyOpError(r) }); return null; }
        const id = addedId(r);
        if (!id) return null;
        ids.push(id);
        const positions = loadLayout(workspace.rootPath, layoutKey as ViewKind);
        const at = { x: pos.x + part.dx, y: pos.y };
        saveLayout(workspace.rootPath, layoutKey as ViewKind, { ...positions, [id]: at });
        placed.push({ section: 'position', view: String(layoutKey), id, before: undefined, after: at });
      }
      history.recordPresentation(placed, description);
      window.dispatchEvent(new CustomEvent('stemma:layout-changed', { detail: { viewKey: layoutKey } }));
      return ids;
    } finally {
      history.endGroup(await fetchUndoState().then((st) => st.undoTop).catch(() => null));
    }
  }, [workspace, layoutKey, setToast]);

  const templateBoundedContextWithModules = useCallback(async (pos: SavedPosition) => {
    const elements = useApp.getState().arch?.elements ?? [];
    const name = suggestElementName('boundedContext', elements);
    // Two modules with names that collide with nothing, the second named after the first exists.
    const first = suggestElementName('module', elements);
    const second = suggestElementName('module', [...elements, { id: '', kind: 'module', name: first, attributes: {} }]);
    const ids = await applyTemplate(`Add ${name} with 2 modules`, pos, [
      { op: { kind: 'AddElement', elementKind: 'boundedContext', name }, dx: 0 },
      { op: ([ctx]) => ({ kind: 'AddElement', elementKind: 'module', name: first, contextId: ctx }), dx: 240 },
      { op: ([ctx]) => ({ kind: 'AddElement', elementKind: 'module', name: second, contextId: ctx }), dx: 480 },
    ]);
    if (ids) setToast({ kind: 'success', text: `Template applied: ${name} + 2 modules` });
  }, [applyTemplate, setToast]);

  const templateSystemWithContainer = useCallback(async (pos: SavedPosition) => {
    const name = suggestElementName('softwareSystem', useApp.getState().arch?.elements ?? []);
    const ids = await applyTemplate(`Add ${name} with a container`, pos, [
      { op: { kind: 'AddElement', elementKind: 'softwareSystem', name }, dx: 0 },
      { op: ([sys]) => ({ kind: 'AddElement', elementKind: 'container', name: `${name} Service`, systemId: sys, containerKind: 'service' }), dx: 240 },
    ]);
    if (ids) setToast({ kind: 'success', text: `Template applied: ${name} system` });
  }, [applyTemplate, setToast]);

  // Middle of whatever the user is currently looking at — where a click-to-add element should land.
  const centreOfCanvas = useCallback((): SavedPosition => {
    const rect = wrapperRef.current?.getBoundingClientRect();
    return rect
      ? screenToFlowPosition({ x: rect.left + rect.width / 2 - 120, y: rect.top + rect.height / 2 - 60 })
      : { x: 200, y: 160 };
  }, [screenToFlowPosition]);

  // An open workspace whose model is still empty gets in-canvas guidance rather than a bare grid.
  const modelIsEmpty = shouldShowEmptyCanvasGuide(!!workspace, arch?.elements.length ?? 0);

  // Epic 13 — templates can be clicked from the sidebar palette (not just dragged). Drop them
  // near the centre of the current viewport so they land somewhere visible.
  useEffect(() => {
    function applyTemplate(ev: Event) {
      const which = (ev as CustomEvent).detail?.template as string | undefined;
      const center = centreOfCanvas();
      if (which === 'bcWithModules') templateBoundedContextWithModules(center);
      else if (which === 'systemWithContainer') templateSystemWithContainer(center);
    }
    window.addEventListener('stemma:apply-template', applyTemplate);
    return () => window.removeEventListener('stemma:apply-template', applyTemplate);
  }, [centreOfCanvas, templateBoundedContextWithModules, templateSystemWithContainer]);

  const onPaneContextMenu = useCallback((e: React.MouseEvent | MouseEvent) => {
    e.preventDefault();
    const me = e as MouseEvent;
    const dropPos = screenToFlowPosition({ x: me.clientX, y: me.clientY });
    const clip = heldClip();
    setMenu({
      x: me.clientX, y: me.clientY,
      items: [
        {
          id: 'paste-here',
          label: clip ? (clip.elements.length === 1 ? `Paste ${clip.elements[0].name} here` : `Paste ${clip.elements.length} elements here`) : 'Paste here',
          icon: ContextIcons.ClipboardPaste, hint: SHORTCUT_HINTS.paste, disabled: !clip,
          onClick: () => window.dispatchEvent(new CustomEvent('stemma:paste', { detail: { at: { clientX: me.clientX, clientY: me.clientY } } })),
        },
        { id: 'sep-paste', label: '', onClick: () => {}, separator: true },
        {
          id: 'add-module', label: 'Add Module here', icon: ContextIcons.Plus,
          onClick: async () => addElementAt('module', dropPos),
        },
        {
          id: 'add-bc', label: 'Add Bounded Context here', icon: ContextIcons.Plus,
          onClick: async () => addElementAt('boundedContext', dropPos),
        },
        {
          id: 'add-system', label: 'Add Software System here', icon: ContextIcons.Plus,
          onClick: async () => addElementAt('softwareSystem', dropPos),
        },
        { id: 'sep', label: '', onClick: () => {}, separator: true },
        {
          id: 'tpl-bc-modules', label: 'BC + 2 modules', icon: ContextIcons.Workflow,
          hint: 'template',
          onClick: async () => templateBoundedContextWithModules(dropPos),
        },
        {
          id: 'tpl-system-container', label: 'System + Container', icon: ContextIcons.Workflow,
          hint: 'template',
          onClick: async () => templateSystemWithContainer(dropPos),
        },
      ],
    });
  }, [screenToFlowPosition, addElementAt, templateBoundedContextWithModules, templateSystemWithContainer]);

  const onConnect = async (params: Connection) => {
    if (!arch || !params.source || !params.target) return;
    const linkKind = view === 'dependencyGraph' ? 'dependency' : 'dataFlow';
    // Remember the exact dots the user drew between; reconciled to the new link id on refresh so
    // the relationship stays on those dots instead of snapping to the geometric auto dock.
    if (params.sourceHandle || params.targetHandle) {
      pendingDock.current.push({
        from: params.source, to: params.target,
        handles: { source: params.sourceHandle ?? undefined, target: params.targetHandle ?? undefined },
      });
    }
    const result = await applyOperation({
      kind: 'AddLink', opId: `op_${Date.now()}`,
      linkKind, fromId: params.source, toId: params.target,
      payload: linkKind === 'dataFlow' ? 'Event' : null,
      dependencyKind: linkKind === 'dependency' ? 'uses' : null,
    });
    if ('reason' in result) setToast({ kind: 'error', text: friendlyOpError(result) });
    else setToast({ kind: 'success', text: 'Link added' });
  };

  // Drag a relationship endpoint to a new dot/box (draw.io-style). Same boxes, different dot →
  // presentation only (re-anchor the persisted handle). Different box → a model change (the old
  // link is removed and a new one added between the new endpoints).
  const onReconnect = useCallback(async (oldEdge: Edge, conn: Connection) => {
    if (oldEdge.id.startsWith('__about__') || !conn.source || !conn.target) return;
    const handles: EdgeHandlePair = { source: conn.sourceHandle ?? undefined, target: conn.targetHandle ?? undefined };
    if (conn.source === oldEdge.source && conn.target === oldEdge.target) {
      if (workspace) saveEdgeHandles(workspace.rootPath, layoutKey as ViewKind, oldEdge.id, handles);
      setEdgeHandles((prev) => ({ ...prev, [oldEdge.id]: handles }));
      return;
    }
    // The same relationship with a new end — its kind, label and look kept — not a new one of
    // whichever kind the view usually draws.
    const link = arch?.links.find((l) => l.id === oldEdge.id);
    if (!link) return;
    pendingDock.current.push({ from: conn.source, to: conn.target, handles });
    const { error } = await relink(link, conn.source, conn.target, 'Reconnect relationship');
    if (error) setToast({ kind: 'error', text: error });
    else setToast({ kind: 'success', text: 'Relationship reconnected' });
  }, [arch, workspace, layoutKey, setToast]);

  const onDragOver = useCallback((e: React.DragEvent) => {
    if (e.dataTransfer.types.includes('application/stemma-palette')
        || e.dataTransfer.types.includes('application/stemma-element')
        || e.dataTransfer.types.includes('application/stemma-template')
        || e.dataTransfer.types.includes('application/stemma-stencil')) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
    }
  }, []);

  const onDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault();
    const paletteKind = e.dataTransfer.getData('application/stemma-palette') as ArchElementKind | '';
    const template = e.dataTransfer.getData('application/stemma-template');
    const elementId = e.dataTransfer.getData('application/stemma-element');
    const stencilId = e.dataTransfer.getData('application/stemma-stencil');
    const dropPos = screenToFlowPosition({ x: e.clientX, y: e.clientY });

    if (stencilId && shapesEnabled && workspace) {
      const { findStencil } = await import('@/lib/stencils');
      const { addShape, newImage, saveShapes } = await import('@/lib/shapes');
      const stencil = findStencil(stencilId);
      if (stencil) {
        const shape = newImage(dropPos.x - 32, dropPos.y - 32, stencil.src, 64, 64);
        shape.label = stencil.label;
        try {
          const next = addShape(useApp.getState().shapes[layoutKey] ?? [], shape);
          useApp.getState().setShapesFor(layoutKey, next);
          saveShapes(workspace.rootPath, layoutKey, next, 'Add shape');
          useApp.getState().selectShape(shape.id);
        } catch (err) {
          setToast({ kind: 'error', text: (err as Error).message });
        }
      }
      return;
    }

    if (template === 'bcWithModules') {
      templateBoundedContextWithModules(dropPos);
      return;
    }
    if (template === 'systemWithContainer') {
      templateSystemWithContainer(dropPos);
      return;
    }

    if (paletteKind) {
      const fresh = useApp.getState().arch;
      const name = suggestElementName(paletteKind, fresh?.elements ?? []);
      const result = await applyOperation({
        kind: 'AddElement', opId: `op_${Date.now()}`,
        elementKind: paletteKind, name,
      });
      if ('reason' in result) { setToast({ kind: 'error', text: friendlyOpError(result) }); return; }
      // The element the engine says it added, on a lens that renders its kind, so it is never
      // silently filtered off-canvas. Offset by ~half a node so the new box lands centred under the
      // cursor, not down-right of it.
      const revealed = await revealNewElement(result, { dropPos: { x: dropPos.x - 100, y: dropPos.y - 44 } });
      if (!revealed) { setToast({ kind: 'error', text: `Added ${name}, but it did not appear — try refreshing.` }); return; }
      // Dropping a new module/capability inside a Bounded Context nests it there.
      if (paletteKind === 'module' || paletteKind === 'capability') {
        const target = bcAtPoint(bcBoxes(nodes), dropPos);
        if (target) await applyOrSay({ kind: 'SetElementContext', opId: `op_${Date.now()}`, elementId: revealed.id, contextId: target });
      }
      setToast({ kind: 'success', text: revealToast(revealed) });
      return;
    }

    if (elementId) {
      if (!activeCustomView) {
        setToast({ kind: 'info', text: 'Open or create a custom view (sidebar → Views) to add elements.' });
        return;
      }
      addElementToActiveView(elementId);
      if (workspace) {
        const positions = loadLayout(workspace.rootPath, layoutKey as ViewKind);
        positions[elementId] = { x: dropPos.x, y: dropPos.y };
        saveLayout(workspace.rootPath, layoutKey as ViewKind, positions);
      }
      setToast({ kind: 'success', text: `Added to "${activeCustomView.name}"` });
    }
  }, [screenToFlowPosition, setToast, activeCustomView, workspace, layoutKey, addElementToActiveView, templateBoundedContextWithModules, templateSystemWithContainer, nodes]);

  // Layout animation. We toggle a class on the canvas wrapper that enables a CSS
  // transform-transition on every React Flow node for ~600 ms after a relayout commits.
  // Implemented as a class rather than per-node inline styles so React Flow's wrapper
  // (which we don't own) picks it up via a single global rule.
  const [animatingLayout, setAnimatingLayout] = useState(false);
  const animateTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const triggerLayoutAnimation = useCallback(() => {
    setAnimatingLayout(true);
    if (animateTimerRef.current) clearTimeout(animateTimerRef.current);
    animateTimerRef.current = setTimeout(() => setAnimatingLayout(false), 650);
  }, []);
  useEffect(() => () => { if (animateTimerRef.current) clearTimeout(animateTimerRef.current); }, []);

  // Build a per-node bounds map. Width / height come from the rendered DOM
  // size (`measured`), falling back to any explicit style override (set when
  // the user resized the node), then to a kind-specific default. Defined
  // BEFORE handleAutoLayout because the latter feeds these into the force
  // layout for AABB-aware repulsion.
  const nodeBounds = useCallback((list: Node[]): Record<string, { x: number; y: number; w: number; h: number }> => {
    const out: Record<string, { x: number; y: number; w: number; h: number }> = {};
    for (const n of list) {
      const measured = (n as { measured?: { width?: number; height?: number } }).measured;
      const styleW = (n.style as React.CSSProperties | undefined)?.width;
      const styleH = (n.style as React.CSSProperties | undefined)?.height;
      const elKind = (n.data as { element?: { kind?: string } })?.element?.kind;
      const defaultW = elKind === 'person' ? 140 : 220;
      const defaultH = elKind === 'person' ? 44 : 100;
      const w = (typeof styleW === 'number' ? styleW : measured?.width) ?? defaultW;
      const h = (typeof styleH === 'number' ? styleH : measured?.height) ?? defaultH;
      out[n.id] = { x: n.position.x, y: n.position.y, w, h };
    }
    return out;
  }, []);

  const handleAutoLayout = useCallback((algo: LayoutAlgorithm) => {
    {
      const current = getNodes();
      const seed: Record<string, SavedPosition> = {};
      // Measured sizes from React Flow's rendered DOM — passed into the force layout so
      // its repulsion is AABB-aware, not centre-distance-only. Falls back to per-kind defaults
      // inside the algorithm if a node has no measurement yet.
      const sizes: Record<string, { w: number; h: number }> = {};
      const bounds = nodeBounds(current);
      for (const n of current) {
        seed[n.id] = { x: n.position.x, y: n.position.y };
        const b = bounds[n.id];
        if (b) sizes[n.id] = { w: b.w, h: b.h };
      }
      // User-tuned layout knobs from the Layout panel (read at call time, not closed over).
      const st = useApp.getState();
      let fresh: Record<string, SavedPosition>;
      switch (algo) {
        case 'hierarchical': fresh = layoutHierarchical(filtered.elements, filtered.links, st.hierParams); break;
        case 'force':        fresh = layoutForceDirected(filtered.elements, filtered.links, {}, { sizes, ...st.forceParams }); break;
        case 'byType':       fresh = layoutByType(filtered.elements, filtered.links, { view, sizes, ...st.byTypeParams }); break;
        case 'focused': {
          // The dropdown gates this entry on selection, but defend anyway: if no selection
          // is present, fall back to force-directed so the user always gets *some* result.
          const focusId = useApp.getState().selectedElementId;
          if (!focusId || !filtered.elements.some((e) => e.id === focusId)) {
            fresh = layoutForceDirected(filtered.elements, filtered.links, {}, { sizes, ...st.forceParams });
          } else {
            fresh = layoutFocused(focusId, filtered.elements, filtered.links);
          }
          break;
        }
      }
      const next = current.map((n) => ({ ...n, position: fresh[n.id] ?? n.position }));
      setNodes(next);
      persistPositions(next);
      recordArrangement(current, next, `${LAYOUT_LABEL[algo][0].toUpperCase()}${LAYOUT_LABEL[algo].slice(1)} layout`);
      setTimeout(() => fitWholeView(paddingUnderHeader(0.2), 600), 50);
    }
    triggerLayoutAnimation();
    setToast({ kind: 'success', text: `Applied ${LAYOUT_LABEL[algo]} layout` });
  }, [filtered, getNodes, persistPositions, recordArrangement, fitWholeView, setToast, triggerLayoutAnimation, nodeBounds]);

  const handleAlign = useCallback((axis: 'left' | 'right' | 'centerX' | 'top' | 'bottom' | 'centerY') => {
    const current = getNodes();
    const selected = current.filter((n) => n.selected).map((n) => n.id);
    if (selected.length < 2) return;
    const aligned = alignSelected(nodeBounds(current), selected, axis);
    const next = current.map((n) => ({ ...n, position: aligned[n.id] ?? n.position }));
    setNodes(next);
    persistPositions(next);
    recordArrangement(current, next, `Align ${selected.length} boxes`);
  }, [getNodes, persistPositions, recordArrangement, nodeBounds]);

  const handleFitSelection = useCallback(() => {
    const selected = nodes.filter((n) => n.selected);
    if (selected.length === 0) {
      fitWholeView(paddingUnderHeader(0.2), 400);
      return;
    }
    fitView({ nodes: selected.map((n) => ({ id: n.id })), padding: paddingUnderHeader(0.3), duration: 400 });
  }, [nodes, fitView, fitWholeView]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== 'f' && e.key !== 'F') return;
      // F alone: ⌘F is Find, and fitting the view under the find bar moved what was being searched.
      if (e.metaKey || e.ctrlKey || e.altKey || keyBelongsToFocus(e)) return;
      e.preventDefault();
      handleFitSelection();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [handleFitSelection]);

  const handleDeleteSelected = useCallback(async () => {
    await confirmAndRemoveElements(getNodes().filter((n) => n.selected).map((n) => n.id));
  }, [getNodes]);

  const handleDistribute = useCallback((axis: 'horizontal' | 'vertical') => {
    const current = getNodes();
    const selected = current.filter((n) => n.selected).map((n) => n.id);
    if (selected.length < 3) return;
    const distributed = distributeSelected(nodeBounds(current), selected, axis);
    const next = current.map((n) => ({ ...n, position: distributed[n.id] ?? n.position }));
    setNodes(next);
    persistPositions(next);
    recordArrangement(current, next, `Distribute ${selected.length} boxes`);
  }, [getNodes, persistPositions, recordArrangement, nodeBounds]);

  // The Layout panel (right-hand rail) drives arrange/align/distribute/fit/delete via this event,
  // since it lives outside the canvas component tree and can't call these handlers directly.
  useEffect(() => {
    function onLayoutAction(ev: Event) {
      const a = (ev as CustomEvent).detail as LayoutAction;
      switch (a.type) {
        case 'auto': handleAutoLayout(a.algorithm); break;
        case 'align': handleAlign(a.axis); break;
        case 'distribute': handleDistribute(a.axis); break;
        case 'fit': handleFitSelection(); break;
        case 'delete': handleDeleteSelected(); break;
      }
    }
    window.addEventListener(LAYOUT_ACTION_EVENT, onLayoutAction);
    return () => window.removeEventListener(LAYOUT_ACTION_EVENT, onLayoutAction);
  }, [handleAutoLayout, handleAlign, handleDistribute, handleFitSelection, handleDeleteSelected]);

  // ---- Find on this view (F-018). What matches stays lit and the rest fades, or goes; while the bar is
  // open it lights the canvas in place of a book page, and while presenting it does not.
  const find = useApp((s) => s.find);
  const cardFacts = useMemo<CardFacts[]>(() => {
    if (!find.open || !arch) return [];
    const names = new Map(arch.elements.map((e) => [e.id, e.name]));
    const tags = new Map(arch.tags.map((t) => [t.targetId, t]));
    return drawn.elements.map((e) => ({
      element: e,
      tag: tags.get(e.id),
      place: names.get(e.attributes.contextId ?? e.attributes.systemId ?? '') ?? null,
      note: notesById.get(e.id),
      props: customProps[e.id],
    }));
  }, [find.open, arch, drawn.elements, notesById, customProps]);
  // Matched at React's lower priority: the field takes each keystroke at once, and the canvas catches
  // up — each key used to rebuild every card and arrow before the next one could be typed.
  const findQuery = useDeferredValue(find.query);
  const findTokens = useMemo(() => parseQuery(findQuery), [findQuery]);
  const findFound = useMemo(() => {
    if (!find.open || findTokens.length === 0) return null;
    const hit = new Set(cardFacts.filter((f) => findMatchesCard(f, findTokens)).map((f) => f.element.id));
    // Reading order: top to bottom, then left to right, so Enter walks the picture the way an eye does.
    const at = new Map(nodes.map((n) => [n.id, n.position]));
    return [...hit].sort((a, b) => {
      const pa = at.get(a) ?? { x: 0, y: 0 }, pb = at.get(b) ?? { x: 0, y: 0 };
      return Math.abs(pa.y - pb.y) > 40 ? pa.y - pb.y : pa.x - pb.x;
    });
  }, [find.open, findTokens, cardFacts, nodes]);
  const findFacetList = useMemo(() => (find.open ? findFacets(cardFacts) : []), [find.open, cardFacts]);
  const spotLit = useMemo(
    () => (findFound && findFound.length > 0 && !readOnly ? spotlightLighting(findFound, drawn.elements) : null),
    [findFound, drawn.elements, readOnly],
  );
  const lit = spotLit ?? stepLit ?? pageLit;
  const litHides = spotLit ? find.mode === 'hide' : pageHides;

  // A Bounded Context that owns modules renders as a container box wrapping them: its position
  // + size are derived from the children's bounding box, it is drawn first (below the modules)
  // so they stay clickable on top, and it is not directly draggable — moving its modules
  // reshapes it. Elements without children pass through unchanged.
  const nestedNodes = useMemo<Node[]>(() => {
    const nestable = view === 'moduleMap' || view === 'dependencyGraph' || activeCustomView !== null;
    if (!nestable) return nodes;
    const byId = new Map(nodes.map((n) => [n.id, n]));
    const childrenByCtx = new Map<string, Node[]>();
    for (const n of nodes) {
      const el = (n.data as { element?: ArchElement }).element;
      if (!el || el.kind !== 'module') continue;
      const ctxId = el.attributes.contextId ?? undefined;
      if (!ctxId || !byId.has(ctxId)) continue;
      (childrenByCtx.get(ctxId) ?? childrenByCtx.set(ctxId, []).get(ctxId)!).push(n);
    }
    if (childrenByCtx.size === 0) return nodes;

    const containers: Node[] = [];
    const rest: Node[] = [];
    for (const n of nodes) {
      const el = (n.data as { element?: ArchElement }).element;
      if (el?.kind === 'boundedContext') {
        // On a page that hides the rest, a box wraps only what is left in it, or it frames empty space.
        const kids = childrenByCtx.get(el.id)?.filter((k) => !(litHides && lit && !lit.has(k.id)));
        if (kids && kids.length > 0) {
          const collapsed = collapsedBcs.has(el.id);
          const box = boundingBox(kids);
          const data = { ...n.data, isContainer: true, childCount: kids.length, collapsed, onToggleCollapse: () => toggleBcCollapsed(el.id) };
          // Collapsed → compact card at the cluster's top-left (no size override), modules hidden.
          // Expanded → full container sized to the children's bounding box. Draggable either way.
          containers.push(collapsed
            ? { ...n, position: { x: box.x, y: box.y }, draggable: true, zIndex: 0, data }
            : { ...n, position: { x: box.x, y: box.y }, style: { width: box.w, height: box.h }, draggable: true, zIndex: 0, data });
        } else {
          rest.push(n); // empty BC: ordinary card
        }
        continue;
      }
      // Hide modules whose Bounded Context is collapsed.
      if (el?.kind === 'module' && el.attributes.contextId && collapsedBcs.has(el.attributes.contextId) && byId.has(el.attributes.contextId)) continue;
      rest.push(n);
    }
    // Containers first so the contained modules paint (and receive clicks) on top of them.
    return [...containers, ...rest];
  }, [nodes, view, activeCustomView, collapsedBcs, toggleBcCollapsed, lit, litHides]);

  // ---- What changed (F-017). Comparing, a changed card wears a mark, what did not change fades, and
  // what was removed is drawn as a ghost where it used to sit — in the canvas's own coordinates but
  // outside its node list, so a ghost can never be dragged, laid out, saved or selected.
  const compare = useApp((s) => s.compare);
  const compareDimRest = useApp((s) => s.compareDimRest);
  const diff = useCompareDiff();
  const ghosts = useMemo(() => {
    if (!diff || !compare?.before || !workspace || diff.counts.removed === 0) return { cards: [], lines: [] };
    const removed = new Set(diff.elements.filter((c) => c.change === 'removed').map((c) => c.id));
    // What this view would have drawn of the model as it was: the same rule as for the model as it is.
    const thenDrawn = filterByView(compare.before, view, activeCustomView);
    const then = positionsAt(compare.layout, String(layoutKey));
    const now = loadLayout(workspace.rootPath, layoutKey as ViewKind);
    const sizes = sizesAt(compare.layout);
    const live = nodes.filter((n) => !n.hidden);
    const bottom = live.length ? Math.max(...live.map((n) => n.position.y + (n.measured?.height ?? 92))) : 0;
    const left = live.length ? Math.min(...live.map((n) => n.position.x)) : 0;
    let shelf = 0;
    const cards = thenDrawn.elements.filter((e) => removed.has(e.id)).map((e) => {
      const at = then[e.id] ?? now[e.id] ?? { x: left + (shelf++) * 240, y: bottom + 90 };
      const size = sizes[e.id] ?? { w: 200, h: 84 };
      return { id: e.id, name: e.name, kind: e.kind, x: at.x, y: at.y, w: size.w, h: size.h };
    });
    const centre = new Map<string, { x: number; y: number }>();
    for (const n of live) centre.set(n.id, { x: n.position.x + (n.measured?.width ?? 200) / 2, y: n.position.y + (n.measured?.height ?? 92) / 2 });
    for (const c of cards) centre.set(c.id, { x: c.x + c.w / 2, y: c.y + c.h / 2 });
    const goneLinks = new Set(diff.links.filter((c) => c.change === 'removed').map((c) => c.id));
    const lines = thenDrawn.links
      .filter((l) => goneLinks.has(l.id) && centre.has(l.fromId) && centre.has(l.toId))
      .map((l) => ({ id: l.id, from: centre.get(l.fromId)!, to: centre.get(l.toId)! }));
    return { cards, lines };
  }, [diff, compare, workspace, view, activeCustomView, layoutKey, nodes]);

  useEffect(() => {
    function onFocusGhost(ev: Event) {
      const id = (ev as CustomEvent).detail?.id as string | undefined;
      const card = ghosts.cards.find((c) => c.id === id);
      if (!card) {
        setToast({ kind: 'info', text: 'It was not drawn on this view — open the view it was on to see where it was.' });
        return;
      }
      // Close enough to read, with its old neighbours still around it — the same limit a reveal keeps.
      const rfEl = wrapperRef.current?.querySelector('.react-flow') as HTMLElement | null;
      if (!rfEl) return;
      const vp = getViewportForBounds({ x: card.x, y: card.y, width: card.w, height: card.h }, rfEl.clientWidth, rfEl.clientHeight, 0.05, 1.2, 0.45);
      setViewport(vp, { duration: prefersReducedMotion() ? 0 : 450 });
    }
    window.addEventListener('stemma:focus-ghost', onFocusGhost);
    return () => window.removeEventListener('stemma:focus-ghost', onFocusGhost);
  }, [ghosts, setViewport, setToast]);

  // A book page points: what it focuses stays lit and the rest fades, or goes, when the page says
  // `hide`. Applied on the wrapper's opacity so a bounded-context box fades the same way a card does.
  //
  // Presenting, and while the PDF export takes its pictures, the canvas is looked at and not edited.
  // A node's own `draggable` outranks the canvas-wide switch in React Flow, so the switch alone left
  // every box draggable — and a drop onto another bounded context rewrites Architecture.cs. Every way
  // in is taken off the nodes and edges themselves: drag, select, resize, rename, notes, label edits,
  // waypoints, arrowheads.
  // What each card was turned into last time, by the card it came from and what was applied to it: a
  // card whose lighting, mark and state did not change is handed back as the same object, so lighting
  // three matches out of three hundred draws three cards again, not three hundred.
  const renderedNodeCache = useRef(new WeakMap<Node, { key: string; node: Node }>());
  const renderedNodes = useMemo<Node[]>(() => {
    if (!lit && !readOnly && !revealId && flashIds.size === 0 && !diff) return nestedNodes;
    const cache = renderedNodeCache.current;
    return nestedNodes.map((n) => {
      const key = [
        n.id === revealId || flashIds.has(n.id) ? 'r' : '',
        diff ? diff.elementChange.get(n.id) ?? (compareDimRest ? 'dim' : '-') : '',
        readOnly ? 'ro' : '',
        lit ? (lit.has(n.id) ? 'lit' : litHides ? 'hide' : 'fade') : '',
      ].join('|');
      const hit = cache.get(n);
      if (hit && hit.key === key) return hit.node;
      let out = n;
      if (n.id === revealId || flashIds.has(n.id)) out = { ...out, data: { ...out.data, revealed: true } };
      if (diff) {
        const change = diff.elementChange.get(n.id);
        if (change) out = { ...out, data: { ...out.data, diff: change } };
        else if (compareDimRest) out = { ...out, style: { ...out.style, opacity: 0.3 } };
      }
      if (readOnly) {
        out = {
          ...out, draggable: false, selectable: false, selected: false,
          data: {
            ...out.data, resizable: false, editing: false, notesEditing: false,
            onStartRename: undefined, onCommitName: undefined, onCancelEdit: undefined, onResize: undefined,
            onChangeNotes: undefined, onCommitNotes: undefined, onCloseNotes: undefined,
          },
        };
      }
      if (lit && !lit.has(n.id)) {
        out = litHides ? { ...out, hidden: true } : { ...out, style: { ...out.style, opacity: 0.2 } };
      }
      cache.set(n, { key, node: out });
      return out;
    });
  }, [nestedNodes, lit, litHides, readOnly, revealId, flashIds, diff, compareDimRest]);

  const renderedEdgeCache = useRef(new WeakMap<Edge, { key: string; edge: Edge }>());
  const renderedEdges = useMemo<Edge[]>(() => {
    if (!lit && !readOnly && !diff) return allEdges;
    const cache = renderedEdgeCache.current;
    return allEdges.map((e) => {
      const step = !spotLit ? stepNumber.get(e.id) : undefined;
      const key = [
        diff ? diff.linkChange.get(e.id) ?? (compareDimRest ? 'dim' : '-') : '',
        readOnly ? 'ro' : '',
        step !== undefined ? `s${step}${stepState.current?.link === e.id ? '*' : ''}` : stepNumber.size > 0 && !spotLit ? 'flow' : '',
        lit ? (lit.has(e.source) && lit.has(e.target) ? 'lit' : 'out') : '',
        litHides ? 'h' : '',
      ].join('|');
      const hit = cache.get(e);
      if (hit && hit.key === key) return hit.edge;
      let out = e;
      if (diff) {
        const change = diff.linkChange.get(e.id);
        const width = Math.max(Number(out.style?.strokeWidth ?? 1.5), 2.5);
        if (change === 'added') out = { ...out, style: { ...out.style, stroke: '#10b981', strokeWidth: width } };
        else if (change === 'changed') out = { ...out, style: { ...out.style, stroke: '#f59e0b', strokeWidth: width } };
        else if (compareDimRest) out = { ...out, style: { ...out.style, opacity: 0.15 }, labelStyle: { ...out.labelStyle, opacity: 0.35 } };
      }
      if (readOnly) {
        out = {
          ...out, selectable: false, selected: false, reconnectable: false,
          data: {
            ...out.data, editing: false,
            onAddWaypoint: undefined, onRemoveWaypoint: undefined, onEditStart: undefined,
            onToggleArrow: undefined, onSetType: undefined,
          },
        };
      }
      const n = !spotLit ? stepNumber.get(e.id) : undefined;
      if (n !== undefined) {
        // A step: its number on its label, and the one being talked about in the books' amber, moving.
        const current = stepState.current?.link === e.id;
        out = {
          ...out,
          label: `${stepMark(n)} ${typeof out.label === 'string' ? out.label : ''}`.trim(),
          animated: current || out.animated,
          style: current ? { ...out.style, stroke: '#f59e0b', strokeWidth: Math.max(Number(out.style?.strokeWidth ?? 1.5), 3.5), opacity: 1 } : { ...out.style, opacity: 1 },
          data: { ...out.data, stepCurrent: current },
        };
      } else if (stepNumber.size > 0 && !spotLit) {
        // While a flow plays, only its arrows are lit: two lit boxes do not light every line between them.
        out = litHides ? { ...out, hidden: true } : { ...out, style: { ...out.style, opacity: 0.15 } };
      } else if (lit && !(lit.has(e.source) && lit.has(e.target))) {
        out = litHides ? { ...out, hidden: true } : { ...out, style: { ...out.style, opacity: 0.15 } };
      }
      cache.set(e, { key, edge: out });
      return out;
    });
  }, [allEdges, lit, litHides, readOnly, diff, compareDimRest, spotLit, stepNumber, stepState]);

  const selectedNodeIds = useMemo(() => nodes.filter((n) => n.selected).map((n) => n.id), [nodes]);
  const selectedCount = selectedNodeIds.length;
  // Publish the multi-selection count so the right-hand Layout panel can gate align/distribute.
  // Selecting 2+ elements jumps the inspector to the Layout panel (Align & distribute sits on top),
  // but the user's own tab choice is restored once the multi-selection is gone.
  const tabBeforeLayoutJump = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    const st = useApp.getState();
    st.setCanvasSelection(selectedCount, selectedNodeIds);
    if (selectedCount >= 2) {
      if (st.inspectorTab !== 'layout' && tabBeforeLayoutJump.current === undefined) tabBeforeLayoutJump.current = st.inspectorTab;
      st.setInspectorTab('layout');
    } else if (tabBeforeLayoutJump.current !== undefined) {
      // Only restore if the user didn't pick another panel while multi-selected.
      if (st.inspectorTab === 'layout') st.setInspectorTab(tabBeforeLayoutJump.current);
      tabBeforeLayoutJump.current = undefined;
    }
    // The ids, not only the count: clicking one box after another is a new selection of one, and a
    // book page that takes the selection as its focus must get the second box.
  }, [selectedCount, selectedNodeIds.join('\u0000')]); // eslint-disable-line react-hooks/exhaustive-deps
  const isDark = theme === 'dark';
  const bgColor = isDark ? 'rgb(9 9 11)' : 'rgb(248 250 252)';
  const dotColor = isDark ? 'rgb(45 45 50)' : 'rgb(212 217 224)';

  // Shapes are gated to custom views (Epic 07 ADR-0009). `shapesEnabled` defined above.
  const setShapesFor = useApp((s) => s.setShapesFor);
  const [stencilOpen, setStencilOpen] = useState(false);

  // Prime the shape cache ONCE per workspace open. Re-priming on every view switch
  // races the debounced layout-sidecar PUT and can clobber an in-flight create with
  // stale server data — that's the "shape disappears when I change view" bug.
  const primedFor = useRef<string | null>(null);
  useEffect(() => {
    if (!workspace) return;
    if (primedFor.current === workspace.rootPath) return;
    primedFor.current = workspace.rootPath;
    primeShapeCache(workspace.rootPath).then(() => {
      // Hydrate every view that exists in the sidecar so view switches read from store, not the wire.
      const fresh = useApp.getState();
      const known = Object.keys(fresh.shapes);
      const candidates = new Set<string>([layoutKey, ...known]);
      candidates.forEach((key) => setShapesFor(key, loadShapes(workspace.rootPath, key)));
    }).catch(reportFailure('Sidecar', ClientEvent.SidecarWriteFailed, 'Priming the shape cache'));
  }, [workspace?.rootPath, setShapesFor, layoutKey]);

  // On view switch, refresh the active view's shapes from the (already-primed) cache
  // without going back to the server. If the cache has the latest local edits — including
  // not-yet-flushed debounced writes — they survive the round-trip.
  useEffect(() => {
    if (!workspace) return;
    if (primedFor.current !== workspace.rootPath) return;
    setShapesFor(layoutKey, loadShapes(workspace.rootPath, layoutKey));
  }, [workspace?.rootPath, layoutKey, setShapesFor]);

  return (
    <div
      // The surface the canvas paints on. Named so the publication profile can clear it: this is an
      // inline style, and the profile's `!important` rule needs a selector that reaches the element
      // (B-003 — the export was transparent everywhere except here, so every PNG shipped opaque).
      className={clsx('stemma-canvas-surface h-full w-full relative', animatingLayout && 'stemma-anim-layout', bookPage && !capturing && 'stemma-book-page')}
      style={{ background: bgColor }}
      ref={wrapperRef}
      onDragOver={onDragOver}
      onDrop={onDrop}
    >
      {/* Canvas toolbar removed — arrange / align / snap now live in the right-hand Layout panel. */}
      {shapesEnabled && stencilOpen && workspace && !presenting && (
        <StencilDrawer
          viewKey={layoutKey}
          workspaceRoot={workspace.rootPath}
          onClose={() => setStencilOpen(false)}
        />
      )}
      <EdgeMarkerDefs markers={customMarkers} />
      <ReactFlow
        nodes={renderedNodes}
        edges={renderedEdges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        connectionMode={ConnectionMode.Loose}
        // Presenting is looking, not editing: nothing moves, connects or selects, and nothing is written.
        nodesDraggable={!presenting}
        nodesConnectable={!presenting}
        elementsSelectable={!presenting}
        // Allow zooming far out so elements dragged a long way off can always be found.
        minZoom={0.05}
        maxZoom={2.5}
        // Shift+drag on the pane = marquee selection of a group of nodes.
        selectionKeyCode="Shift"
        // Ctrl/Cmd+click on a node = additive selection of specific nodes.
        // Both keys are accepted so the same gesture works on Linux/Win and Mac.
        multiSelectionKeyCode={['Control', 'Meta']}
        snapToGrid={snapEnabled}
        snapGrid={[20, 20]}
        onNodesChange={onNodesChange}
        onNodeDragStart={onNodeDragStart}
        onNodeDrag={onNodeDrag}
        onNodeDragStop={onNodeDragStop}
        onNodeClick={presenting ? undefined : onNodeClick}
        onNodeDoubleClick={presenting ? undefined : onNodeDoubleClick}
        onEdgeClick={presenting ? undefined : onEdgeClick}
        onEdgeDoubleClick={presenting ? undefined : onEdgeDoubleClick}
        onPaneClick={presenting ? undefined : onPaneClick}
        onMove={onCanvasMove}
        onNodeContextMenu={presenting ? undefined : onNodeContextMenu}
        onEdgeContextMenu={presenting ? undefined : onEdgeContextMenu}
        onPaneContextMenu={presenting ? undefined : onPaneContextMenu}
        onConnect={presenting ? undefined : onConnect}
        onReconnect={presenting ? undefined : onReconnect}
        // Deletion is owned by the global Delete/Backspace shortcut (App), which routes through
        // model operations with confirmation — React Flow's local delete would desync the model.
        deleteKeyCode={null}
        proOptions={{ hideAttribution: true }}
        colorMode={isDark ? 'dark' : 'light'}
      >
        {!presenting && !capturing && <Background variant={BackgroundVariant.Dots} gap={20} size={1.2} color={dotColor} />}
        {!presenting && !capturing && <Controls />}
        {!presenting && !capturing && <MiniMap pannable zoomable nodeColor={() => 'rgb(99 102 241)'} />}
        {shapesEnabled && workspace && (
          <ShapeLayer viewKey={layoutKey} workspaceRoot={workspace.rootPath} enabled={!presenting} />
        )}
        {(ghosts.cards.length > 0 || ghosts.lines.length > 0) && !presenting && (
          <ViewportPortal>
            <GhostLayer cards={ghosts.cards} lines={ghosts.lines} since={compare?.label ?? ''} />
          </ViewportPortal>
        )}
        {!renderMode && workspace && (
          <ViewHeader viewKey={layoutKey} viewName={viewName} drawn={drawn} readOnly={readOnly} presenting={presenting} />
        )}
      </ReactFlow>
      {find.open && !presenting && !renderMode && (
        <FindBar
          matches={findFound}
          facets={findFacetList}
          viewId={activeCustomView?.id ?? (view === 'concerns' ? null : view)}
          onStep={(id) => window.dispatchEvent(new CustomEvent('stemma:focus-node', { detail: { nodeId: id } }))}
        />
      )}
      {modelIsEmpty && !presenting && (
        <EmptyCanvasGuide onAdd={(kind) => addElementAt(kind, centreOfCanvas())} />
      )}
      {firstSource && !presenting && <FirstElementStrip source={firstSource} onDismiss={dismissFirstSource} />}
      <ContextMenu state={menu} onClose={() => setMenu(null)} />
    </div>
  );
}

/**
 * What was removed, where it used to be (F-017 AC2): dashed, faded, struck through and labelled, so
 * colour is never the only thing that says so. Not interactive — it is a memory, not a card.
 */
function GhostLayer({ cards, lines, since }: {
  cards: { id: string; name: string; kind: string; x: number; y: number; w: number; h: number }[];
  lines: { id: string; from: { x: number; y: number }; to: { x: number; y: number } }[];
  since: string;
}) {
  return (
    <div className="pointer-events-none" aria-hidden>
      <svg className="absolute overflow-visible" style={{ left: 0, top: 0, width: 1, height: 1 }}>
        {lines.map((l) => (
          <line key={l.id} x1={l.from.x} y1={l.from.y} x2={l.to.x} y2={l.to.y} stroke="#f43f5e" strokeOpacity={0.55} strokeWidth={2} strokeDasharray="6 5" />
        ))}
      </svg>
      {cards.map((c) => (
        <div
          key={c.id}
          data-ghost={c.id}
          title={`Removed since ${since}`}
          className="absolute rounded-lg border-2 border-dashed border-rose-400/70 bg-rose-500/[0.06] dark:bg-rose-500/[0.08] px-3 py-2 flex flex-col gap-1"
          style={{ transform: `translate(${c.x}px, ${c.y}px)`, width: c.w, minHeight: c.h }}
        >
          <div className="flex items-center gap-2">
            <span className="text-[11px] uppercase tracking-wider text-rose-700 dark:text-rose-300 truncate">{kindLabel(c.kind)}</span>
            <span className="ml-auto text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-rose-700 text-white dark:bg-rose-500/25 dark:text-rose-100">Removed</span>
          </div>
          <div className="text-sm font-medium text-rose-800 dark:text-rose-200 line-through decoration-rose-500/70">{c.name}</div>
        </div>
      ))}
    </div>
  );
}

export function ArchCanvas() {
  return (
    <ReactFlowProvider>
      <CanvasInner />
    </ReactFlowProvider>
  );
}
