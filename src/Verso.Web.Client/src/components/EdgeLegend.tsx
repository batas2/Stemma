import { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { EDGE_GROUPS, edgeLabel } from '@/lib/discovery';

/** Foldable legend that explains the dependency-edge colours used in discovery views. */
export function EdgeLegend() {
  const [open, setOpen] = useState(false);
  return (
    <div className="absolute bottom-3 left-3 z-popover surface-overlay rounded-md border border-default text-[11px] max-w-xs">
      <button
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label="Edge kind legend"
        className="w-full flex items-center gap-2 px-3 py-1.5 text-body hover:bg-zinc-100 dark:hover:bg-zinc-800/40"
      >
        {open ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
        <span className="font-medium">Edge kinds</span>
      </button>
      {open && (
        <div className="px-3 pb-2 space-y-1">
          {EDGE_GROUPS.map((g) => (
            <div key={g.id}>
              <div className="text-[10px] font-semibold uppercase text-faint mt-1">{g.label}</div>
              <div className="grid grid-cols-2 gap-x-2 gap-y-0.5">
                {g.kinds.map((k) => (
                  <div key={k} className="flex items-center gap-1.5">
                    <span aria-hidden className="w-2.5 h-0.5" style={{ background: g.color }} />
                    <span className="truncate">{edgeLabel(k)}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
