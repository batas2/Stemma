import { useMemo, useEffect, useState, useCallback, useRef } from 'react';
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
  getNodesBounds,
  getViewportForBounds,
} from '@xyflow/react';
import { ArchNodeView } from './nodes/ArchNodeView';
import { WaypointEdge } from './edges/WaypointEdge';
import { EdgeMarkerDefs, customMarkerId, type CustomMarker } from './edges/EdgeMarkerDefs';
import { LAYOUT_ACTION_EVENT, type LayoutAction } from './LayoutPanel';
import { ShapeLayer } from './ShapeLayer';
import { StencilDrawer } from './StencilDrawer';
import { loadShapes, primeShapeCache, type Shape } from '@/lib/shapes';

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

/** Approximate box rect of a node, for picking dock dots (uses measured size when available). */
function nodeRect(n: Node): DockRect {
  const w = n.measured?.width ?? (n.style?.width as number | undefined) ?? 220;
  const h = n.measured?.height ?? (n.style?.height as number | undefined) ?? 120;
  return { x: n.position.x, y: n.position.y, w, h };
}
import { ContextMenu, ContextIcons, type ContextMenuState } from './ContextMenu';
import { confirmAction } from './ConfirmDialog';
import { promptText, pickFromList } from './PromptDialog';
import { suggestElementName } from '@/lib/naming';
import { revealNewElement, revealToast } from '@/lib/canvasReveal';
import { useApp } from '@/lib/store';
import { applyOperation } from '@/lib/signalr';
import { friendlyOpError } from '@/lib/opError';
import { loadLayout, saveLayout, loadEdgeWaypoints, saveEdgeWaypoints, loadEdgeHandles, saveEdgeHandles, type EdgeHandlePair, type SavedPosition } from '@/lib/layout';
import { autoDock, type DockId, type DockRect } from '@/lib/edgeDock';
import { loadNote, saveNote } from '@/lib/elementNotes';
import { hashtagProps } from '@/lib/hashtags';
import { layoutUndo, diffPositions, isEmptyDiff } from '@/lib/layoutUndo';
import {
  layoutHierarchical, layoutForceDirected, layoutFocused, layoutByType,
  alignSelected, distributeSelected,
  type LayoutAlgorithm,
} from '@/lib/autoLayout';
import { dashArrayFor, DEFAULT_EDGE_STYLE, type EdgeArrow } from '@/lib/edgeStyles';

/** Resolve an endpoint style to a React Flow marker. Common arrows use built-in (reliably
 *  coloured) markers; the exotic shapes use the custom SVG markers in EdgeMarkerDefs. */
function edgeMarkerSpec(a: EdgeArrow | undefined, color?: string): EdgeMarker | string | undefined {
  switch (a) {
    case 'closed': return { type: MarkerType.ArrowClosed, color, width: 18, height: 18 };
    case 'open': return { type: MarkerType.Arrow, color, width: 18, height: 18 };
    case 'circle': case 'diamond': case 'pipe': return `url(#${customMarkerId(a, color)})`;
    default: return undefined; // 'none' / unset
  }
}
import type { ArchElement, ArchElementKind, ArchLink, ArchModel, ViewKind, CustomView } from '@/lib/types';

const nodeTypes = { arch: ArchNodeView };
const edgeTypes = { waypointed: WaypointEdge };

interface FilteredView {
  elements: ArchElement[];
  links: ArchLink[];
}

function filterByView(arch: ArchModel, view: ViewKind, customView: CustomView | null): FilteredView {
  if (customView) {
    const inView = arch.elements.filter((e) => customView.elementIds.includes(e.id));
    let elements = inView;
    if (customView.baseView !== 'all') {
      elements = applyKindFilter(inView, customView.baseView as ViewKind);
    }
    const ids = new Set(elements.map((e) => e.id));
    const links = arch.links.filter((l) => ids.has(l.fromId) && ids.has(l.toId));
    return { elements, links };
  }
  return applyBuiltIn(arch, view);
}

function applyKindFilter(elements: ArchElement[], view: ViewKind): ArchElement[] {
  switch (view) {
    case 'dependencyGraph': return elements.filter((e) => e.kind === 'module' || e.kind === 'boundedContext' || e.kind === 'capability');
    case 'moduleMap':
    default: return elements; // Module Map is the universal canvas — every kind renders
  }
}

function applyBuiltIn(arch: ArchModel, view: ViewKind): FilteredView {
  if (view === 'dependencyGraph') {
    // Include Bounded Contexts so we can group modules under their BC backdrops, and capabilities
    // so dependency arrows targeting a capability still render. Architects expect to see context.
    const elements = arch.elements.filter((e) =>
      e.kind === 'module' || e.kind === 'boundedContext' || e.kind === 'capability');
    const ids = new Set(elements.map((e) => e.id));
    const links = arch.links.filter((l) => l.kind === 'dependency' && ids.has(l.fromId) && ids.has(l.toId));
    return { elements, links };
  }
  // Module Map (and the fallback): every element kind, with its dataFlow links.
  const ids = new Set(arch.elements.map((e) => e.id));
  const links = arch.links.filter((l) => l.kind === 'dataFlow' && ids.has(l.fromId) && ids.has(l.toId));
  return { elements: arch.elements, links };
}

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

/** The id of the BC whose box contains point `p`, or null. */
function bcAtPoint(boxes: Map<string, Box>, p: { x: number; y: number }): string | null {
  for (const [id, b] of boxes) {
    if (p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h) return id;
  }
  return null;
}

function CanvasInner() {
  const arch = useApp((s) => s.arch);
  const view = useApp((s) => s.view);
  const customViews = useApp((s) => s.customViews);
  const activeId = useApp((s) => s.activeCustomViewId);
  const workspace = useApp((s) => s.workspace);
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
  const { fitView, screenToFlowPosition, getNodes, getViewport, setViewport } = useReactFlow();
  const wrapperRef = useRef<HTMLDivElement>(null);

  const activeCustomView = customViews.find((v) => v.id === activeId) ?? null;
  const layoutKey = activeCustomView ? `custom:${activeCustomView.id}` : view;
  // Free-form annotations (frames / text / shapes) are available on every view now — they live in
  // the committed sidecar keyed by view, so they travel with the repo and never touch the model.
  const shapesEnabled = !!workspace;

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
    window.addEventListener('verso:notes-changed', bump);
    return () => window.removeEventListener('verso:notes-changed', bump);
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
    window.addEventListener('verso:layout-changed', refresh);
    return () => window.removeEventListener('verso:layout-changed', refresh);
  }, [workspace, layoutKey, view, activeId]);

  const handleAddWaypoint = useCallback((edgeId: string, point: SavedPosition) => {
    if (!workspace) return;
    setEdgeWaypoints((prev) => {
      const current = prev[edgeId] ?? [];
      const next = [...current, point];
      saveEdgeWaypoints(workspace.rootPath, layoutKey as ViewKind, edgeId, next);
      return { ...prev, [edgeId]: next };
    });
  }, [workspace, layoutKey]);

  const handleRemoveWaypoint = useCallback((edgeId: string, index: number) => {
    if (!workspace) return;
    setEdgeWaypoints((prev) => {
      const current = prev[edgeId] ?? [];
      const next = current.filter((_, i) => i !== index);
      saveEdgeWaypoints(workspace.rootPath, layoutKey as ViewKind, edgeId, next);
      return { ...prev, [edgeId]: next };
    });
  }, [workspace, layoutKey]);

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
    window.addEventListener('verso:layout-changed', refresh);
    return () => window.removeEventListener('verso:layout-changed', refresh);
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
    const field = link.kind === 'dataFlow' ? 'payload' as const : 'kind' as const;
    const value = field === 'payload' ? (link.attributes.payload ?? '') : (link.attributes.kind ?? 'uses');
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
    const field = link.kind === 'dataFlow' ? 'payload' : 'kind';
    const current = field === 'payload' ? (link.attributes.payload ?? '') : (link.attributes.kind ?? 'uses');
    const next = value.trim();
    if (!next || next === current) return;
    const r = await applyOperation({
      kind: 'SetLinkAttribute', opId: `op_${Date.now()}`,
      linkId: edgeId, attributeName: field, value: next,
    });
    if ('reason' in r) setToast({ kind: 'error', text: friendlyOpError(r) });
    else setToast({ kind: 'success', text: field === 'payload' ? 'Payload updated' : 'Kind updated' });
  }, [cancelEdgeEdit, setToast]);

  const edges = useMemo<Edge[]>(() => filtered.links.filter((l) => !hiddenIds.has(l.fromId) && !hiddenIds.has(l.toId)).map((l) => {
    const isDataFlow = l.kind === 'dataFlow';
    const userStyle = edgeStyles[l.id] ?? DEFAULT_EDGE_STYLE;
    // While a draft edit is in flight (inline editor or inspector), the label shows it live.
    const draftValue = linkDraft && linkDraft.linkId === l.id ? linkDraft.value : null;
    const label = draftValue ?? (isDataFlow ? l.attributes.payload ?? '' : l.attributes.kind ?? 'uses');
    const dash = dashArrayFor(userStyle.lineStyle) ?? (isDataFlow ? undefined : '4 4');
    const waypoints = edgeWaypoints[l.id];
    // Dim edges that connect dimmed nodes in focus mode. Both endpoints have to be in
    // the focus set for the edge to stay lit — otherwise it's irrelevant to the selection.
    const dimmed = focusSet !== null && !(focusSet.has(l.fromId) && focusSet.has(l.toId));
    const animated = userStyle.animated ?? (!isDataFlow && userStyle.lineStyle === 'solid' && (!waypoints || waypoints.length === 0));
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
      className: animated && userStyle.animSpeed && userStyle.animSpeed !== 'normal' ? `verso-edge-${userStyle.animSpeed}` : undefined,
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
        onAddWaypoint: handleAddWaypoint,
        onRemoveWaypoint: handleRemoveWaypoint,
        editing: l.id === editingEdgeId,
        editValue: draftValue ?? label,
        onEditStart: startEdgeEdit,
        onEditChange: handleEdgeEditChange,
        onEditCommit: commitEdgeEdit,
        onEditCancel: cancelEdgeEdit,
      },
    };
  }), [filtered.links, edgeStyles, edgeWaypoints, edgeHandles, autoDocks, selectedLinkId, handleAddWaypoint, handleRemoveWaypoint, focusSet, hiddenIds, linkDraft, editingEdgeId, startEdgeEdit, handleEdgeEditChange, commitEdgeEdit, cancelEdgeEdit]);

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
    window.dispatchEvent(new CustomEvent('verso:note-live', { detail: { id: nodeId, text } }));
  }, []);

  // Persist text + reflect #tags into custom props. Does NOT close the editor (blur fires this).
  const handleCommitNotes = useCallback((nodeId: string, text: string) => {
    const ws = useApp.getState().workspace;
    if (!ws) return;
    saveNote(ws.rootPath, nodeId, text);
    const props = hashtagProps(text);
    const current = useApp.getState().customProps[nodeId] ?? {};
    for (const [k, v] of Object.entries(props)) if (current[k] !== v) useApp.getState().setCustomProp(nodeId, k, v);
    window.dispatchEvent(new CustomEvent('verso:notes-changed'));
  }, []);

  const handleCloseNotes = useCallback(() => setNotesEditingId(null), []);

  // Notes are read once per change here — NOT inside the node rebuild, which also fires on the
  // 1.5s violations poll and other churn. Keeps the canvas light on large graphs.
  const notesById = useMemo(() => {
    const m = new Map<string, string>();
    if (workspace) for (const el of filtered.elements) { const t = loadNote(workspace.rootPath, el.id); if (t) m.set(el.id, t); }
    return m;
  }, [workspace, filtered.elements, notesVersion]);

  // Positions captured when a drag begins (null when not dragging). Declared here — above the
  // node-build effect — because that effect reads it to avoid rebuilding nodes mid-drag.
  const dragStartPositions = useRef<Record<string, SavedPosition> | null>(null);

  useEffect(() => {
    if (!workspace || !arch) {
      setNodes([]);
      return;
    }
    const saved = loadLayout(workspace.rootPath, layoutKey as ViewKind);
    const defaults = defaultPositions(filtered.elements);
    const merged = { ...defaults, ...saved };

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
        const pos = existing?.position ?? merged[e.id] ?? { x: 0, y: 0 };
        const ns = nodeStyles[e.id];
        const editing = editingNodeId === e.id;
        const notesEditing = notesEditingId === e.id;
        const dimmed = focusSet !== null && !focusSet.has(e.id);
        const fan = fanCounts.get(e.id);
        const ctxId = e.attributes?.contextId ?? null;
        const ctxName = ctxId ? ctxById.get(ctxId) ?? null : null;
        const noteText = notesById.get(e.id) ?? '';
        return {
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
      });
    });
  }, [arch, view, workspace, filtered.elements, layoutKey, nodeStyles, customProps, violations, handleNodeResize, editingNodeId, notesEditingId, handleStartRename, handleChangeNotes, handleCommitNotes, handleCloseNotes, handleCommitName, handleCancelEdit, activeCustomView, focusSet, fanCounts, notesById]);

  useEffect(() => {
    if (nodes.length > 0) {
      const id = setTimeout(() => fitView({ padding: 0.2, duration: 400 }), 80);
      return () => clearTimeout(id);
    }
  }, [view, activeId, arch?.filePath, fitView]); // eslint-disable-line react-hooks/exhaustive-deps

  // Export the WHOLE canvas — every node AND every free-form shape — by fitting their combined
  // bounds into view, snapshotting the .react-flow element (which holds the shape overlay too),
  // then restoring the viewport. Chrome (controls / minimap) is filtered out.
  useEffect(() => {
    async function onExport(ev: Event) {
      const format = (ev as CustomEvent).detail?.format as 'png' | 'svg';
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
        const vp = getViewportForBounds(bounds, rfEl.clientWidth, rfEl.clientHeight, 0.05, 2.5, 0.12);
        setViewport(vp);
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
        const { toPng, toSvg } = await import('html-to-image');
        const filter = (node: HTMLElement) => {
          const cl = (node as Element).classList;
          return !(cl && (cl.contains('react-flow__controls') || cl.contains('react-flow__minimap') || cl.contains('react-flow__attribution') || cl.contains('react-flow__panel')));
        };
        const opts = { backgroundColor: getComputedStyle(document.body).backgroundColor || '#ffffff', pixelRatio: 2, filter };
        const dataUrl = format === 'svg' ? await toSvg(rfEl, opts) : await toPng(rfEl, opts);
        const blob = await (await fetch(dataUrl)).blob();
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `verso.${format}`;
        a.click();
        URL.revokeObjectURL(a.href);
        setToast({ kind: 'success', text: `Exported ${format.toUpperCase()}` });
      } catch (e) {
        setToast({ kind: 'error', text: `Export failed: ${(e as Error).message}` });
      } finally {
        setViewport(saved);
      }
    }
    window.addEventListener('verso:export-image', onExport);
    return () => window.removeEventListener('verso:export-image', onExport);
  }, [getNodes, getViewport, setViewport, setToast, layoutKey]);

  // Re-read layout when an external event (layout undo/redo) signals it changed.
  useEffect(() => {
    function refreshFromLayout() {
      if (!workspace) return;
      const fresh = loadLayout(workspace.rootPath, layoutKey as ViewKind);
      setNodes((current) => current.map((n) => fresh[n.id] ? { ...n, position: fresh[n.id] } : n));
    }
    function nudge(ev: Event) {
      const detail = (ev as CustomEvent).detail as { nodeId: string; dx: number; dy: number };
      if (!workspace) return;
      setNodes((current) => {
        const next = current.map((n) => n.id === detail.nodeId
          ? { ...n, position: { x: n.position.x + detail.dx, y: n.position.y + detail.dy } }
          : n);
        const positions: Record<string, SavedPosition> = {};
        for (const n of next) positions[n.id] = { x: n.position.x, y: n.position.y };
        saveLayout(workspace.rootPath, layoutKey as ViewKind, positions);
        return next;
      });
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
      setNodes((current) => current.map((n) => ({ ...n, selected: n.id === detail.nodeId })));
      // Pan/zoom to bring the element into view.
      setTimeout(() => {
        try { fitView({ nodes: [{ id: detail.nodeId }], padding: 0.45, duration: 400, maxZoom: 1.2 }); } catch { /* not on canvas */ }
      }, 30);
    }
    // Epic 13 — the stencil library opens from the sidebar "Add new" palette now.
    function openStencils() { setStencilOpen(true); }
    window.addEventListener('verso:layout-changed', refreshFromLayout);
    window.addEventListener('verso:nudge', nudge);
    window.addEventListener('verso:place-node', placeNode);
    window.addEventListener('verso:focus-node', focusNode);
    window.addEventListener('verso:open-stencils', openStencils);
    return () => {
      window.removeEventListener('verso:layout-changed', refreshFromLayout);
      window.removeEventListener('verso:nudge', nudge);
      window.removeEventListener('verso:place-node', placeNode);
      window.removeEventListener('verso:focus-node', focusNode);
      window.removeEventListener('verso:open-stencils', openStencils);
    };
  }, [workspace, layoutKey]);

  const persistPositions = useCallback((next: Node[]) => {
    if (!workspace) return;
    const positions: Record<string, SavedPosition> = {};
    for (const n of next) positions[n.id] = { x: n.position.x, y: n.position.y };
    saveLayout(workspace.rootPath, layoutKey as ViewKind, positions);
  }, [workspace, layoutKey]);

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
  const onEdgeClick: EdgeMouseHandler = (_, edge) => selectLink(edge.id);
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
    if (!arch) return;
    const elem = arch.elements.find((x) => x.id === node.id);
    if (!elem) return;
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
            await applyOperation({ kind: 'RenameElement', opId: `op_${Date.now()}`, elementId: elem.id, newName: next });
          },
        },
        {
          id: 'copy-id', label: 'Copy id', icon: ContextIcons.Copy, hint: elem.id,
          onClick: () => {
            navigator.clipboard?.writeText(elem.id).catch(() => {});
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
            await applyOperation({
              kind: 'SetLifecycle', opId: `op_${Date.now()}`,
              targetId: elem.id, status: next || null, phase: null, validFrom: null, validUntil: null,
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
            await applyOperation({ kind: 'RemoveElement', opId: `op_${Date.now()}`, elementId: elem.id });
          },
        },
      ],
    });
  }, [arch, select, setToast]);

  const onEdgeContextMenu = useCallback((e: React.MouseEvent, edge: Edge) => {
    e.preventDefault();
    selectLink(edge.id);
    setMenu({
      x: e.clientX, y: e.clientY,
      items: [
        {
          id: 'copy-id', label: 'Copy id', icon: ContextIcons.Copy, hint: edge.id,
          onClick: () => {
            navigator.clipboard?.writeText(edge.id).catch(() => {});
            setToast({ kind: 'success', text: `Copied ${edge.id}` });
          },
        },
        {
          id: 'edit-payload', label: 'Edit payload / kind', icon: ContextIcons.Edit3, hint: 'dbl-click',
          onClick: () => startEdgeEdit(edge.id),
        },
        { id: 'sep', label: '', onClick: () => {}, separator: true },
        {
          id: 'delete', label: 'Delete relationship', icon: ContextIcons.Trash2, destructive: true,
          onClick: async () => {
            const ok = await confirmAction({ title: 'Remove this relationship?', confirmLabel: 'Remove', destructive: true });
            if (!ok) return;
            await applyOperation({ kind: 'RemoveLink', opId: `op_${Date.now()}`, linkId: edge.id });
          },
        },
      ],
    });
  }, [selectLink, startEdgeEdit]);

  const addElementAt = useCallback(async (kind: ArchElementKind, pos: SavedPosition) => {
    const fresh = useApp.getState().arch;
    const prevIds = new Set((fresh?.elements ?? []).map((e) => e.id));
    const name = suggestElementName(kind, fresh?.elements ?? []);
    const r = await applyOperation({ kind: 'AddElement', opId: `op_${Date.now()}`, elementKind: kind, name });
    if ('reason' in r) { setToast({ kind: 'error', text: friendlyOpError(r) }); return; }
    const revealed = await revealNewElement(prevIds, { dropPos: pos });
    if (revealed) setToast({ kind: 'success', text: revealToast(revealed) });
    else setToast({ kind: 'error', text: `Added ${name}, but it did not appear — try refreshing.` });
  }, [setToast]);

  const templateBoundedContextWithModules = useCallback(async (pos: SavedPosition) => {
    const fresh = useApp.getState().arch;
    const name = suggestElementName('boundedContext', fresh?.elements ?? []);
    const r1 = await applyOperation({ kind: 'AddElement', opId: `op_${Date.now()}`, elementKind: 'boundedContext', name });
    if ('reason' in r1) { setToast({ kind: 'error', text: friendlyOpError(r1) }); return; }
    setTimeout(async () => {
      const fresh2 = useApp.getState().arch;
      const ctx = [...(fresh2?.elements ?? [])].reverse().find((e) => e.kind === 'boundedContext' && e.name === name);
      if (!ctx || !workspace) return;
      const positions = loadLayout(workspace.rootPath, layoutKey as ViewKind);
      positions[ctx.id] = { x: pos.x, y: pos.y };
      let mx = pos.x + 240;
      const my = pos.y;
      // Two pre-seeded modules with names that won't collide with anything.
      let modelSnapshot = useApp.getState().arch?.elements ?? [];
      for (let i = 0; i < 2; i++) {
        const mn = suggestElementName('module', modelSnapshot);
        await applyOperation({
          kind: 'AddElement', opId: `op_${Date.now()}_${mx}`, elementKind: 'module', name: mn, contextId: ctx.id,
        });
        await new Promise((r) => setTimeout(r, 80));
        modelSnapshot = useApp.getState().arch?.elements ?? [];
        const m = [...modelSnapshot].reverse().find((e) => e.kind === 'module' && e.name === mn);
        if (m) { positions[m.id] = { x: mx, y: my }; mx += 240; }
      }
      saveLayout(workspace.rootPath, layoutKey as ViewKind, positions);
      window.dispatchEvent(new CustomEvent('verso:layout-changed', { detail: { viewKey: layoutKey } }));
      setToast({ kind: 'success', text: `Template applied: ${name} + 2 modules` });
    }, 200);
  }, [workspace, layoutKey, setToast]);

  const templateSystemWithContainer = useCallback(async (pos: SavedPosition) => {
    const fresh = useApp.getState().arch;
    const name = suggestElementName('softwareSystem', fresh?.elements ?? []);
    await applyOperation({ kind: 'AddElement', opId: `op_${Date.now()}`, elementKind: 'softwareSystem', name });
    setTimeout(async () => {
      const fresh2 = useApp.getState().arch;
      const sys = [...(fresh2?.elements ?? [])].reverse().find((e) => e.kind === 'softwareSystem' && e.name === name);
      if (!sys || !workspace) return;
      const positions = loadLayout(workspace.rootPath, layoutKey as ViewKind);
      positions[sys.id] = { x: pos.x, y: pos.y };
      const cName = `${name} Service`;
      await applyOperation({
        kind: 'AddElement', opId: `op_${Date.now() + 1}`, elementKind: 'container', name: cName,
        systemId: sys.id, containerKind: 'service',
      });
      await new Promise((r) => setTimeout(r, 80));
      const refreshed = useApp.getState().arch;
      const cn = [...(refreshed?.elements ?? [])].reverse().find((e) => e.kind === 'container' && e.name === cName);
      if (cn) positions[cn.id] = { x: pos.x + 240, y: pos.y };
      saveLayout(workspace.rootPath, layoutKey as ViewKind, positions);
      window.dispatchEvent(new CustomEvent('verso:layout-changed', { detail: { viewKey: layoutKey } }));
      setToast({ kind: 'success', text: `Template applied: ${name} system` });
    }, 200);
  }, [workspace, layoutKey, setToast]);

  // Epic 13 — templates can be clicked from the sidebar palette (not just dragged). Drop them
  // near the centre of the current viewport so they land somewhere visible.
  useEffect(() => {
    function applyTemplate(ev: Event) {
      const which = (ev as CustomEvent).detail?.template as string | undefined;
      const rect = wrapperRef.current?.getBoundingClientRect();
      const center = rect
        ? screenToFlowPosition({ x: rect.left + rect.width / 2 - 120, y: rect.top + rect.height / 2 - 60 })
        : { x: 200, y: 160 };
      if (which === 'bcWithModules') templateBoundedContextWithModules(center);
      else if (which === 'systemWithContainer') templateSystemWithContainer(center);
    }
    window.addEventListener('verso:apply-template', applyTemplate);
    return () => window.removeEventListener('verso:apply-template', applyTemplate);
  }, [screenToFlowPosition, templateBoundedContextWithModules, templateSystemWithContainer]);

  const onPaneContextMenu = useCallback((e: React.MouseEvent | MouseEvent) => {
    e.preventDefault();
    const me = e as MouseEvent;
    const dropPos = screenToFlowPosition({ x: me.clientX, y: me.clientY });
    setMenu({
      x: me.clientX, y: me.clientY,
      items: [
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
    const linkKind = view === 'dependencyGraph' ? 'dependency' : 'dataFlow';
    await applyOperation({ kind: 'RemoveLink', opId: `op_${Date.now()}`, linkId: oldEdge.id });
    pendingDock.current.push({ from: conn.source, to: conn.target, handles });
    const result = await applyOperation({
      kind: 'AddLink', opId: `op_${Date.now() + 1}`,
      linkKind, fromId: conn.source, toId: conn.target,
      payload: linkKind === 'dataFlow' ? 'Event' : null,
      dependencyKind: linkKind === 'dependency' ? 'uses' : null,
    });
    if ('reason' in result) setToast({ kind: 'error', text: friendlyOpError(result) });
    else setToast({ kind: 'success', text: 'Relationship reconnected' });
  }, [arch, view, workspace, layoutKey, setToast]);

  const onDragOver = useCallback((e: React.DragEvent) => {
    if (e.dataTransfer.types.includes('application/verso-palette')
        || e.dataTransfer.types.includes('application/verso-element')
        || e.dataTransfer.types.includes('application/verso-template')
        || e.dataTransfer.types.includes('application/verso-stencil')) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
    }
  }, []);

  const onDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault();
    const paletteKind = e.dataTransfer.getData('application/verso-palette') as ArchElementKind | '';
    const template = e.dataTransfer.getData('application/verso-template');
    const elementId = e.dataTransfer.getData('application/verso-element');
    const stencilId = e.dataTransfer.getData('application/verso-stencil');
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
          saveShapes(workspace.rootPath, layoutKey, next);
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
      const prevIds = new Set((fresh?.elements ?? []).map((el) => el.id));
      const name = suggestElementName(paletteKind, fresh?.elements ?? []);
      const result = await applyOperation({
        kind: 'AddElement', opId: `op_${Date.now()}`,
        elementKind: paletteKind, name,
      });
      if ('reason' in result) { setToast({ kind: 'error', text: friendlyOpError(result) }); return; }
      // Bulletproof reveal: select by id-diff and switch to a lens that renders this kind,
      // so the new element is never silently filtered off-canvas. Offset by ~half a node so
      // the new box lands centred under the cursor, not down-right of it.
      const revealed = await revealNewElement(prevIds, { dropPos: { x: dropPos.x - 100, y: dropPos.y - 44 } });
      if (!revealed) { setToast({ kind: 'error', text: `Added ${name}, but it did not appear — try refreshing.` }); return; }
      // Dropping a new module/capability inside a Bounded Context nests it there.
      if (paletteKind === 'module' || paletteKind === 'capability') {
        const target = bcAtPoint(bcBoxes(nodes), dropPos);
        if (target) await applyOperation({ kind: 'SetElementContext', opId: `op_${Date.now()}`, elementId: revealed.id, contextId: target });
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
    setNodes((current) => {
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
      persistPositions(next);
      setTimeout(() => fitView({ padding: 0.2, duration: 600 }), 50);
      return next;
    });
    triggerLayoutAnimation();
    const label: Record<LayoutAlgorithm, string> = {
      hierarchical: 'hierarchical', force: 'force-directed',
      focused: 'focused', byType: 'architectural (by type)',
    };
    setToast({ kind: 'success', text: `Applied ${label[algo]} layout` });
  }, [filtered, persistPositions, fitView, setToast, triggerLayoutAnimation, nodeBounds]);

  const handleAlign = useCallback((axis: 'left' | 'right' | 'centerX' | 'top' | 'bottom' | 'centerY') => {
    setNodes((current) => {
      const selected = current.filter((n) => n.selected).map((n) => n.id);
      if (selected.length < 2) return current;
      const aligned = alignSelected(nodeBounds(current), selected, axis);
      const next = current.map((n) => ({ ...n, position: aligned[n.id] ?? n.position }));
      persistPositions(next);
      return next;
    });
  }, [persistPositions, nodeBounds]);

  const handleFitSelection = useCallback(() => {
    const selected = nodes.filter((n) => n.selected);
    if (selected.length === 0) {
      fitView({ padding: 0.2, duration: 400 });
      return;
    }
    fitView({ nodes: selected.map((n) => ({ id: n.id })), padding: 0.3, duration: 400 });
  }, [nodes, fitView]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== 'f' && e.key !== 'F') return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      e.preventDefault();
      handleFitSelection();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [handleFitSelection]);

  const handleDeleteSelected = useCallback(async () => {
    const selected = nodes.filter((n) => n.selected);
    if (selected.length === 0) return;
    const ok = await confirmAction({
      title: `Remove ${selected.length} element${selected.length === 1 ? '' : 's'}?`,
      body: 'Linked relationships will be detached.',
      confirmLabel: 'Remove',
      destructive: true,
    });
    if (!ok) return;
    for (const n of selected) {
      await applyOperation({ kind: 'RemoveElement', opId: `op_${Date.now()}_${n.id}`, elementId: n.id });
    }
  }, [nodes]);

  const handleDistribute = useCallback((axis: 'horizontal' | 'vertical') => {
    setNodes((current) => {
      const selected = current.filter((n) => n.selected).map((n) => n.id);
      if (selected.length < 3) return current;
      const distributed = distributeSelected(nodeBounds(current), selected, axis);
      const next = current.map((n) => ({ ...n, position: distributed[n.id] ?? n.position }));
      persistPositions(next);
      return next;
    });
  }, [persistPositions, nodeBounds]);

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

  // A Bounded Context that owns modules renders as a container box wrapping them: its position
  // + size are derived from the children's bounding box, it is drawn first (below the modules)
  // so they stay clickable on top, and it is not directly draggable — moving its modules
  // reshapes it. Elements without children pass through unchanged.
  const renderedNodes = useMemo<Node[]>(() => {
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
        const kids = childrenByCtx.get(el.id);
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
  }, [nodes, view, activeCustomView, collapsedBcs, toggleBcCollapsed]);

  const selectedCount = nodes.filter((n) => n.selected).length;
  // Publish the multi-selection count so the right-hand Layout panel can gate align/distribute.
  // Selecting 2+ elements jumps the inspector to the Layout panel (Align & distribute sits on top),
  // but the user's own tab choice is restored once the multi-selection is gone.
  const tabBeforeLayoutJump = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    const st = useApp.getState();
    st.setCanvasSelection(selectedCount);
    if (selectedCount >= 2) {
      if (st.inspectorTab !== 'layout' && tabBeforeLayoutJump.current === undefined) tabBeforeLayoutJump.current = st.inspectorTab;
      st.setInspectorTab('layout');
    } else if (tabBeforeLayoutJump.current !== undefined) {
      // Only restore if the user didn't pick another panel while multi-selected.
      if (st.inspectorTab === 'layout') st.setInspectorTab(tabBeforeLayoutJump.current);
      tabBeforeLayoutJump.current = undefined;
    }
  }, [selectedCount]);
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
    }).catch(() => {});
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
      className={clsx('h-full w-full relative', animatingLayout && 'verso-anim-layout')}
      style={{ background: bgColor }}
      ref={wrapperRef}
      onDragOver={onDragOver}
      onDrop={onDrop}
    >
      {/* Canvas toolbar removed — arrange / align / snap now live in the right-hand Layout panel. */}
      {shapesEnabled && stencilOpen && workspace && (
        <StencilDrawer
          viewKey={layoutKey}
          workspaceRoot={workspace.rootPath}
          onClose={() => setStencilOpen(false)}
        />
      )}
      <EdgeMarkerDefs markers={customMarkers} />
      <ReactFlow
        nodes={renderedNodes}
        edges={allEdges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        connectionMode={ConnectionMode.Loose}
        nodesDraggable
        nodesConnectable
        elementsSelectable
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
        onNodeClick={onNodeClick}
        onNodeDoubleClick={onNodeDoubleClick}
        onEdgeClick={onEdgeClick}
        onEdgeDoubleClick={onEdgeDoubleClick}
        onPaneClick={onPaneClick}
        onMove={onCanvasMove}
        onNodeContextMenu={onNodeContextMenu}
        onEdgeContextMenu={onEdgeContextMenu}
        onPaneContextMenu={onPaneContextMenu}
        onConnect={onConnect}
        onReconnect={onReconnect}
        proOptions={{ hideAttribution: true }}
        colorMode={isDark ? 'dark' : 'light'}
      >
        <Background variant={BackgroundVariant.Dots} gap={20} size={1.2} color={dotColor} />
        <Controls />
        <MiniMap pannable zoomable nodeColor={() => 'rgb(99 102 241)'} />
        {shapesEnabled && workspace && (
          <ShapeLayer viewKey={layoutKey} workspaceRoot={workspace.rootPath} enabled />
        )}
      </ReactFlow>
      <ContextMenu state={menu} onClose={() => setMenu(null)} />
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
