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
import { CanvasToolbar } from './CanvasToolbar';
import { useApp } from '@/lib/store';
import { applyOperation } from '@/lib/signalr';
import { loadLayout, saveLayout, type SavedPosition } from '@/lib/layout';
import {
  layoutHierarchical, layoutForceDirected, alignSelected, distributeSelected,
  type LayoutAlgorithm,
} from '@/lib/autoLayout';
import { dashArrayFor, DEFAULT_EDGE_STYLE } from '@/lib/edgeStyles';
import type { ArchElement, ArchElementKind, ArchLink, ArchModel, ViewKind, CustomView } from '@/lib/types';

const nodeTypes = { arch: ArchNodeView };

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

  const edges = useMemo<Edge[]>(() => filtered.links.map((l) => {
    const isDataFlow = l.kind === 'dataFlow';
    const label = isDataFlow ? l.attributes.payload ?? '' : l.attributes.kind ?? 'uses';
    const userStyle = edgeStyles[l.id] ?? DEFAULT_EDGE_STYLE;
    const dash = dashArrayFor(userStyle.lineStyle) ?? (isDataFlow ? undefined : '4 4');
    return {
      id: l.id,
      source: l.fromId,
      target: l.toId,
      type: 'smoothstep',
      label,
      animated: !isDataFlow && userStyle.lineStyle === 'solid',
      style: {
        strokeWidth: userStyle.thickness,
        strokeDasharray: dash,
        stroke: userStyle.color,
      },
    };
  }), [filtered.links, edgeStyles]);

  const [nodes, setNodes] = useState<Node[]>([]);

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
        return {
          id: e.id,
          type: 'arch',
          position: pos,
          data: { element: e, tag: tagsById.get(e.id), nodeStyle: nodeStyles[e.id], violationSeverity: sevByElement.get(e.id) },
        } satisfies Node;
      });
    });
  }, [arch, view, workspace, filtered.elements, layoutKey, nodeStyles, violations]);

  useEffect(() => {
    if (nodes.length > 0) {
      const id = setTimeout(() => fitView({ padding: 0.2, duration: 400 }), 80);
      return () => clearTimeout(id);
    }
  }, [view, activeId, arch?.filePath, fitView]); // eslint-disable-line react-hooks/exhaustive-deps

  const persistPositions = useCallback((next: Node[]) => {
    if (!workspace) return;
    const positions: Record<string, SavedPosition> = {};
    for (const n of next) positions[n.id] = { x: n.position.x, y: n.position.y };
    saveLayout(workspace.rootPath, layoutKey as ViewKind, positions);
  }, [workspace, layoutKey]);

  const onNodesChange = useCallback((changes: NodeChange[]) => {
    setNodes((current) => {
      const next = applyNodeChanges(changes, current);
      const positionChanged = changes.some((c) => c.type === 'position' && c.position && !c.dragging);
      if (positionChanged) persistPositions(next);
      return next;
    });
  }, [persistPositions]);

  const onNodeClick: NodeMouseHandler = (_, node) => select(node.id);
  const onEdgeClick: EdgeMouseHandler = (_, edge) => selectLink(edge.id);
  const onPaneClick = () => { select(null); selectLink(null); };

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
        || e.dataTransfer.types.includes('application/verso-element')) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
    }
  }, []);

  const onDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault();
    const paletteKind = e.dataTransfer.getData('application/verso-palette') as ArchElementKind | '';
    const elementId = e.dataTransfer.getData('application/verso-element');
    const dropPos = screenToFlowPosition({ x: e.clientX, y: e.clientY });

    if (paletteKind) {
      if (mode === 'view') { setToast({ kind: 'info', text: 'Switch to Edit mode to add new elements.' }); return; }
      const name = prompt(`Name for the new ${paletteKind}`)?.trim();
      if (!name) return;
      const result = await applyOperation({
        kind: 'AddElement', opId: `op_${Date.now()}`,
        elementKind: paletteKind, name,
      });
      if ('reason' in result) { setToast({ kind: 'error', text: `${result.reason}: ${result.message}` }); return; }
      setTimeout(() => {
        const fresh = useApp.getState().arch;
        if (!fresh) return;
        const last = [...fresh.elements].reverse().find((el) => el.kind === paletteKind && el.name === name);
        if (last && workspace) {
          const positions = loadLayout(workspace.rootPath, layoutKey as ViewKind);
          positions[last.id] = { x: dropPos.x, y: dropPos.y };
          saveLayout(workspace.rootPath, layoutKey as ViewKind, positions);
          setNodes((prev) => prev.map((n) => n.id === last.id ? { ...n, position: dropPos } : n));
          if (activeCustomView) addElementToActiveView(last.id);
        }
      }, 100);
      setToast({ kind: 'success', text: `Added ${name}` });
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
  }, [mode, screenToFlowPosition, setToast, activeCustomView, workspace, layoutKey, addElementToActiveView]);

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

  const handleAlign = useCallback((axis: 'left' | 'right' | 'centerX' | 'top' | 'bottom' | 'centerY') => {
    setNodes((current) => {
      const selected = current.filter((n) => n.selected).map((n) => n.id);
      if (selected.length < 2) return current;
      const positions: Record<string, SavedPosition> = {};
      for (const n of current) positions[n.id] = { x: n.position.x, y: n.position.y };
      const aligned = alignSelected(positions, selected, axis);
      const next = current.map((n) => ({ ...n, position: aligned[n.id] ?? n.position }));
      persistPositions(next);
      return next;
    });
  }, [persistPositions]);

  const handleDistribute = useCallback((axis: 'horizontal' | 'vertical') => {
    setNodes((current) => {
      const selected = current.filter((n) => n.selected).map((n) => n.id);
      if (selected.length < 3) return current;
      const positions: Record<string, SavedPosition> = {};
      for (const n of current) positions[n.id] = { x: n.position.x, y: n.position.y };
      const distributed = distributeSelected(positions, selected, axis);
      const next = current.map((n) => ({ ...n, position: distributed[n.id] ?? n.position }));
      persistPositions(next);
      return next;
    });
  }, [persistPositions]);

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
        selectedCount={selectedCount}
      />
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        connectionMode={ConnectionMode.Loose}
        nodesDraggable={mode === 'edit' || activeCustomView !== null}
        nodesConnectable={mode === 'edit'}
        elementsSelectable
        snapToGrid={snapEnabled}
        snapGrid={[20, 20]}
        onNodesChange={onNodesChange}
        onNodeClick={onNodeClick}
        onEdgeClick={onEdgeClick}
        onPaneClick={onPaneClick}
        onConnect={onConnect}
        proOptions={{ hideAttribution: true }}
        colorMode={isDark ? 'dark' : 'light'}
      >
        <Background variant={BackgroundVariant.Dots} gap={20} size={1.2} color={dotColor} />
        <Controls />
        <MiniMap pannable zoomable nodeColor={() => 'rgb(99 102 241)'} />
      </ReactFlow>
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
