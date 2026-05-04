import { useMemo, useEffect, useState, useCallback } from 'react';
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
import { loadLayout, saveLayout, mergePositions, type SavedPosition } from '@/lib/layout';
import type { ArchElement, ArchLink, ArchModel, ViewKind } from '@/lib/types';

const nodeTypes = { arch: ArchNodeView };

interface FilteredView {
  elements: ArchElement[];
  links: ArchLink[];
}

function filterByView(arch: ArchModel, view: ViewKind): FilteredView {
  switch (view) {
    case 'c4Context': {
      const elements = arch.elements.filter(
        (e) => e.kind === 'softwareSystem' || e.kind === 'person' || e.kind === 'container'
      );
      const ids = new Set(elements.map((e) => e.id));
      const links = arch.links.filter((l) => ids.has(l.fromId) && ids.has(l.toId));
      return { elements, links };
    }
    case 'moduleMap': {
      const elements = arch.elements.filter(
        (e) => e.kind === 'module' || e.kind === 'boundedContext'
      );
      const ids = new Set(elements.map((e) => e.id));
      const links = arch.links.filter(
        (l) => l.kind === 'dataFlow' && ids.has(l.fromId) && ids.has(l.toId)
      );
      return { elements, links };
    }
    case 'dependencyGraph': {
      const elements = arch.elements.filter((e) => e.kind === 'module');
      const ids = new Set(elements.map((e) => e.id));
      const links = arch.links.filter(
        (l) => l.kind === 'dependency' && ids.has(l.fromId) && ids.has(l.toId)
      );
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
  const workspace = useApp((s) => s.workspace);
  const theme = useApp((s) => s.theme);
  const select = useApp((s) => s.selectElement);
  const setToast = useApp((s) => s.setToast);
  const { fitView } = useReactFlow();

  const filtered = useMemo(() => arch ? filterByView(arch, view) : { elements: [], links: [] }, [arch, view]);
  const edges = useMemo(() => buildEdges(filtered.links), [filtered.links]);

  const [nodes, setNodes] = useState<Node[]>([]);

  // Sync nodes when arch/view changes: keep saved positions, layout new ones, drop removed.
  useEffect(() => {
    if (!workspace || !arch) {
      setNodes([]);
      return;
    }
    const saved = loadLayout(workspace.rootPath, view);
    const defaults = defaultPositions(filtered.elements);
    const merged = mergePositions(defaults, saved);

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
  }, [arch, view, workspace, filtered.elements]);

  // Fit view once after nodes appear; not on every change so dragging doesn't jump.
  useEffect(() => {
    if (nodes.length > 0) {
      const id = setTimeout(() => fitView({ padding: 0.2, duration: 400 }), 80);
      return () => clearTimeout(id);
    }
  }, [view, arch?.filePath, fitView]); // eslint-disable-line react-hooks/exhaustive-deps

  const onNodesChange = useCallback((changes: NodeChange[]) => {
    setNodes((current) => {
      const next = applyNodeChanges(changes, current);
      // Persist any position changes immediately.
      const positionChanged = changes.some((c) => c.type === 'position' && c.position && !c.dragging);
      if (positionChanged && workspace) {
        const positions: Record<string, SavedPosition> = {};
        for (const n of next) positions[n.id] = { x: n.position.x, y: n.position.y };
        saveLayout(workspace.rootPath, view, positions);
      }
      return next;
    });
  }, [workspace, view]);

  const onNodeClick: NodeMouseHandler = (_, node) => select(node.id);

  const onConnect = async (params: { source: string | null; target: string | null }) => {
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

  const isDark = theme === 'dark';
  const bgColor = isDark ? 'rgb(9 9 11)' : 'rgb(250 250 250)';
  const dotColor = isDark ? 'rgb(39 39 42)' : 'rgb(228 228 231)';

  return (
    <div className="h-full w-full" style={{ background: bgColor }}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        connectionMode={ConnectionMode.Loose}
        nodesDraggable
        nodesConnectable
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
