import { useState } from 'react';
import {
  Wand2, Network, ChevronDown, Magnet, AlignLeft, AlignRight, AlignCenterHorizontal,
  AlignStartVertical, AlignEndVertical, AlignCenterVertical,
  StretchHorizontal, StretchVertical, Maximize2, Trash2, MousePointerSquareDashed,
} from 'lucide-react';
import clsx from 'clsx';
import { useApp } from '@/lib/store';
import type { LayoutAlgorithm } from '@/lib/autoLayout';

interface Props {
  onAutoLayout: (algorithm: LayoutAlgorithm) => void;
  onAlign: (axis: 'left' | 'right' | 'centerX' | 'top' | 'bottom' | 'centerY') => void;
  onDistribute: (axis: 'horizontal' | 'vertical') => void;
  onFitSelection: () => void;
  onDeleteSelected: () => void;
  selectedCount: number;
}

export function CanvasToolbar({ onAutoLayout, onAlign, onDistribute, onFitSelection, onDeleteSelected, selectedCount }: Props) {
  const snap = useApp((s) => s.snapEnabled);
  const toggleSnap = useApp((s) => s.toggleSnap);
  const [layoutMenuOpen, setLayoutMenuOpen] = useState(false);

  const Btn = ({
    onClick, title, active, children, disabled,
  }: { onClick?: () => void; title: string; active?: boolean; children: React.ReactNode; disabled?: boolean }) => (
    <button
      onClick={onClick}
      title={title}
      disabled={disabled}
      className={clsx(
        'p-1.5 rounded transition-colors',
        active
          ? 'bg-indigo-500/20 text-indigo-700 dark:text-indigo-200'
          : disabled
            ? 'text-zinc-400 dark:text-zinc-600 cursor-not-allowed'
            : 'text-zinc-600 dark:text-zinc-400 hover:bg-zinc-200/70 dark:hover:bg-zinc-800/60 hover:text-zinc-900 dark:hover:text-zinc-100'
      )}
    >
      {children}
    </button>
  );

  return (
    <div className="absolute top-3 left-1/2 -translate-x-1/2 z-10 flex items-center gap-0.5 bg-white/90 dark:bg-zinc-900/90 backdrop-blur border border-zinc-200 dark:border-zinc-800 rounded-md shadow-sm px-1 py-0.5">
      <div className="relative">
        <Btn onClick={() => setLayoutMenuOpen((v) => !v)} title="Auto-arrange">
          <span className="flex items-center gap-1">
            <Wand2 className="w-3.5 h-3.5" />
            <ChevronDown className="w-3 h-3" />
          </span>
        </Btn>
        {layoutMenuOpen && (
          <div
            className="absolute left-0 top-full mt-1 w-56 rounded border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 shadow-lg overflow-hidden"
            onMouseLeave={() => setLayoutMenuOpen(false)}
          >
            <button
              onClick={() => { onAutoLayout('hierarchical'); setLayoutMenuOpen(false); }}
              className="w-full text-left px-3 py-2 text-xs hover:bg-zinc-100 dark:hover:bg-zinc-800/60 flex items-start gap-2"
            >
              <Wand2 className="w-3.5 h-3.5 mt-0.5 text-indigo-500" />
              <div>
                <div className="font-medium">Hierarchical (layered)</div>
                <div className="text-[10px] text-zinc-500 mt-0.5">Group by Bounded Context, top-down rows.</div>
              </div>
            </button>
            <button
              onClick={() => { onAutoLayout('force'); setLayoutMenuOpen(false); }}
              className="w-full text-left px-3 py-2 text-xs hover:bg-zinc-100 dark:hover:bg-zinc-800/60 flex items-start gap-2 border-t border-zinc-200 dark:border-zinc-800"
            >
              <Network className="w-3.5 h-3.5 mt-0.5 text-violet-500" />
              <div>
                <div className="font-medium">Force-directed (organic)</div>
                <div className="text-[10px] text-zinc-500 mt-0.5">Spring + repulsion physics, clusters by links.</div>
              </div>
            </button>
          </div>
        )}
      </div>
      <span className="w-px h-5 bg-zinc-200 dark:bg-zinc-800 mx-1" />
      <Btn onClick={toggleSnap} title="Snap to grid (20px)" active={snap}>
        <Magnet className="w-3.5 h-3.5" />
      </Btn>
      <Btn onClick={onFitSelection} title="Fit to selection (f)" disabled={selectedCount === 0}>
        <Maximize2 className="w-3.5 h-3.5" />
      </Btn>
      <span className="w-px h-5 bg-zinc-200 dark:bg-zinc-800 mx-1" />
      <Btn onClick={() => onAlign('left')} title={selectedCount < 2 ? 'Align left — select 2+ nodes (Shift+drag or Ctrl+click)' : 'Align left'} disabled={selectedCount < 2}>
        <AlignLeft className="w-3.5 h-3.5" />
      </Btn>
      <Btn onClick={() => onAlign('centerX')} title={selectedCount < 2 ? 'Align center (X) — select 2+ nodes' : 'Align center (X)'} disabled={selectedCount < 2}>
        <AlignCenterHorizontal className="w-3.5 h-3.5" />
      </Btn>
      <Btn onClick={() => onAlign('right')} title={selectedCount < 2 ? 'Align right — select 2+ nodes' : 'Align right'} disabled={selectedCount < 2}>
        <AlignRight className="w-3.5 h-3.5" />
      </Btn>
      <span className="w-px h-5 bg-zinc-200 dark:bg-zinc-800 mx-1" />
      <Btn onClick={() => onAlign('top')} title={selectedCount < 2 ? 'Align top — select 2+ nodes' : 'Align top'} disabled={selectedCount < 2}>
        <AlignStartVertical className="w-3.5 h-3.5" />
      </Btn>
      <Btn onClick={() => onAlign('centerY')} title={selectedCount < 2 ? 'Align center (Y) — select 2+ nodes' : 'Align center (Y)'} disabled={selectedCount < 2}>
        <AlignCenterVertical className="w-3.5 h-3.5" />
      </Btn>
      <Btn onClick={() => onAlign('bottom')} title={selectedCount < 2 ? 'Align bottom — select 2+ nodes' : 'Align bottom'} disabled={selectedCount < 2}>
        <AlignEndVertical className="w-3.5 h-3.5" />
      </Btn>
      <span className="w-px h-5 bg-zinc-200 dark:bg-zinc-800 mx-1" />
      <Btn onClick={() => onDistribute('horizontal')} title="Distribute horizontally (needs 3+)" disabled={selectedCount < 3}>
        <StretchHorizontal className="w-3.5 h-3.5" />
      </Btn>
      <Btn onClick={() => onDistribute('vertical')} title="Distribute vertically (needs 3+)" disabled={selectedCount < 3}>
        <StretchVertical className="w-3.5 h-3.5" />
      </Btn>
      {selectedCount > 0 && (
        <>
          <span className="w-px h-5 bg-zinc-200 dark:bg-zinc-800 mx-1" />
          <span
            className="flex items-center gap-1 px-2 py-1 rounded text-[11px] bg-indigo-500/15 text-indigo-700 dark:text-indigo-200 font-medium"
            title="Shift+drag to marquee, Ctrl/Cmd+click to add"
          >
            <MousePointerSquareDashed className="w-3 h-3" />
            {selectedCount} selected
          </span>
          <Btn
            onClick={onDeleteSelected}
            title={selectedCount === 1 ? 'Delete selected' : `Delete ${selectedCount} selected`}
          >
            <Trash2 className="w-3.5 h-3.5 text-rose-600 dark:text-rose-400" />
          </Btn>
        </>
      )}
    </div>
  );
}
