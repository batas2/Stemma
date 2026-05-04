import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';
import { Box, Cuboid, Layers, Package, User, Server, Target, BookOpen } from 'lucide-react';
import clsx from 'clsx';
import type { ArchElement, ArchElementKind, ArchTagInfo } from '@/lib/types';

export type TagsByTarget = Record<string, ArchTagInfo>;

export type ArchNodeData = {
  element: ArchElement;
  tag?: ArchTagInfo;
  nodeStyle?: {
    fillColor?: string;
    borderColor?: string;
    borderWidth?: number;
    borderStyle?: 'solid' | 'dashed' | 'dotted';
  };
} & Record<string, unknown>;

export type ArchFlowNode = Node<ArchNodeData, 'arch'>;

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
  module: 'text-indigo-500',
  boundedContext: 'text-violet-500',
  softwareSystem: 'text-emerald-500',
  container: 'text-emerald-400',
  person: 'text-amber-500',
  useCase: 'text-rose-500',
  capability: 'text-sky-500',
};

function statusStyle(status: string | null | undefined): { className: string; outline?: string } {
  switch (status) {
    case 'target':
      return { className: 'border-indigo-500 bg-indigo-50/60 dark:bg-indigo-500/10', outline: 'ring-1 ring-indigo-500/40' };
    case 'to-be-created':
      return { className: 'border-dashed border-amber-500 bg-amber-50/40 dark:bg-amber-500/5' };
    case 'to-adapt':
      return { className: 'border-amber-500 bg-amber-50/30 dark:bg-amber-500/5' };
    case 'deprecated':
      return { className: 'border-zinc-300 bg-zinc-100/50 dark:bg-zinc-900/40 opacity-60 line-through' };
    case 'proposed':
      return { className: 'border-dotted border-sky-500 bg-sky-50/40 dark:bg-sky-500/5' };
    default:
      return { className: '' };
  }
}

export function ArchNodeView({ data, selected }: NodeProps<ArchFlowNode>) {
  const e = data.element;
  const tag = data.tag;
  const nodeStyle = data.nodeStyle;
  const Icon = iconForKind[e.kind] ?? Box;
  const accent = accentForKind[e.kind] ?? 'text-indigo-500';
  const isPerson = e.kind === 'person';
  const status = tag?.lifecycle?.status;
  const statusClasses = statusStyle(status);

  // Custom node style overrides take priority over status / theme defaults.
  const inlineStyle: React.CSSProperties = {};
  if (nodeStyle?.fillColor) inlineStyle.background = nodeStyle.fillColor;
  if (nodeStyle?.borderColor) inlineStyle.borderColor = nodeStyle.borderColor;
  if (nodeStyle?.borderWidth !== undefined) inlineStyle.borderWidth = `${nodeStyle.borderWidth}px`;
  if (nodeStyle?.borderStyle) inlineStyle.borderStyle = nodeStyle.borderStyle;
  const hasCustomStyle = !!(nodeStyle?.fillColor || nodeStyle?.borderColor || nodeStyle?.borderStyle);

  return (
    <div
      style={inlineStyle}
      className={clsx(
        'rounded-lg border bg-white/95 dark:bg-zinc-900/95 backdrop-blur shadow-md dark:shadow-lg min-w-[180px] max-w-[260px] transition-shadow',
        isPerson ? 'rounded-full px-4 py-2.5 min-w-0' : '',
        // Status restyling only applies when no custom style is set; user choice wins.
        !hasCustomStyle && statusClasses.className,
        selected && (statusClasses.outline ?? 'ring-1 ring-indigo-500/40 shadow-indigo-500/20'),
        !selected && !status && !hasCustomStyle && 'border-zinc-200 dark:border-zinc-800 hover:border-zinc-300 dark:hover:border-zinc-700 hover:shadow-lg dark:hover:shadow-xl'
      )}
    >
      <Handle type="target" position={Position.Top} />
      {isPerson ? (
        <div className="flex items-center gap-2">
          <Icon className={clsx('w-3.5 h-3.5 shrink-0', accent)} />
          <span className="text-zinc-900 dark:text-zinc-100 text-sm">{e.name}</span>
          {status && <StatusBadge status={status} />}
        </div>
      ) : (
        <>
          <div className="px-3 py-2 border-b border-zinc-200 dark:border-zinc-800 flex items-center gap-2">
            <Icon className={clsx('w-3.5 h-3.5 shrink-0', accent)} />
            <span className="text-[11px] uppercase tracking-wider text-zinc-500 font-medium truncate">
              {labelForKind[e.kind]}
            </span>
            {status && <StatusBadge status={status} />}
          </div>
          <div className="px-3 py-2">
            <div className="font-medium text-zinc-900 dark:text-zinc-100 text-sm truncate" title={e.name}>{e.name}</div>
            {e.attributes.contextId && (
              <div className="text-[10px] text-zinc-500 mt-0.5 font-mono truncate">in {e.attributes.contextId}</div>
            )}
            {tag?.ownership?.squad && (
              <div className="text-[10px] text-zinc-500 mt-0.5 truncate">👥 {tag.ownership.squad}</div>
            )}
          </div>
        </>
      )}
      <Handle type="source" position={Position.Bottom} />
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    'current': 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30',
    'target': 'bg-indigo-500/15 text-indigo-700 dark:text-indigo-300 border-indigo-500/30',
    'to-be-created': 'bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30',
    'to-adapt': 'bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30',
    'deprecated': 'bg-zinc-500/15 text-zinc-600 dark:text-zinc-400 border-zinc-500/30',
    'proposed': 'bg-sky-500/15 text-sky-700 dark:text-sky-300 border-sky-500/30',
  };
  const cls = colors[status] ?? 'bg-zinc-500/15 text-zinc-600 border-zinc-500/30';
  return (
    <span className={clsx('ml-auto px-1.5 py-0.5 rounded text-[9px] uppercase tracking-wider border font-medium', cls)}>
      {status}
    </span>
  );
}
