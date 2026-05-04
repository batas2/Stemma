import { AlignLeft, AlignRight, AlignCenterHorizontal, AlignStartVertical, AlignEndVertical, AlignCenterVertical, StretchHorizontal, StretchVertical, Trash2 } from 'lucide-react';
import { Tooltip } from './Tooltip';

interface Props {
  count: number;
  onAlign: (axis: 'left' | 'right' | 'centerX' | 'top' | 'bottom' | 'centerY') => void;
  onDistribute: (axis: 'horizontal' | 'vertical') => void;
  onDelete: () => void;
}

export function MultiSelectBar({ count, onAlign, onDistribute, onDelete }: Props) {
  if (count < 2) return null;
  return (
    <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-chrome surface-overlay rounded-md px-2 py-1 flex items-center gap-1 text-xs">
      <span className="text-muted px-2 font-medium">{count} selected</span>
      <span className="w-px h-4 bg-zinc-300 dark:bg-zinc-700" />
      <Tooltip label="Align left">
        <button onClick={() => onAlign('left')} aria-label="Align left" className="p-1.5 rounded text-muted hover:text-body hover:bg-zinc-200/70 dark:hover:bg-zinc-800/60">
          <AlignLeft className="w-3.5 h-3.5" />
        </button>
      </Tooltip>
      <Tooltip label="Align center (X)">
        <button onClick={() => onAlign('centerX')} aria-label="Align horizontal center" className="p-1.5 rounded text-muted hover:text-body hover:bg-zinc-200/70 dark:hover:bg-zinc-800/60">
          <AlignCenterHorizontal className="w-3.5 h-3.5" />
        </button>
      </Tooltip>
      <Tooltip label="Align right">
        <button onClick={() => onAlign('right')} aria-label="Align right" className="p-1.5 rounded text-muted hover:text-body hover:bg-zinc-200/70 dark:hover:bg-zinc-800/60">
          <AlignRight className="w-3.5 h-3.5" />
        </button>
      </Tooltip>
      <span className="w-px h-4 bg-zinc-300 dark:bg-zinc-700" />
      <Tooltip label="Align top">
        <button onClick={() => onAlign('top')} aria-label="Align top" className="p-1.5 rounded text-muted hover:text-body hover:bg-zinc-200/70 dark:hover:bg-zinc-800/60">
          <AlignStartVertical className="w-3.5 h-3.5" />
        </button>
      </Tooltip>
      <Tooltip label="Align center (Y)">
        <button onClick={() => onAlign('centerY')} aria-label="Align vertical center" className="p-1.5 rounded text-muted hover:text-body hover:bg-zinc-200/70 dark:hover:bg-zinc-800/60">
          <AlignCenterVertical className="w-3.5 h-3.5" />
        </button>
      </Tooltip>
      <Tooltip label="Align bottom">
        <button onClick={() => onAlign('bottom')} aria-label="Align bottom" className="p-1.5 rounded text-muted hover:text-body hover:bg-zinc-200/70 dark:hover:bg-zinc-800/60">
          <AlignEndVertical className="w-3.5 h-3.5" />
        </button>
      </Tooltip>
      <span className="w-px h-4 bg-zinc-300 dark:bg-zinc-700" />
      <Tooltip label="Distribute horizontally">
        <button onClick={() => onDistribute('horizontal')} disabled={count < 3} aria-label="Distribute horizontally" className="p-1.5 rounded text-muted hover:text-body hover:bg-zinc-200/70 dark:hover:bg-zinc-800/60 disabled:opacity-30 disabled:cursor-not-allowed">
          <StretchHorizontal className="w-3.5 h-3.5" />
        </button>
      </Tooltip>
      <Tooltip label="Distribute vertically">
        <button onClick={() => onDistribute('vertical')} disabled={count < 3} aria-label="Distribute vertically" className="p-1.5 rounded text-muted hover:text-body hover:bg-zinc-200/70 dark:hover:bg-zinc-800/60 disabled:opacity-30 disabled:cursor-not-allowed">
          <StretchVertical className="w-3.5 h-3.5" />
        </button>
      </Tooltip>
      <span className="w-px h-4 bg-zinc-300 dark:bg-zinc-700" />
      <Tooltip label="Delete selected">
        <button onClick={onDelete} aria-label="Delete selected" className="p-1.5 rounded text-rose-600 dark:text-rose-400 hover:bg-rose-500/10">
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </Tooltip>
    </div>
  );
}
