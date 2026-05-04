import { useMemo, useEffect, useState, useCallback, useRef } from 'react';
import {
  ReactFlow,
  Background,
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
} from '@xyflow/react';
import { ArchNodeView } from './nodes/ArchNodeView';
import { useApp } from '@/lib/store';
import { applyOperation } from '@/lib/signalr';
import { loadLayout, saveLayout, type SavedPosition } from '@/lib/layout';
import type { ArchElement, ArchElementKind, ArchLink, ArchModel, ViewKind, CustomView } from '@/lib/types';

const nodeTypes = { arch: ArchNodeView };

interface FilteredView {
  elements: ArchElement[];
  links: ArchLink[];
}

function filterByView(arch: ArchModel, view: ViewKind, customView: CustomView | null): FilteredView {
  // Custom view overrides — only elements explicitly added to it (then optionally narrowed by baseView).
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
  const ctxOf = new Map<string, ArchElement[]>();
  const standalone: ArchElement[] = [];
  for (const e of elements) {
    const ctxId = e.attributes.contextId ?? null;
    if (e.kind === 'module' && ctxId) {
      if (!ctxOf.has(ctxId)) ctxOf.set(ctxId, []);
      ctxOf.get(ctxId)!.push(e);
    } else {
      standalone.push(e);
    }
  }

  const out: Record<string, SavedPosition> = {};
  let yCursor = 40;
  const COL_W = 240;
  const ROW_H = 130;

  let standaloneIdx = 0;
  for (const e of standalone) {
    if (e.kind === 'boundedContext') continue;
    out[e.id] = { x: 40 + standaloneIdx * COL_W, y: yCursor };
    standaloneIdx++;
  }
  if (standaloneIdx > 0) yCursor += ROW_H + 40;

  for (const [ctxId, modules] of ctxOf) {
    const ctx = elements.find((x) => x.id === ctxId);
    if (ctx) out[ctx.id] = { x: 40, y: yCursor };
    modules.forEach((m, i) => {
      out[m.id] = { x: 320 + i * COL_W, y: yCursor };
    });
    yCursor += ROW_H + 60;
  }

  for (const e of elements.filter((x) => x.kind === 'boundedContext' && !ctxOf.has(x.id))) {
    out[e.id] = { x: 40, y: yCursor };
    yCursor += ROW_H;
  }

  return out;
}

function buildEdges(links: ArchLink[]): Edge[] {
  return links.map((l) => {
    const isDataFlow = l.kind === 'dataFlow';
    const label = isDataFlow ? l.attributes.payload ?? '' : l.attributes.kind ?? 'uses';
    return {
      id: l.id,
      source: l.fromId,
      target: l.toId,
      type: 'smoothstep',
      label,
      animated: !isDataFlow,
      style: !isDataFlow ? { strokeDasharray: '4 4' } : undefined,
    };
  });
}

function CanvasInner() {
  const arch = useApp((s) => s.arch);
  const view = useApp((s) => s.view);
  const mode = useApp((s) => s.mode);
  const customViews = useApp((s) => s.customViews);
  const activeId = useApp((s) => s.activeCustomViewId);
  const workspace = useApp((s) => s.workspace);
  const theme = useApp((s) => s.theme);
  const select = useApp((s) => s.selectElement);
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
  const edges = useMemo(() => buildEdges(filtered.links), [filtered.links]);

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
      return filtered.elements.map((e) => {
        const existing = prevById.get(e.id);
        const pos = existing?.position ?? merged[e.id] ?? { x: 0, y: 0 };
        return {
          id: e.id,
          type: 'arch',
          position: pos,
          data: { element: e },
        } satisfies Node;
      });
    });
  }, [arch, view, workspace, filtered.elements, layoutKey]);

  useEffect(() => {
    if (nodes.length > 0) {
      const id = setTimeout(() => fitView({ padding: 0.2, duration: 400 }), 80);
      return () => clearTimeout(id);
    }
  }, [view, activeId, arch?.filePath, fitView]); // eslint-disable-line react-hooks/exhaustive-deps

  const onNodesChange = useCallback((changes: NodeChange[]) => {
    setNodes((current) => {
      const next = applyNodeChanges(changes, current);
      const positionChanged = changes.some((c) => c.type === 'position' && c.position && !c.dragging);
      if (positionChanged && workspace) {
        const positions: Record<string, SavedPosition> = {};
        for (const n of next) positions[n.id] = { x: n.position.x, y: n.position.y };
        saveLayout(workspace.rootPath, layoutKey as ViewKind, positions);
      }
      return next;
    });
  }, [workspace, layoutKey]);

  const onNodeClick: NodeMouseHandler = (_, node) => select(node.id);

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
      if (mode === 'view') {
        setToast({ kind: 'info', text: 'Switch to Edit mode to add new elements.' });
        return;
      }
      const name = prompt(`Name for the new ${paletteKind}`)?.trim();
      if (!name) return;
      const result = await applyOperation({
        kind: 'AddElement', opId: `op_${Date.now()}`,
        elementKind: paletteKind, name,
      });
      if ('reason' in result) {
        setToast({ kind: 'error', text: `${result.reason}: ${result.message}` });
        return;
      }
      // Find the newly created element after the snapshot refresh and place it at the drop position.
      // Add to active custom view automatically if one is active.
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

  const isDark = theme === 'dark';
  const bgColor = isDark ? 'rgb(9 9 11)' : 'rgb(250 250 250)';
  const dotColor = isDark ? 'rgb(39 39 42)' : 'rgb(228 228 231)';

  return (
    <div className="h-full w-full" style={{ background: bgColor }} ref={wrapperRef} onDragOver={onDragOver} onDrop={onDrop}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        connectionMode={ConnectionMode.Loose}
        nodesDraggable={mode === 'edit' || activeCustomView !== null}
        nodesConnectable={mode === 'edit'}
        elementsSelectable
        onNodesChange={onNodesChange}
        onNodeClick={onNodeClick}
        onConnect={onConnect}
        proOptions={{ hideAttribution: true }}
        colorMode={isDark ? 'dark' : 'light'}
      >
        <Background gap={24} size={1} color={dotColor} />
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
