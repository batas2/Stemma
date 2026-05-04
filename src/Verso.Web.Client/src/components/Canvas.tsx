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
import { TypeNodeView } from './nodes/TypeNodeView';
import { useApp } from '@/lib/store';
import { applyOperation } from '@/lib/signalr';
import { loadLayout, saveLayout, type SavedPosition } from '@/lib/layout';
import type { TypeModel } from '@/lib/types';

const nodeTypes = { type: TypeNodeView };

function defaultPositions(types: TypeModel[]): Record<string, SavedPosition> {
  const cols = Math.max(1, Math.ceil(Math.sqrt(types.length)));
  const COL_W = 280;
  const ROW_H = 240;
  const out: Record<string, SavedPosition> = {};
  types.forEach((t, i) => {
    out[t.id] = { x: (i % cols) * COL_W + 40, y: Math.floor(i / cols) * ROW_H + 40 };
  });
  return out;
}

function buildEdges(types: TypeModel[]): Edge[] {
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
  return edges;
}

function CanvasInner() {
  const ws = useApp((s) => s.workspace);
  const theme = useApp((s) => s.theme);
  const select = useApp((s) => s.selectType);
  const setToast = useApp((s) => s.setToast);
  const { fitView } = useReactFlow();

  const allTypes = useMemo(() => ws ? ws.projects.flatMap((p) => p.types) : [], [ws]);
  const edges = useMemo(() => buildEdges(allTypes), [allTypes]);
  const [nodes, setNodes] = useState<Node[]>([]);

  useEffect(() => {
    if (!ws) { setNodes([]); return; }
    const saved = loadLayout(ws.rootPath, 'engineer');
    const defaults = defaultPositions(allTypes);
    setNodes((prev) => {
      const prevById = new Map(prev.map((n) => [n.id, n]));
      return allTypes.map((t) => {
        const existing = prevById.get(t.id);
        const pos = existing?.position ?? saved[t.id] ?? defaults[t.id] ?? { x: 0, y: 0 };
        return { id: t.id, type: 'type', position: pos, data: { type: t } } satisfies Node;
      });
    });
  }, [ws, allTypes]);

  useEffect(() => {
    if (nodes.length > 0) {
      const id = setTimeout(() => fitView({ padding: 0.2, duration: 400 }), 80);
      return () => clearTimeout(id);
    }
  }, [ws?.rootPath, fitView]); // eslint-disable-line react-hooks/exhaustive-deps

  const onNodesChange = useCallback((changes: NodeChange[]) => {
    setNodes((current) => {
      const next = applyNodeChanges(changes, current);
      const positionChanged = changes.some((c) => c.type === 'position' && c.position && !c.dragging);
      if (positionChanged && ws) {
        const positions: Record<string, SavedPosition> = {};
        for (const n of next) positions[n.id] = { x: n.position.x, y: n.position.y };
        saveLayout(ws.rootPath, 'engineer', positions);
      }
      return next;
    });
  }, [ws]);

  const onNodeClick: NodeMouseHandler = (_, node) => select(node.id);

  const onConnect = async (params: { source: string | null; target: string | null }) => {
    if (!params.source || !params.target || !ws) return;
    const allTypesNow = ws.projects.flatMap((p) => p.types);
    const target = allTypesNow.find((t) => t.id === params.target);
    if (!target) return;
    const opKind = target.kind === 'interface' ? 'AddImplementation' : 'AddInheritance';
    const result = await applyOperation({
      kind: opKind, opId: `op_${Date.now()}`,
      typeId: params.source,
      ...(opKind === 'AddInheritance' ? { baseTypeId: params.target } : { interfaceTypeId: params.target }),
    });
    if ('reason' in result) setToast({ kind: 'error', text: `${result.reason}: ${result.message}` });
    else setToast({ kind: 'success', text: 'Edge applied' });
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

export function Canvas() {
  return (
    <ReactFlowProvider>
      <CanvasInner />
    </ReactFlowProvider>
  );
}
