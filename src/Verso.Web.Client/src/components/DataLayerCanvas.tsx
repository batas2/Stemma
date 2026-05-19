import { useMemo } from 'react';
import clsx from 'clsx';
import { ReactFlow, Background, BackgroundVariant, Controls, MiniMap, ReactFlowProvider, type Node, type Edge } from '@xyflow/react';
import { Database, Layers, Hexagon, ShieldCheck } from 'lucide-react';
import { useApp } from '@/lib/store';
import type { YamlConcept, YamlRelation } from '@/lib/types';

/**
 * Epic 08 Track C — Data Model + Resource Tree renderers.
 *
 * Reads `yamlConcepts` / `yamlRelations` from the store (hydrated from
 * `Concepts/*.verso.yaml`) and lays them out:
 *
 *   - dataModel  → AggregateRoot backdrops with nested entities/value-objects.
 *                  composes/references relations render as edges.
 *   - resourceTree → top-down tree of Resources via the `parent` property,
 *                  with action_* properties shown as chips inside the node.
 */

const KIND_ICON = {
  AggregateRoot: Database,
  DomainEntity: Layers,
  ValueObject: Hexagon,
  Resource: ShieldCheck,
} as const;

const AGG_WIDTH = 320;
const AGG_PAD_TOP = 48;
const CHILD_HEIGHT = 70;
const CHILD_GAP = 12;
const COL_GAP = 60;

function DataNode({ data }: { data: { label: string; kind: string; chips: string[]; selected: boolean } }) {
  const Icon = (KIND_ICON as Record<string, typeof Database>)[data.kind] ?? Layers;
  return (
    <div
      className={clsx(
        'rounded-md border bg-white dark:bg-zinc-950 px-3 py-2 shadow-sm min-w-[180px]',
        data.selected
          ? 'border-indigo-500 ring-2 ring-indigo-500/30'
          : 'border-zinc-200 dark:border-zinc-800',
      )}
    >
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-zinc-500">
        <Icon className="w-3 h-3" /> {data.kind}
      </div>
      <div className="text-sm font-medium text-body mt-0.5">{data.label}</div>
      {data.chips.length > 0 && (
        <div className="flex flex-wrap gap-1 mt-1.5">
          {data.chips.map((c) => (
            <span
              key={c}
              className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-100 dark:bg-zinc-800 text-muted font-mono"
            >
              {c}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function AggregateBackdrop({ data }: { data: { label: string; domain: string | null } }) {
  return (
    <div className="rounded-lg border-2 border-dashed border-violet-400/60 bg-violet-500/5 pointer-events-none">
      <div className="px-3 py-1.5 text-[11px] uppercase tracking-wide text-violet-600 dark:text-violet-300 font-medium flex items-center gap-1.5">
        <Database className="w-3 h-3" />
        {data.label}
        {data.domain && <span className="text-zinc-400 normal-case">· {data.domain}</span>}
      </div>
    </div>
  );
}

const nodeTypes = { data: DataNode, aggregate: AggregateBackdrop };

function layoutDataModel(concepts: YamlConcept[], relations: YamlRelation[]): { nodes: Node[]; edges: Edge[] } {
  const aggregates = concepts.filter((c) => c.kind === 'AggregateRoot');
  const byParent = new Map<string, YamlConcept[]>();
  for (const c of concepts) {
    if (c.kind === 'AggregateRoot') continue;
    const parent = c.properties['parent'] ?? '';
    const key = parent || '_loose';
    if (!byParent.has(key)) byParent.set(key, []);
    byParent.get(key)!.push(c);
  }
  const nodes: Node[] = [];
  let x = 40;
  const y0 = 40;
  for (const agg of aggregates) {
    const kids = byParent.get(agg.id) ?? [];
    const aggHeight = AGG_PAD_TOP + Math.max(1, kids.length) * (CHILD_HEIGHT + CHILD_GAP);
    nodes.push({
      id: agg.id,
      type: 'aggregate',
      position: { x, y: y0 },
      data: { label: agg.name, domain: agg.properties['domain'] ?? null },
      style: { width: AGG_WIDTH, height: aggHeight, zIndex: 0 },
      draggable: true,
      selectable: true,
    });
    kids.forEach((k, i) => {
      nodes.push({
        id: k.id,
        type: 'data',
        position: { x: x + 24, y: y0 + AGG_PAD_TOP + i * (CHILD_HEIGHT + CHILD_GAP) },
        data: { label: k.name, kind: k.kind, chips: [], selected: false },
        draggable: true,
        selectable: true,
      });
    });
    x += AGG_WIDTH + COL_GAP;
  }
  const loose = byParent.get('_loose') ?? [];
  let lx = 40;
  const ly = y0 + 400;
  for (const c of loose) {
    nodes.push({
      id: c.id,
      type: 'data',
      position: { x: lx, y: ly },
      data: { label: c.name, kind: c.kind, chips: [], selected: false },
      draggable: true,
      selectable: true,
    });
    lx += 220;
  }
  const edges: Edge[] = relations
    .filter((r) => r.kind === 'composes' || r.kind === 'references')
    .map((r) => ({
      id: r.id,
      source: r.from,
      target: r.to,
      label: r.kind,
      labelStyle: { fontSize: 10, fill: '#71717a' },
      style: { stroke: r.kind === 'composes' ? '#a78bfa' : '#94a3b8', strokeWidth: 1.5 },
      animated: false,
    }));
  return { nodes, edges };
}

function layoutResourceTree(concepts: YamlConcept[]): { nodes: Node[]; edges: Edge[] } {
  const resources = concepts.filter((c) => c.kind === 'Resource');
  const childrenOf = new Map<string, YamlConcept[]>();
  const roots: YamlConcept[] = [];
  for (const r of resources) {
    const parent = r.properties['parent'] ?? '';
    if (!parent) { roots.push(r); continue; }
    if (!childrenOf.has(parent)) childrenOf.set(parent, []);
    childrenOf.get(parent)!.push(r);
  }
  const nodes: Node[] = [];
  const edges: Edge[] = [];
  const COL_W = 260;
  const ROW_H = 110;
  function actionChips(c: YamlConcept): string[] {
    const chips: string[] = [];
    for (const [k, v] of Object.entries(c.properties)) {
      if (!k.startsWith('action_')) continue;
      const op = k.slice('action_'.length);
      chips.push(v ? `${op} (${v})` : op);
    }
    return chips;
  }
  let nextRow = 0;
  function place(node: YamlConcept, depth: number): number {
    const kids = childrenOf.get(node.id) ?? [];
    if (kids.length === 0) {
      const row = nextRow++;
      nodes.push({
        id: node.id,
        type: 'data',
        position: { x: 40 + depth * COL_W, y: 40 + row * ROW_H },
        data: { label: node.name, kind: 'Resource', chips: actionChips(node), selected: false },
        draggable: true,
        selectable: true,
      });
      return row;
    }
    const kidRows = kids.map((k) => place(k, depth + 1));
    const mid = (kidRows[0] + kidRows[kidRows.length - 1]) / 2;
    nodes.push({
      id: node.id,
      type: 'data',
      position: { x: 40 + depth * COL_W, y: 40 + mid * ROW_H },
      data: { label: node.name, kind: 'Resource', chips: actionChips(node), selected: false },
      draggable: true,
      selectable: true,
    });
    for (const k of kids) {
      edges.push({
        id: `nest_${node.id}_${k.id}`,
        source: node.id,
        target: k.id,
        style: { stroke: '#10b981', strokeWidth: 1.5 },
      });
    }
    return Math.floor(mid);
  }
  for (const r of roots) place(r, 0);
  return { nodes, edges };
}

function CanvasInner() {
  const view = useApp((s) => s.view);
  const concepts = useApp((s) => s.yamlConcepts);
  const relations = useApp((s) => s.yamlRelations);
  const selectedId = useApp((s) => s.selectedYamlConceptId);
  const selectYaml = useApp((s) => s.selectYamlConcept);

  const { nodes, edges } = useMemo(() => {
    if (view === 'dataModel') return layoutDataModel(concepts, relations);
    if (view === 'resourceTree') return layoutResourceTree(concepts);
    return { nodes: [], edges: [] };
  }, [view, concepts, relations]);

  const themed = useMemo(
    () => nodes.map((n) => (n.type === 'data'
      ? { ...n, data: { ...(n.data as Record<string, unknown>), selected: n.id === selectedId } }
      : n)),
    [nodes, selectedId],
  );

  const empty = concepts.length === 0;
  const filtered = view === 'dataModel'
    ? concepts.filter((c) => c.kind === 'AggregateRoot' || c.kind === 'DomainEntity' || c.kind === 'ValueObject')
    : concepts.filter((c) => c.kind === 'Resource');

  if (empty || filtered.length === 0) {
    return (
      <div className="h-full flex items-center justify-center text-xs text-faint p-8 text-center">
        <div className="max-w-md space-y-2">
          <p className="text-sm text-muted font-medium">No data-layer concepts</p>
          <p>
            Add a <code className="font-mono text-[11px]">Concepts/{view === 'resourceTree' ? 'resources' : 'data-model'}.verso.yaml</code>{' '}
            file to this workspace to populate this view.
          </p>
        </div>
      </div>
    );
  }

  return (
    <ReactFlow
      nodes={themed}
      edges={edges}
      nodeTypes={nodeTypes}
      onNodeClick={(_, n) => selectYaml(n.id)}
      onPaneClick={() => selectYaml(null)}
      fitView
      proOptions={{ hideAttribution: true }}
    >
      <Background variant={BackgroundVariant.Dots} gap={20} size={1} />
      <MiniMap pannable zoomable />
      <Controls showInteractive={false} />
    </ReactFlow>
  );
}

export function DataLayerCanvas() {
  return (
    <ReactFlowProvider>
      <CanvasInner />
    </ReactFlowProvider>
  );
}
