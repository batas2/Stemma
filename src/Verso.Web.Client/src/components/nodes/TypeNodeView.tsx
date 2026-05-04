import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';
import { Box, Type as TypeIcon, FileCode, Layers, Database } from 'lucide-react';
import clsx from 'clsx';
import type { TypeModel, TypeKind } from '@/lib/types';

export type TypeFlowNode = Node<{ type: TypeModel }, 'type'>;

const iconForKind: Record<TypeKind, typeof Box> = {
  class: Box,
  interface: Layers,
  record: FileCode,
  struct: Database,
  enum: TypeIcon,
};

export function TypeNodeView({ data, selected }: NodeProps<TypeFlowNode>) {
  const t = data.type;
  const Icon = iconForKind[t.kind] ?? Box;
  return (
    <div
      className={clsx(
        'rounded-lg border bg-white/95 dark:bg-zinc-900/95 backdrop-blur shadow-md dark:shadow-lg min-w-[200px] max-w-[280px] transition-shadow',
        selected
          ? 'border-indigo-500 shadow-indigo-500/20 ring-1 ring-indigo-500/40'
          : 'border-zinc-200 dark:border-zinc-800 hover:border-zinc-300 dark:hover:border-zinc-700 hover:shadow-lg dark:hover:shadow-xl'
      )}
    >
      <Handle type="target" position={Position.Top} />
      <div className="px-3 py-2 border-b border-zinc-200 dark:border-zinc-800 flex items-center gap-2">
        <Icon className="w-3.5 h-3.5 text-indigo-500 dark:text-indigo-400 shrink-0" />
        <span className="text-[11px] uppercase tracking-wider text-zinc-500 font-medium">{t.kind}</span>
        <span className="ml-auto font-medium text-zinc-900 dark:text-zinc-100 text-sm truncate" title={t.name}>{t.name}</span>
      </div>
      {t.properties.length > 0 && (
        <ul className="text-[12px] py-1.5 text-zinc-700 dark:text-zinc-300">
          {t.properties.slice(0, 6).map((p) => (
            <li key={p.name} className="px-3 py-0.5 flex justify-between gap-2 hover:bg-zinc-100 dark:hover:bg-zinc-800/40">
              <span className="truncate text-zinc-800 dark:text-zinc-200">{p.name}</span>
              <span className="text-zinc-500 truncate font-mono text-[11px]">{p.type.fullyQualifiedName}</span>
            </li>
          ))}
          {t.properties.length > 6 && (
            <li className="px-3 py-0.5 text-[11px] text-zinc-500">+{t.properties.length - 6} more</li>
          )}
        </ul>
      )}
      <Handle type="source" position={Position.Bottom} />
    </div>
  );
}
