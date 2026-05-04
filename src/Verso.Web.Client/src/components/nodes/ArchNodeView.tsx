import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';
import { Box, Cuboid, Layers, Package, User, Server, Target, BookOpen } from 'lucide-react';
import clsx from 'clsx';
import type { ArchElement, ArchElementKind } from '@/lib/types';

export type ArchFlowNode = Node<{ element: ArchElement }, 'arch'>;

const iconForKind: Record<ArchElementKind, typeof Box> = {
  module: Package,
  boundedContext: Layers,
  softwareSystem: Server,
  container: Cuboid,
  person: User,
  useCase: Target,
  capability: BookOpen,
};

const labelForKind: Record<ArchElementKind, string> = {
  module: 'Module',
  boundedContext: 'Bounded Context',
  softwareSystem: 'Software System',
  container: 'Container',
  person: 'Person',
  useCase: 'Use Case',
  capability: 'Capability',
};

const accentForKind: Record<ArchElementKind, string> = {
  module: 'text-indigo-400',
  boundedContext: 'text-violet-400',
  softwareSystem: 'text-emerald-400',
  container: 'text-emerald-300',
  person: 'text-amber-400',
  useCase: 'text-rose-400',
  capability: 'text-sky-400',
};

export function ArchNodeView({ data, selected }: NodeProps<ArchFlowNode>) {
  const e = data.element;
  const Icon = iconForKind[e.kind] ?? Box;
  const accent = accentForKind[e.kind] ?? 'text-indigo-400';
  const isPerson = e.kind === 'person';
  return (
    <div
      className={clsx(
        'rounded-lg border bg-white/95 dark:bg-zinc-900/95 backdrop-blur shadow-md dark:shadow-lg min-w-[180px] max-w-[260px] transition-shadow',
        isPerson ? 'rounded-full px-4 py-2.5 min-w-0' : '',
        selected
          ? 'border-indigo-500 shadow-indigo-500/20 ring-1 ring-indigo-500/40'
          : 'border-zinc-200 dark:border-zinc-800 hover:border-zinc-300 dark:hover:border-zinc-700 hover:shadow-lg dark:hover:shadow-xl'
      )}
    >
      <Handle type="target" position={Position.Top} />
      {isPerson ? (
        <div className="flex items-center gap-2">
          <Icon className={clsx('w-3.5 h-3.5 shrink-0', accent)} />
          <span className="text-zinc-900 dark:text-zinc-100 text-sm">{e.name}</span>
        </div>
      ) : (
        <>
          <div className="px-3 py-2 border-b border-zinc-200 dark:border-zinc-800 flex items-center gap-2">
            <Icon className={clsx('w-3.5 h-3.5 shrink-0', accent)} />
            <span className="text-[11px] uppercase tracking-wider text-zinc-500 font-medium truncate">
              {labelForKind[e.kind]}
            </span>
          </div>
          <div className="px-3 py-2">
            <div className="font-medium text-zinc-900 dark:text-zinc-100 text-sm truncate" title={e.name}>{e.name}</div>
            {e.attributes.contextId && (
              <div className="text-[10px] text-zinc-500 mt-0.5 font-mono truncate">in {e.attributes.contextId}</div>
            )}
          </div>
        </>
      )}
      <Handle type="source" position={Position.Bottom} />
    </div>
  );
}
