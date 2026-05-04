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
import { TypeNodeView } from './nodes/TypeNodeView';
import { useApp } from '@/lib/store';
import { applyOperation } from '@/lib/signalr';
import type { TypeModel } from '@/lib/types';

const nodeTypes = { type: TypeNodeView };

function layout(types: TypeModel[]): { nodes: Node[]; edges: Edge[] } {
  // Simple grid auto-layout — visually pleasant enough for the spike.
  const cols = Math.max(1, Math.ceil(Math.sqrt(types.length)));
  const COL_W = 280;
  const ROW_H = 240;
  const nodes: Node[] = types.map((t, i) => ({
    id: t.id,
    type: 'type',
    position: { x: (i % cols) * COL_W + 40, y: Math.floor(i / cols) * ROW_H + 40 },
    data: { type: t },
  }));
  const edges: Edge[] = [];
  for (const t of types) {
    for (const b of t.baseTypes) {
      const target = types.find((x) => x.name === b.fullyQualifiedName || x.id === b.fullyQualifiedName);
      if (!target) continue;
      edges.push({
        id: `${t.id}->${target.id}`,
        source: t.id,
        target: target.id,
        type: 'smoothstep',
        animated: target.kind === 'interface',
        style: target.kind === 'interface' ? { strokeDasharray: '4 4' } : undefined,
      });
    }
  }
  return { nodes, edges };
}

function CanvasInner() {
  const ws = useApp((s) => s.workspace);
  const select = useApp((s) => s.selectType);
  const setToast = useApp((s) => s.setToast);
  const { fitView } = useReactFlow();

  const { nodes, edges } = useMemo(() => {
    if (!ws) return { nodes: [], edges: [] };
    const all = ws.projects.flatMap((p) => p.types);
    return layout(all);
  }, [ws]);

  useEffect(() => {
    if (nodes.length > 0) {
      const id = setTimeout(() => fitView({ padding: 0.2, duration: 400 }), 50);
      return () => clearTimeout(id);
    }
  }, [nodes.length, fitView]);

  const onNodeClick: NodeMouseHandler = (_, node) => select(node.id);

  const onConnect = async (params: { source: string | null; target: string | null }) => {
    if (!params.source || !params.target || !ws) return;
    const allTypes = ws.projects.flatMap((p) => p.types);
    const target = allTypes.find((t) => t.id === params.target);
    if (!target) return;
    const opKind = target.kind === 'interface' ? 'AddImplementation' : 'AddInheritance';
    const result = await applyOperation({
      kind: opKind,
      opId: `op_${Date.now()}`,
      typeId: params.source,
      ...(opKind === 'AddInheritance'
        ? { baseTypeId: params.target }
        : { interfaceTypeId: params.target }),
    });
    if ('reason' in result) {
      setToast({ kind: 'error', text: `${result.reason}: ${result.message}` });
    } else {
      setToast({ kind: 'success', text: 'Edge applied' });
    }
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

export function Canvas() {
  return (
    <ReactFlowProvider>
      <CanvasInner />
    </ReactFlowProvider>
  );
}
