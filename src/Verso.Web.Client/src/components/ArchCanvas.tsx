import { useMemo, useEffect, useState, useCallback, useRef } from 'react';
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
} from '@xyflow/react';
import { ArchNodeView } from './nodes/ArchNodeView';
import { BcBackdrop } from './nodes/BcBackdrop';
import { WaypointEdge } from './edges/WaypointEdge';
import { CanvasToolbar } from './CanvasToolbar';
import { ContextMenu, ContextIcons, type ContextMenuState } from './ContextMenu';
import { confirmAction } from './ConfirmDialog';
import { promptText, pickFromList } from './PromptDialog';
import { suggestElementName } from '@/lib/naming';
import { useApp } from '@/lib/store';
import { applyOperation } from '@/lib/signalr';
import { loadLayout, saveLayout, loadEdgeWaypoints, saveEdgeWaypoints, type SavedPosition } from '@/lib/layout';
import { layoutUndo, diffPositions, isEmptyDiff } from '@/lib/layoutUndo';
import {
  layoutHierarchical, layoutForceDirected, alignSelected, distributeSelected,
  type LayoutAlgorithm,
} from '@/lib/autoLayout';
import { dashArrayFor, DEFAULT_EDGE_STYLE } from '@/lib/edgeStyles';
import type { ArchElement, ArchElementKind, ArchLink, ArchModel, ViewKind, CustomView } from '@/lib/types';

const nodeTypes = { arch: ArchNodeView, bcBackdrop: BcBackdrop };
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
    case 'c4Context': return elements.filter((e) => e.kind === 'softwareSystem' || e.kind === 'person' || e.kind === 'container');
    case 'moduleMap': return elements.filter((e) => e.kind === 'module' || e.kind === 'boundedContext');
    case 'dependencyGraph': return elements.filter((e) => e.kind === 'module');
    default: return elements;
  }
}

function applyBuiltIn(arch: ArchModel, view: ViewKind): FilteredView {
  switch (view) {
    case 'c4Context': {
      const elements = arch.elements.filter((e) => e.kind === 'softwareSystem' || e.kind === 'person' || e.kind === 'container');
      const ids = new Set(elements.map((e) => e.id));
      const links = arch.links.filter((l) => ids.has(l.fromId) && ids.has(l.toId));
      return { elements, links };
    }
    case 'moduleMap': {
      const elements = arch.elements.filter((e) => e.kind === 'module' || e.kind === 'boundedContext');
      const ids = new Set(elements.map((e) => e.id));
      const links = arch.links.filter((l) => l.kind === 'dataFlow' && ids.has(l.fromId) && ids.has(l.toId));
      return { elements, links };
    }
    case 'dependencyGraph': {
      const elements = arch.elements.filter((e) => e.kind === 'module');
      const ids = new Set(elements.map((e) => e.id));
      const links = arch.links.filter((l) => l.kind === 'dependency' && ids.has(l.fromId) && ids.has(l.toId));
      return { elements, links };
    }
    default:
      return { elements: arch.elements, links: arch.links };
  }
}

function defaultPositions(elements: ArchElement[]): Record<string, SavedPosition> {
  return layoutHierarchical(elements, []);
}

function CanvasInner() {
  const arch = useApp((s) => s.arch);
  const view = useApp((s) => s.view);
  const mode = useApp((s) => s.mode);
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
  const setToast = useApp((s) => s.setToast);
  const addElementToActiveView = useApp((s) => s.addElementToActiveView);
  const { fitView, screenToFlowPosition } = useReactFlow();
  const wrapperRef = useRef<HTMLDivElement>(null);

  const activeCustomView = customViews.find((v) => v.id === activeId) ?? null;
  const layoutKey = activeCustomView ? `custom:${activeCustomView.id}` : view;

  const filtered = useMemo(
    () => arch ? filterByView(arch, view, activeCustomView) : { elements: [], links: [] },
    [arch, view, activeCustomView]
  );

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

  const edges = useMemo<Edge[]>(() => filtered.links.map((l) => {
    const isDataFlow = l.kind === 'dataFlow';
    const label = isDataFlow ? l.attributes.payload ?? '' : l.attributes.kind ?? 'uses';
    const userStyle = edgeStyles[l.id] ?? DEFAULT_EDGE_STYLE;
    const dash = dashArrayFor(userStyle.lineStyle) ?? (isDataFlow ? undefined : '4 4');
    const waypoints = edgeWaypoints[l.id];
    return {
      id: l.id,
      source: l.fromId,
      target: l.toId,
      type: 'waypointed',
      label,
      animated: !isDataFlow && userStyle.lineStyle === 'solid' && (!waypoints || waypoints.length === 0),
      style: {
        strokeWidth: userStyle.thickness,
        strokeDasharray: dash,
        stroke: userStyle.color,
      },
      data: {
        waypoints,
        onAddWaypoint: handleAddWaypoint,
        onRemoveWaypoint: handleRemoveWaypoint,
      },
    };
  }), [filtered.links, edgeStyles, edgeWaypoints, handleAddWaypoint, handleRemoveWaypoint]);

  const [nodes, setNodes] = useState<Node[]>([]);

  const handleNodeResize = useCallback((nodeId: string, w: number, h: number) => {
    const current = useApp.getState().nodeStyles[nodeId] ?? { borderWidth: 1, borderStyle: 'solid' as const };
    useApp.getState().setNodeStyleFor(nodeId, { ...current, width: w, height: h });
  }, []);

  // Inline edit (Q "puting text into box on canvas") — double-click a node to
  // edit its name. We carry the editing id in component state and pass the
  // commit/cancel callbacks down through node data so the renderer stays
  // dumb.
  const [editingNodeId, setEditingNodeId] = useState<string | null>(null);

  const onNodeDoubleClick: NodeMouseHandler = useCallback((_, node) => {
    if (mode === 'view') return;
    if (node.type !== 'arch') return;
    setEditingNodeId(node.id);
  }, [mode]);

  const handleCommitName = useCallback(async (nodeId: string, next: string) => {
    setEditingNodeId(null);
    const r = await applyOperation({
      kind: 'RenameElement', opId: `op_${Date.now()}`, elementId: nodeId, newName: next,
    });
    if ('reason' in r) setToast({ kind: 'error', text: `${r.reason}: ${r.message}` });
    else setToast({ kind: 'success', text: 'Renamed' });
  }, [setToast]);

  const handleCancelEdit = useCallback(() => setEditingNodeId(null), []);

  useEffect(() => {
    if (!workspace || !arch) {
      setNodes([]);
      return;
    }
    const saved = loadLayout(workspace.rootPath, layoutKey as ViewKind);
    const defaults = defaultPositions(filtered.elements);
    const merged = { ...defaults, ...saved };

    setNodes((prev) => {
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
      return filtered.elements.map((e) => {
        const existing = prevById.get(e.id);
        const pos = existing?.position ?? merged[e.id] ?? { x: 0, y: 0 };
        const ns = nodeStyles[e.id];
        const editing = editingNodeId === e.id;
        return {
          id: e.id,
          type: 'arch',
          position: pos,
          draggable: !editing && (mode === 'edit' || activeCustomView !== null),
          ...(ns?.width && ns?.height ? { style: { width: ns.width, height: ns.height } } : {}),
          data: {
            element: e,
            tag: tagsById.get(e.id),
            nodeStyle: ns,
            customProps: customProps[e.id],
            violationSeverity: sevByElement.get(e.id),
            resizable: mode === 'edit' && !editing,
            onResize: handleNodeResize,
            editing,
            onCommitName: handleCommitName,
            onCancelEdit: handleCancelEdit,
          },
        } satisfies Node;
      });
    });
  }, [arch, view, workspace, filtered.elements, layoutKey, nodeStyles, customProps, violations, mode, handleNodeResize, editingNodeId, handleCommitName, handleCancelEdit, activeCustomView]);

  useEffect(() => {
    if (nodes.length > 0) {
      const id = setTimeout(() => fitView({ padding: 0.2, duration: 400 }), 80);
      return () => clearTimeout(id);
    }
  }, [view, activeId, arch?.filePath, fitView]); // eslint-disable-line react-hooks/exhaustive-deps

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
    function focusNode(ev: Event) {
      const detail = (ev as CustomEvent).detail as { nodeId: string };
      setNodes((current) => current.map((n) => ({ ...n, selected: n.id === detail.nodeId })));
    }
    window.addEventListener('verso:layout-changed', refreshFromLayout);
    window.addEventListener('verso:nudge', nudge);
    window.addEventListener('verso:focus-node', focusNode);
    return () => {
      window.removeEventListener('verso:layout-changed', refreshFromLayout);
      window.removeEventListener('verso:nudge', nudge);
      window.removeEventListener('verso:focus-node', focusNode);
    };
  }, [workspace, layoutKey]);

  const persistPositions = useCallback((next: Node[]) => {
    if (!workspace) return;
    const positions: Record<string, SavedPosition> = {};
    for (const n of next) positions[n.id] = { x: n.position.x, y: n.position.y };
    saveLayout(workspace.rootPath, layoutKey as ViewKind, positions);
  }, [workspace, layoutKey]);

  const dragStartPositions = useRef<Record<string, SavedPosition> | null>(null);

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
          }
          dragStartPositions.current = null;
        }
      }
      return next;
    });
  }, [persistPositions, workspace, layoutKey]);

  const [menu, setMenu] = useState<ContextMenuState | null>(null);

  const onNodeClick: NodeMouseHandler = (_, node) => select(node.id);
  const onEdgeClick: EdgeMouseHandler = (_, edge) => selectLink(edge.id);
  const onPaneClick = () => { select(null); selectLink(null); setMenu(null); };
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
        {
          id: 'add-decision', label: 'Add decision about this', icon: ContextIcons.Lightbulb, opensDialog: true,
          onClick: async () => {
            const title = await promptText({
              title: 'New decision',
              body: `The decision will concern ${elem.name}.`,
              initialValue: `Decision about ${elem.name}`,
              confirmLabel: 'Create',
            });
            if (!title) return;
            const r = await applyOperation({ kind: 'AddDecision', opId: `op_${Date.now()}`, title });
            if ('reason' in r) { setToast({ kind: 'error', text: `${r.reason}: ${r.message}` }); return; }
            setTimeout(async () => {
              const fresh = useApp.getState().arch;
              const lastDec = (fresh?.decisions ?? []).slice().reverse().find((d) => d.title === title);
              if (lastDec) {
                await applyOperation({ kind: 'AddDecisionConcerns', opId: `op_${Date.now()}`, decisionId: lastDec.id, elementId: elem.id });
              }
            }, 200);
          },
        },
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
          id: 'edit-payload', label: 'Edit payload / kind', icon: ContextIcons.Edit3, opensDialog: true,
          onClick: () => selectLink(edge.id),
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
  }, [selectLink]);

  const addElementAt = useCallback(async (kind: ArchElementKind, pos: SavedPosition) => {
    const fresh = useApp.getState().arch;
    const name = suggestElementName(kind, fresh?.elements ?? []);
    const r = await applyOperation({ kind: 'AddElement', opId: `op_${Date.now()}`, elementKind: kind, name });
    if ('reason' in r) { setToast({ kind: 'error', text: `${r.reason}: ${r.message}` }); return; }
    setTimeout(() => {
      const refreshed = useApp.getState().arch;
      const last = [...(refreshed?.elements ?? [])].reverse().find((e) => e.kind === kind && e.name === name);
      if (last && workspace) {
        const positions = loadLayout(workspace.rootPath, layoutKey as ViewKind);
        positions[last.id] = { x: pos.x, y: pos.y };
        saveLayout(workspace.rootPath, layoutKey as ViewKind, positions);
        setNodes((prev) => prev.map((n) => n.id === last.id ? { ...n, position: pos } : n));
        useApp.getState().selectElement(last.id);
      }
    }, 100);
    setToast({ kind: 'success', text: `Added ${name}` });
  }, [workspace, layoutKey, setToast]);

  const templateBoundedContextWithModules = useCallback(async (pos: SavedPosition) => {
    const fresh = useApp.getState().arch;
    const name = suggestElementName('boundedContext', fresh?.elements ?? []);
    const r1 = await applyOperation({ kind: 'AddElement', opId: `op_${Date.now()}`, elementKind: 'boundedContext', name });
    if ('reason' in r1) { setToast({ kind: 'error', text: `${r1.reason}: ${r1.message}` }); return; }
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
      setToast({ kind: 'success', text: `Template applied: ${name} system` });
    }, 200);
  }, [workspace, layoutKey, setToast]);

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

  const onConnect = async (params: { source: string | null; target: string | null }) => {
    if (mode === 'view') {
      setToast({ kind: 'info', text: 'Switch to Edit mode to add links.' });
      return;
    }
    if (!arch || !params.source || !params.target) return;
    const linkKind = view === 'dependencyGraph' ? 'dependency' : 'dataFlow';
    const result = await applyOperation({
      kind: 'AddLink', opId: `op_${Date.now()}`,
      linkKind, fromId: params.source, toId: params.target,
      payload: linkKind === 'dataFlow' ? 'Event' : null,
      dependencyKind: linkKind === 'dependency' ? 'uses' : null,
    });
    if ('reason' in result) setToast({ kind: 'error', text: `${result.reason}: ${result.message}` });
    else setToast({ kind: 'success', text: 'Link added' });
  };

  const onDragOver = useCallback((e: React.DragEvent) => {
    if (e.dataTransfer.types.includes('application/verso-palette')
        || e.dataTransfer.types.includes('application/verso-element')
        || e.dataTransfer.types.includes('application/verso-template')) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
    }
  }, []);

  const onDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault();
    const paletteKind = e.dataTransfer.getData('application/verso-palette') as ArchElementKind | '';
    const template = e.dataTransfer.getData('application/verso-template');
    const elementId = e.dataTransfer.getData('application/verso-element');
    const dropPos = screenToFlowPosition({ x: e.clientX, y: e.clientY });

    if (template === 'bcWithModules') {
      if (mode === 'view') { setToast({ kind: 'info', text: 'Switch to Edit mode to add elements.' }); return; }
      templateBoundedContextWithModules(dropPos);
      return;
    }
    if (template === 'systemWithContainer') {
      if (mode === 'view') { setToast({ kind: 'info', text: 'Switch to Edit mode to add elements.' }); return; }
      templateSystemWithContainer(dropPos);
      return;
    }

    if (paletteKind) {
      if (mode === 'view') { setToast({ kind: 'info', text: 'Switch to Edit mode to add new elements.' }); return; }
      const fresh = useApp.getState().arch;
      const name = suggestElementName(paletteKind, fresh?.elements ?? []);
      const result = await applyOperation({
        kind: 'AddElement', opId: `op_${Date.now()}`,
        elementKind: paletteKind, name,
      });
      if ('reason' in result) { setToast({ kind: 'error', text: `${result.reason}: ${result.message}` }); return; }
      setTimeout(() => {
        const refreshed = useApp.getState().arch;
        if (!refreshed) return;
        const last = [...refreshed.elements].reverse().find((el) => el.kind === paletteKind && el.name === name);
        if (last && workspace) {
          const positions = loadLayout(workspace.rootPath, layoutKey as ViewKind);
          positions[last.id] = { x: dropPos.x, y: dropPos.y };
          saveLayout(workspace.rootPath, layoutKey as ViewKind, positions);
          setNodes((prev) => prev.map((n) => n.id === last.id ? { ...n, position: dropPos } : n));
          if (activeCustomView) addElementToActiveView(last.id);
          // Auto-select new node so the user can rename inline in the inspector.
          useApp.getState().selectElement(last.id);
        }
      }, 100);
      setToast({ kind: 'success', text: `Added ${name} — rename in the inspector` });
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
  }, [mode, screenToFlowPosition, setToast, activeCustomView, workspace, layoutKey, addElementToActiveView, templateBoundedContextWithModules, templateSystemWithContainer]);

  const handleAutoLayout = useCallback((algo: LayoutAlgorithm) => {
    setNodes((current) => {
      const seed: Record<string, SavedPosition> = {};
      for (const n of current) seed[n.id] = { x: n.position.x, y: n.position.y };
      const fresh = algo === 'hierarchical'
        ? layoutHierarchical(filtered.elements, filtered.links)
        : layoutForceDirected(filtered.elements, filtered.links, seed);
      const next = current.map((n) => ({ ...n, position: fresh[n.id] ?? n.position }));
      persistPositions(next);
      setTimeout(() => fitView({ padding: 0.2, duration: 400 }), 50);
      return next;
    });
    setToast({ kind: 'success', text: `Applied ${algo === 'hierarchical' ? 'hierarchical' : 'force-directed'} layout` });
  }, [filtered, persistPositions, fitView, setToast]);

  // Build a per-node bounds map. Width / height come from the rendered DOM
  // size (`measured`), falling back to any explicit style override (set when
  // the user resized the node), then to a kind-specific default. Without
  // dimensions, "Align right" would just align left edges and "Center"
  // would only look right when every box is the same width.
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

  // Q114: derive backdrop nodes for Bounded Contexts that contain modules in the
  // current view. We render them as non-selectable nodes with a lower z so the
  // contained modules sit on top. Only meaningful when the view shows both BCs
  // and modules together.
  const renderedNodes = useMemo<Node[]>(() => {
    const showBackdrop = view === 'moduleMap' || activeCustomView !== null;
    if (!showBackdrop) return nodes;
    const byId = new Map(nodes.map((n) => [n.id, n]));
    const modulesByCtx = new Map<string, Node[]>();
    for (const n of nodes) {
      const data = n.data as { element?: { kind: string; attributes: { contextId?: string } } };
      const el = data.element;
      if (!el || el.kind !== 'module') continue;
      const ctxId = el.attributes.contextId;
      if (!ctxId || !byId.has(ctxId)) continue;
      const arr = modulesByCtx.get(ctxId) ?? [];
      arr.push(n);
      modulesByCtx.set(ctxId, arr);
    }
    if (modulesByCtx.size === 0) return nodes;
    const backdrops: Node[] = [];
    for (const [ctxId, mods] of modulesByCtx) {
      const ctxNode = byId.get(ctxId)!;
      const ctxData = ctxNode.data as { element?: { name: string } };
      const points = [ctxNode, ...mods];
      const xs = points.map((n) => n.position.x);
      const ys = points.map((n) => n.position.y);
      const left = Math.min(...xs) - 24;
      const top = Math.min(...ys) - 32;
      const right = Math.max(...xs) + 260;
      const bottom = Math.max(...ys) + 100;
      backdrops.push({
        id: `__bcbg__${ctxId}`,
        type: 'bcBackdrop',
        position: { x: left, y: top },
        data: { width: right - left, height: bottom - top, label: ctxData.element?.name ?? '' },
        draggable: false,
        selectable: false,
        focusable: false,
        zIndex: -1,
      });
    }
    return [...backdrops, ...nodes];
  }, [nodes, view, activeCustomView]);

  const selectedCount = nodes.filter((n) => n.selected).length;
  const isDark = theme === 'dark';
  const bgColor = isDark ? 'rgb(9 9 11)' : 'rgb(248 250 252)';
  const dotColor = isDark ? 'rgb(45 45 50)' : 'rgb(212 217 224)';

  return (
    <div className="h-full w-full relative" style={{ background: bgColor }} ref={wrapperRef} onDragOver={onDragOver} onDrop={onDrop}>
      <CanvasToolbar
        onAutoLayout={handleAutoLayout}
        onAlign={handleAlign}
        onDistribute={handleDistribute}
        onFitSelection={handleFitSelection}
        onDeleteSelected={handleDeleteSelected}
        selectedCount={selectedCount}
      />
      <ReactFlow
        nodes={renderedNodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        connectionMode={ConnectionMode.Loose}
        nodesDraggable={mode === 'edit' || activeCustomView !== null}
        nodesConnectable={mode === 'edit'}
        elementsSelectable
        // Shift+drag on the pane = marquee selection of a group of nodes.
        selectionKeyCode="Shift"
        // Ctrl/Cmd+click on a node = additive selection of specific nodes.
        // Both keys are accepted so the same gesture works on Linux/Win and Mac.
        multiSelectionKeyCode={['Control', 'Meta']}
        snapToGrid={snapEnabled}
        snapGrid={[20, 20]}
        onNodesChange={onNodesChange}
        onNodeClick={onNodeClick}
        onNodeDoubleClick={onNodeDoubleClick}
        onEdgeClick={onEdgeClick}
        onPaneClick={onPaneClick}
        onMove={onCanvasMove}
        onNodeContextMenu={onNodeContextMenu}
        onEdgeContextMenu={onEdgeContextMenu}
        onPaneContextMenu={onPaneContextMenu}
        onConnect={onConnect}
        proOptions={{ hideAttribution: true }}
        colorMode={isDark ? 'dark' : 'light'}
      >
        <Background variant={BackgroundVariant.Dots} gap={20} size={1.2} color={dotColor} />
        <Controls />
        <MiniMap pannable zoomable nodeColor={() => 'rgb(99 102 241)'} />
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
