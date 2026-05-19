import { useEffect, useRef, useState } from 'react';
import { Handle, NodeResizer, Position, type Node, type NodeProps } from '@xyflow/react';
import { Box, Cuboid, Layers, Package, User, Server, Target, BookOpen } from 'lucide-react';
import clsx from 'clsx';
import type { ArchElement, ArchElementKind, ArchTagInfo } from '@/lib/types';
import { DEFAULT_VISIBLE_FIELDS, type NodeFieldKey } from '@/lib/nodeStyles';

export type TagsByTarget = Record<string, ArchTagInfo>;

export type ArchNodeData = {
  element: ArchElement;
  tag?: ArchTagInfo;
  nodeStyle?: {
    fillColor?: string;
    borderColor?: string;
    borderWidth?: number;
    borderStyle?: 'solid' | 'dashed' | 'dotted';
    width?: number;
    height?: number;
    // visibleFields is a list of string keys: built-in NodeFieldKey values
    // OR custom property names (anything in customProps). The renderer tries
    // built-in first and falls back to customProps[key].
    visibleFields?: string[];
  };
  customProps?: Record<string, string>;
  violationSeverity?: 'info' | 'warning' | 'error';
  onResize?: (id: string, w: number, h: number) => void;
  resizable?: boolean;
  // Inline-edit support — when `editing` is true the name renders as an input.
  editing?: boolean;
  onCommitName?: (id: string, next: string) => void;
  onCancelEdit?: () => void;
  // Dependency-view extras — Epic 07 architect UX.
  dimmed?: boolean;
  fanIn?: number;
  fanOut?: number;
  contextName?: string | null;
  isDependencyView?: boolean;
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

const FIELD_LABEL: Record<NodeFieldKey, string> = {
  kind: 'Kind',
  name: 'Name',
  id: 'Id',
  contextId: 'Context',
  systemId: 'System',
  containerKind: 'Container kind',
  squad: 'Squad',
  domain: 'Domain',
  status: 'Status',
  phase: 'Phase',
  narrativePreview: 'Narrative',
};

export const ALL_FIELD_KEYS: NodeFieldKey[] = [
  'kind', 'name', 'id', 'contextId', 'systemId', 'containerKind',
  'squad', 'domain', 'status', 'phase',
];

export function fieldLabel(k: NodeFieldKey): string { return FIELD_LABEL[k] ?? k; }

const BUILTIN_KEYS = new Set<string>([
  'kind', 'name', 'id', 'contextId', 'systemId', 'containerKind',
  'squad', 'domain', 'status', 'phase', 'narrativePreview',
]);

export function ArchNodeView({ id, data, selected }: NodeProps<ArchFlowNode>) {
  const e = data.element;
  const tag = data.tag;
  const nodeStyle = data.nodeStyle;
  const customProps = data.customProps ?? {};
  const Icon = iconForKind[e.kind] ?? Box;
  const accent = accentForKind[e.kind] ?? 'text-indigo-500';
  const isPerson = e.kind === 'person';
  const status = tag?.lifecycle?.status;
  const statusClasses = statusStyle(status);
  const violationSeverity = data.violationSeverity;
  const visible = nodeStyle?.visibleFields ?? DEFAULT_VISIBLE_FIELDS;
  const showField = (k: string) => visible.includes(k);
  const visibleCustomKeys = visible.filter((k) => !BUILTIN_KEYS.has(k) && k in customProps);

  const inlineStyle: React.CSSProperties = {};
  if (nodeStyle?.fillColor) inlineStyle.background = nodeStyle.fillColor;
  if (nodeStyle?.borderColor) inlineStyle.borderColor = nodeStyle.borderColor;
  if (nodeStyle?.borderWidth !== undefined) inlineStyle.borderWidth = `${nodeStyle.borderWidth}px`;
  if (nodeStyle?.borderStyle) inlineStyle.borderStyle = nodeStyle.borderStyle;
  if (nodeStyle?.width) inlineStyle.width = nodeStyle.width;
  if (nodeStyle?.height) inlineStyle.height = nodeStyle.height;
  if (data.dimmed) inlineStyle.opacity = 0.25;
  // External SoftwareSystem (or external Person) gets a dashed boundary so architects can
  // distinguish in-scope from out-of-scope at a glance — the C4 reference convention.
  const isExternal = e.attributes?.external === 'true' || e.attributes?.role === 'external';
  if (isExternal) {
    inlineStyle.borderStyle = inlineStyle.borderStyle ?? 'dashed';
    inlineStyle.borderWidth = inlineStyle.borderWidth ?? '1.5px';
    inlineStyle.background = inlineStyle.background ?? 'rgba(148, 163, 184, 0.08)';
  }
  const hasCustomStyle = !!(nodeStyle?.fillColor || nodeStyle?.borderColor || nodeStyle?.borderStyle);

  // Default size hints — kept on the wrapper so the NodeResizer respects min sizes.
  const minWidth = isPerson ? 120 : 180;
  const minHeight = isPerson ? 40 : 80;

  return (
    <>
      {data.resizable && (
        <NodeResizer
          color="rgb(99 102 241)"
          isVisible={selected}
          minWidth={minWidth}
          minHeight={minHeight}
          handleStyle={{ width: 8, height: 8, borderRadius: 2 }}
          lineStyle={{ borderWidth: 1 }}
          onResizeEnd={(_, params) => data.onResize?.(id, Math.round(params.width), Math.round(params.height))}
        />
      )}
      <div
        style={inlineStyle}
        className={clsx(
          'relative rounded-lg border bg-white/95 dark:bg-zinc-900/95 backdrop-blur shadow-md dark:shadow-lg transition-shadow h-full',
          !nodeStyle?.width && 'min-w-[180px] max-w-[260px]',
          isPerson && !nodeStyle?.width ? 'rounded-full px-4 py-2.5 min-w-0' : '',
          isPerson && nodeStyle?.width ? 'rounded-full px-4 py-2.5' : '',
          !hasCustomStyle && statusClasses.className,
          selected && (statusClasses.outline ?? 'ring-1 ring-indigo-500/40 shadow-indigo-500/20'),
          !selected && !status && !hasCustomStyle && 'border-zinc-200 dark:border-zinc-800 hover:border-zinc-300 dark:hover:border-zinc-700 hover:shadow-lg dark:hover:shadow-xl'
        )}
      >
        <Handle type="target" position={Position.Top} />
        {/* Fan-in / fan-out badges — shown only on the dependency view, where the architect
            wants to see "how many things depend on this" + "how many things this pulls from" at a glance. */}
        {data.isDependencyView && (data.fanIn !== undefined || data.fanOut !== undefined) && (
          <div className="absolute -top-2 left-2 flex items-center gap-1 text-[10px] font-mono pointer-events-none">
            {data.fanIn !== undefined && data.fanIn > 0 && (
              <span title={`${data.fanIn} module${data.fanIn === 1 ? '' : 's'} depend on this`}
                className="px-1 py-0 rounded bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border border-emerald-500/30">
                ←{data.fanIn}
              </span>
            )}
            {data.fanOut !== undefined && data.fanOut > 0 && (
              <span title={`This depends on ${data.fanOut} module${data.fanOut === 1 ? '' : 's'}`}
                className="px-1 py-0 rounded bg-amber-500/15 text-amber-700 dark:text-amber-300 border border-amber-500/30">
                →{data.fanOut}
              </span>
            )}
          </div>
        )}
        {violationSeverity && (
          <span
            className={clsx(
              'absolute -top-1.5 -right-1.5 w-3 h-3 rounded-full border-2 border-white dark:border-zinc-900 shadow',
              violationSeverity === 'error' && 'bg-rose-500',
              violationSeverity === 'warning' && 'bg-amber-500',
              violationSeverity === 'info' && 'bg-sky-500'
            )}
            title={`${violationSeverity[0].toUpperCase()}${violationSeverity.slice(1)} validation`}
          />
        )}
        {isPerson ? (
          <div className="flex items-center gap-2 h-full">
            <Icon className={clsx('w-3.5 h-3.5 shrink-0', accent)} />
            {showField('name') && (
              data.editing
                ? <NameEditor id={id} initial={e.name} onCommit={data.onCommitName} onCancel={data.onCancelEdit} />
                : <span className="text-zinc-900 dark:text-zinc-100 text-sm">{e.name}</span>
            )}
            {showField('status') && status && <StatusBadge status={status} />}
          </div>
        ) : (
          <>
            {(showField('kind') || (showField('status') && status)) && (
              <div className="px-3 py-2 border-b border-zinc-200 dark:border-zinc-800 flex items-center gap-2">
                <Icon className={clsx('w-3.5 h-3.5 shrink-0', accent)} />
                {showField('kind') && (
                  <span className="text-[11px] uppercase tracking-wider text-zinc-500 font-medium truncate">
                    {labelForKind[e.kind]}
                  </span>
                )}
                {isExternal && (
                  <span className="text-[9px] uppercase tracking-wider px-1 py-0 rounded bg-zinc-200 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 font-medium">
                    external
                  </span>
                )}
                {showField('status') && status && <StatusBadge status={status} />}
              </div>
            )}
            <div className="px-3 py-2 space-y-0.5">
              {showField('name') && (
                data.editing
                  ? <NameEditor id={id} initial={e.name} onCommit={data.onCommitName} onCancel={data.onCancelEdit} />
                  : <div className="font-medium text-zinc-900 dark:text-zinc-100 text-sm truncate" title={e.name}>{e.name}</div>
              )}
              {showField('id') && (
                <div className="text-[10px] text-zinc-500 font-mono truncate">{e.id}</div>
              )}
              {showField('contextId') && e.attributes.contextId && (
                <div className="text-[10px] text-zinc-500 truncate" title={`Bounded Context: ${data.contextName ?? e.attributes.contextId}`}>
                  in <span className="font-medium text-zinc-700 dark:text-zinc-300">{data.contextName ?? e.attributes.contextId}</span>
                </div>
              )}
              {showField('systemId') && e.attributes.systemId && (
                <div className="text-[10px] text-zinc-500 font-mono truncate">in {e.attributes.systemId}</div>
              )}
              {showField('containerKind') && e.attributes.containerKind && (
                <div className="text-[10px] text-zinc-500 truncate">{e.attributes.containerKind}</div>
              )}
              {showField('squad') && tag?.ownership?.squad && (
                <div className="text-[10px] text-zinc-500 truncate">👥 {tag.ownership.squad}</div>
              )}
              {showField('domain') && tag?.ownership?.domain && (
                <div className="text-[10px] text-zinc-500 truncate">🏷️ {tag.ownership.domain}</div>
              )}
              {showField('phase') && tag?.lifecycle?.phase && (
                <div className="text-[10px] text-zinc-500 truncate">⏱ {tag.lifecycle.phase}</div>
              )}
              {visibleCustomKeys.length > 0 && (
                <div className="pt-1 mt-1 border-t border-zinc-100 dark:border-zinc-800/60 space-y-0.5">
                  {visibleCustomKeys.map((k) => (
                    <div key={k} className="text-[10px] flex gap-1.5 text-zinc-600 dark:text-zinc-400">
                      <span className="text-zinc-500 truncate shrink-0">{k}:</span>
                      <span className="truncate text-zinc-800 dark:text-zinc-200" title={customProps[k]}>{customProps[k]}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        )}
        <Handle type="source" position={Position.Bottom} />
      </div>
    </>
  );
}

const STATUS_GLYPH: Record<string, string> = {
  'current': '●',
  'target': '◆',
  'to-be-created': '○',
  'to-adapt': '◇',
  'deprecated': '━',
  'proposed': '◇',
};

function NameEditor({ id, initial, onCommit, onCancel }: {
  id: string;
  initial: string;
  onCommit?: (id: string, next: string) => void;
  onCancel?: () => void;
}) {
  const [value, setValue] = useState(initial);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);
  function commit() {
    const trimmed = value.trim();
    if (!trimmed || trimmed === initial) { onCancel?.(); return; }
    onCommit?.(id, trimmed);
  }
  return (
    <input
      ref={ref}
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onKeyDown={(e) => {
        // Stop xyflow from interpreting these as canvas shortcuts.
        e.stopPropagation();
        if (e.key === 'Enter') { e.preventDefault(); commit(); }
        else if (e.key === 'Escape') { e.preventDefault(); onCancel?.(); }
      }}
      onBlur={commit}
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
      className="nodrag w-full bg-white dark:bg-zinc-900 border border-indigo-500 rounded px-1.5 py-0.5 text-sm font-medium text-zinc-900 dark:text-zinc-100 outline-none"
    />
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
  const glyph = STATUS_GLYPH[status];
  return (
    <span className={clsx('ml-auto px-1.5 py-0.5 rounded text-[9px] uppercase tracking-wider border font-medium flex items-center gap-1', cls)}>
      {glyph && <span aria-hidden="true">{glyph}</span>}
      {status}
    </span>
  );
}
