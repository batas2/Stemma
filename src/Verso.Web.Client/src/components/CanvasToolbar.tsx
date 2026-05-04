import { useState } from 'react';
import {
  Wand2, Network, ChevronDown, Magnet, AlignLeft, AlignRight, AlignCenterHorizontal,
  AlignStartVertical, AlignEndVertical, AlignCenterVertical,
  StretchHorizontal, StretchVertical,
} from 'lucide-react';
import clsx from 'clsx';
import { useApp } from '@/lib/store';
import type { LayoutAlgorithm } from '@/lib/autoLayout';

interface Props {
  onAutoLayout: (algorithm: LayoutAlgorithm) => void;
  onAlign: (axis: 'left' | 'right' | 'centerX' | 'top' | 'bottom' | 'centerY') => void;
  onDistribute: (axis: 'horizontal' | 'vertical') => void;
  selectedCount: number;
}

export function CanvasToolbar({ onAutoLayout, onAlign, onDistribute, selectedCount }: Props) {
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
      <span className="w-px h-5 bg-zinc-200 dark:bg-zinc-800 mx-1" />
      <Btn onClick={() => onAlign('left')} title="Align left" disabled={selectedCount < 2}>
        <AlignLeft className="w-3.5 h-3.5" />
      </Btn>
      <Btn onClick={() => onAlign('centerX')} title="Align center (X)" disabled={selectedCount < 2}>
        <AlignCenterHorizontal className="w-3.5 h-3.5" />
      </Btn>
      <Btn onClick={() => onAlign('right')} title="Align right" disabled={selectedCount < 2}>
        <AlignRight className="w-3.5 h-3.5" />
      </Btn>
      <span className="w-px h-5 bg-zinc-200 dark:bg-zinc-800 mx-1" />
      <Btn onClick={() => onAlign('top')} title="Align top" disabled={selectedCount < 2}>
        <AlignStartVertical className="w-3.5 h-3.5" />
      </Btn>
      <Btn onClick={() => onAlign('centerY')} title="Align center (Y)" disabled={selectedCount < 2}>
        <AlignCenterVertical className="w-3.5 h-3.5" />
      </Btn>
      <Btn onClick={() => onAlign('bottom')} title="Align bottom" disabled={selectedCount < 2}>
        <AlignEndVertical className="w-3.5 h-3.5" />
      </Btn>
      <span className="w-px h-5 bg-zinc-200 dark:bg-zinc-800 mx-1" />
      <Btn onClick={() => onDistribute('horizontal')} title="Distribute horizontally" disabled={selectedCount < 3}>
        <StretchHorizontal className="w-3.5 h-3.5" />
      </Btn>
      <Btn onClick={() => onDistribute('vertical')} title="Distribute vertically" disabled={selectedCount < 3}>
        <StretchVertical className="w-3.5 h-3.5" />
      </Btn>
    </div>
  );
}
