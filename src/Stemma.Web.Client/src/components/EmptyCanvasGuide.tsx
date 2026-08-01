import { MousePointerClick, Command } from 'lucide-react';
import type { ArchElementKind } from '@/lib/types';

/**
 * Shown when a workspace is open but the model has no elements yet. Without this the canvas is a
 * bare grid whose creation affordances (right-click, the palette, ⌘K) are all invisible — the
 * blank-canvas dead end. It disappears the moment the model has anything in it.
 */
export function EmptyCanvasGuide({ onAdd }: { onAdd: (kind: ArchElementKind) => void }) {
  return (
    <div className="absolute inset-0 z-[5] flex items-center justify-center pointer-events-none">
      <div
        className="pointer-events-auto flex flex-col items-center gap-4 rounded-xl border-2 border-dashed
                   border-zinc-300 dark:border-zinc-700 bg-white/80 dark:bg-zinc-900/80 backdrop-blur-sm
                   px-8 py-7 text-center max-w-sm"
        role="region"
        aria-label="Empty model"
      >
        <div>
          <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Nothing here yet</h2>
          <p className="mt-1 text-xs text-zinc-500 leading-relaxed">
            Start with a bounded context — the boundary a part of your system lives in. Everything
            you add is written straight into <code className="text-[11px]">Architecture.cs</code>.
          </p>
        </div>

        <button
          type="button"
          onClick={() => onAdd('boundedContext')}
          className="rounded-md bg-indigo-600 hover:bg-indigo-500 focus-visible:outline focus-visible:outline-2
                     focus-visible:outline-offset-2 focus-visible:outline-indigo-500 px-3.5 py-2
                     text-xs font-medium text-white transition-colors"
        >
          Add your first bounded context
        </button>

        <div className="flex flex-col gap-1 text-[11px] text-zinc-500">
          <span className="inline-flex items-center gap-1.5">
            <MousePointerClick className="w-3 h-3" aria-hidden="true" />
            Right-click the canvas for more element types
          </span>
          <span className="inline-flex items-center gap-1.5">
            <Command className="w-3 h-3" aria-hidden="true" />
            Or press <kbd className="font-sans">⌘K</kbd> to add by name
          </span>
        </div>
      </div>
    </div>
  );
}
