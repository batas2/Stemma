import { useEffect, useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import clsx from 'clsx';
import type { EdgeArrow } from '@/lib/edgeStyles';

const OPTS: { value: EdgeArrow; label: string }[] = [
  { value: 'none', label: 'None' },
  { value: 'closed', label: 'Arrow' },
  { value: 'open', label: 'Open' },
  { value: 'circle', label: 'Circle' },
  { value: 'diamond', label: 'Diamond' },
  { value: 'pipe', label: 'Bar' },
];

/** A little line ending in the given marker — drawn directly (not via SVG markers) so it previews
 *  in the dropdown. `side` flips it to the source end. Inherits `currentColor`. */
function Glyph({ type, side }: { type: EdgeArrow; side: 'start' | 'end' }) {
  const C = 'currentColor';
  return (
    <svg width={50} height={14} viewBox="0 0 50 14" className="shrink-0">
      <line x1={6} y1={7} x2={44} y2={7} stroke={C} strokeWidth={1.4} />
      <g transform={side === 'start' ? 'translate(50,0) scale(-1,1)' : undefined}>
        {type === 'closed' && <polygon points="36,3 44,7 36,11" fill={C} />}
        {type === 'open' && <path d="M36,3 L44,7 L36,11" fill="none" stroke={C} strokeWidth={1.4} />}
        {type === 'circle' && <circle cx={40} cy={7} r={3.2} fill={C} />}
        {type === 'diamond' && <polygon points="36,7 40,3 44,7 40,11" fill={C} />}
        {type === 'pipe' && <line x1={43} y1={2} x2={43} y2={12} stroke={C} strokeWidth={2} />}
      </g>
    </svg>
  );
}

/** Endpoint-marker picker with a live preview of the shape at the right (or left) end. */
export function MarkerSelect({ value, side, onChange }: { value: EdgeArrow; side: 'start' | 'end'; onChange: (v: EdgeArrow) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    function onDoc(e: MouseEvent) { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); }
    if (open) document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);
  const cur = OPTS.find((o) => o.value === value) ?? OPTS[0];
  return (
    <div ref={ref} className="relative flex-1 min-w-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title={`${side === 'start' ? 'Source' : 'Target'} end`}
        className="w-full input-base flex items-center gap-1.5 text-xs justify-between"
      >
        <span className="flex items-center gap-1.5 min-w-0 text-zinc-700 dark:text-zinc-200">
          <Glyph type={value} side={side} /><span className="truncate">{cur.label}</span>
        </span>
        <ChevronDown className="w-3 h-3 text-faint shrink-0" />
      </button>
      {open && (
        <div className="absolute z-popover left-0 right-0 mt-1 rounded surface-overlay py-1 max-h-56 overflow-auto">
          {OPTS.map((o) => (
            <button
              key={o.value}
              type="button"
              onClick={() => { onChange(o.value); setOpen(false); }}
              className={clsx(
                'w-full flex items-center gap-2 px-2 py-1 text-xs',
                o.value === value
                  ? 'bg-indigo-500/15 text-indigo-700 dark:text-indigo-200'
                  : 'hover:bg-zinc-100 dark:hover:bg-zinc-800/60 text-zinc-700 dark:text-zinc-200',
              )}
            >
              <Glyph type={o.value} side={side} />
              <span>{o.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
