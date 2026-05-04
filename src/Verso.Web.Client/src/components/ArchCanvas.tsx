import { useMemo, useEffect } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  type Node,
  type Edge,
  ConnectionMode,
  ReactFlowProvider,
  useReactFlow,
  type NodeMouseHandler,
} from '@xyflow/react';
import { ArchNodeView } from './nodes/ArchNodeView';
import { useApp } from '@/lib/store';
import { applyOperation } from '@/lib/signalr';
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

function gridLayout(elements: ArchElement[]): Node[] {
  // Group modules by their bounded context for a tidy two-row layout per context.
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

  const nodes: Node[] = [];
  let yCursor = 40;
  const COL_W = 240;
  const ROW_H = 130;

  for (const e of standalone) {
    if (e.kind === 'boundedContext') continue;
    nodes.push({
      id: e.id,
      type: 'arch',
      position: { x: 40 + nodes.length * COL_W, y: yCursor },
      data: { element: e },
    });
  }
  if (nodes.length > 0) yCursor += ROW_H + 40;

  for (const [ctxId, modules] of ctxOf) {
    const ctx = elements.find((x) => x.id === ctxId);
    if (ctx) {
      nodes.push({
        id: ctx.id,
        type: 'arch',
        position: { x: 40, y: yCursor },
        data: { element: ctx },
      });
    }
    modules.forEach((m, i) => {
      nodes.push({
        id: m.id,
        type: 'arch',
        position: { x: 320 + i * COL_W, y: yCursor },
        data: { element: m },
      });
    });
    yCursor += ROW_H + 60;
  }

  // Standalone bounded contexts not used above.
  for (const e of elements.filter((x) => x.kind === 'boundedContext' && !ctxOf.has(x.id))) {
    nodes.push({
      id: e.id,
      type: 'arch',
      position: { x: 40, y: yCursor },
      data: { element: e },
    });
    yCursor += ROW_H;
  }

  return nodes;
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
      labelStyle: { fill: 'rgb(161 161 170)', fontSize: 10 },
      labelBgStyle: { fill: 'rgb(24 24 27)', fillOpacity: 0.85 },
      animated: !isDataFlow,
      style: !isDataFlow ? { strokeDasharray: '4 4' } : undefined,
    };
  });
}

function CanvasInner() {
  const arch = useApp((s) => s.arch);
  const view = useApp((s) => s.view);
  const select = useApp((s) => s.selectElement);
  const setToast = useApp((s) => s.setToast);
  const { fitView } = useReactFlow();

  const { nodes, edges } = useMemo(() => {
    if (!arch) return { nodes: [] as Node[], edges: [] as Edge[] };
    const filtered = filterByView(arch, view);
    return { nodes: gridLayout(filtered.elements), edges: buildEdges(filtered.links) };
  }, [arch, view]);

  useEffect(() => {
    if (nodes.length > 0) {
      const id = setTimeout(() => fitView({ padding: 0.2, duration: 400 }), 60);
      return () => clearTimeout(id);
    }
  }, [nodes.length, fitView]);

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

  return (
    <div className="h-full w-full">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        connectionMode={ConnectionMode.Loose}
        onNodeClick={onNodeClick}
        onConnect={onConnect}
        fitView
        proOptions={{ hideAttribution: true }}
      >
        <Background gap={24} size={1} color="rgb(39 39 42)" />
        <Controls className="!bg-zinc-900 !border-zinc-800 !text-zinc-200" />
        <MiniMap
          pannable
          zoomable
          className="!bg-zinc-900 !border !border-zinc-800"
          nodeColor={() => 'rgb(99 102 241)'}
          maskColor="rgba(9, 9, 11, 0.7)"
        />
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
