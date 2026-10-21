import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronUp, GitCompareArrows, X } from 'lucide-react';
import clsx from 'clsx';
import { useApp } from '@/lib/store';
import { stopCompare, useCompareDiff } from '@/lib/compare';
import { describeCounts, describeLink, kindLabel, type ChangeKind, type ElementChange, type LinkChange } from '@/lib/modelDiff';
import { revealElement } from '@/lib/canvasReveal';

const DOT: Record<ChangeKind, string> = {
  added: 'bg-emerald-500',
  changed: 'bg-amber-500',
  removed: 'bg-rose-500',
};

const WORD: Record<ChangeKind, string> = { added: 'Added', changed: 'Changed', removed: 'Removed' };

/**
 * While comparing (F-017 AC3): what the canvas is compared with, how much changed, the list of
 * changes, and the way out. Sits at the bottom of the canvas, out of the way of a view's header.
 */
export function CompareBar() {
  const compare = useApp((s) => s.compare);
  const presenting = useApp((s) => s.presenting);
  const dimRest = useApp((s) => s.compareDimRest);
  const setDimRest = useApp((s) => s.setCompareDimRest);
  const arch = useApp((s) => s.arch);
  const diff = useCompareDiff();
  const [listOpen, setListOpen] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => { if (!compare) setListOpen(false); }, [compare]);

  // Names as they are now, falling back to as they were, for a link whose end has gone.
  const names = useMemo(() => {
    const m = new Map<string, string>();
    for (const e of compare?.before?.elements ?? []) m.set(e.id, e.name);
    for (const e of arch?.elements ?? []) m.set(e.id, e.name);
    return (id: string) => m.get(id) ?? id;
  }, [compare, arch]);

  if (!compare || !diff || presenting) return null;

  function show(c: ElementChange | LinkChange) {
    if ('element' in c) {
      if (c.change === 'removed') window.dispatchEvent(new CustomEvent('stemma:focus-ghost', { detail: { id: c.id } }));
      else revealElement(c.id);
    } else {
      // A relationship is shown by the element it starts from.
      const from = c.link.fromId;
      if (arch?.elements.some((e) => e.id === from)) revealElement(from);
      else window.dispatchEvent(new CustomEvent('stemma:focus-ghost', { detail: { id: from } }));
    }
  }

  const groups: { kind: ChangeKind; items: (ElementChange | LinkChange)[] }[] = (['added', 'changed', 'removed'] as ChangeKind[])
    .map((kind) => ({ kind, items: [...diff.elements.filter((c) => c.change === kind), ...diff.links.filter((c) => c.change === kind)] }))
    .filter((g) => g.items.length > 0);

  return (
    // Between the zoom controls (bottom left) and the minimap (bottom right), centred in what is left.
    <div className="absolute left-16 right-[232px] bottom-4 z-chrome flex flex-col items-center gap-2 pointer-events-none">
      {listOpen && diff.counts.total > 0 && (
        <div
          ref={listRef}
          role="region"
          aria-label="Changes"
          className="pointer-events-auto w-[28rem] max-w-full max-h-[50vh] overflow-y-auto rounded-xl surface-overlay shadow-2xl py-1"
        >
          {groups.map((g) => (
            <div key={g.kind}>
              <div className="px-3 pt-2.5 pb-1 text-[10px] uppercase tracking-wider text-zinc-500 flex items-center gap-1.5">
                <span className={clsx('w-1.5 h-1.5 rounded-full', DOT[g.kind])} aria-hidden /> {WORD[g.kind]} · {g.items.length}
              </div>
              <ul>
                {g.items.map((c) => (
                  <li key={`${'element' in c ? 'e' : 'l'}:${c.id}`}>
                    <button
                      onClick={() => show(c)}
                      className="w-full text-left px-3 py-1.5 hover:bg-zinc-100 dark:hover:bg-zinc-800/70 focus:bg-zinc-100 dark:focus:bg-zinc-800/70 outline-none"
                    >
                      <span className={clsx('block text-sm truncate', c.change === 'removed' && 'line-through decoration-rose-500/70')}>
                        {'element' in c ? c.element.name : describeLink(c.link, names)}
                      </span>
                      {'element' in c && c.change !== 'changed' && (
                        <span className="block text-[11px] text-muted">{kindLabel(c.element.kind)}</span>
                      )}
                      {c.details.map((d) => <span key={d} className="block text-[11px] text-muted">{d}</span>)}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
      <div
        role="region"
        aria-label="Comparison"
        className="pointer-events-auto flex items-center gap-3 rounded-full surface-overlay shadow-lg pl-3.5 pr-1.5 py-1.5 text-xs whitespace-nowrap overflow-x-auto max-w-full"
      >
        <GitCompareArrows className="w-3.5 h-3.5 text-indigo-500 shrink-0" aria-hidden />
        <span className="text-muted">
          Compared with <span className="text-body font-medium">{compare.label}</span>
          <span className="font-mono text-faint"> · {compare.sha.slice(0, 7)}</span>
        </span>
        <span className="flex items-center gap-2.5" aria-label={describeCounts(diff.counts)}>
          {diff.counts.total === 0 && <span className="text-muted">No changes</span>}
          {(['added', 'removed', 'changed'] as ChangeKind[]).map((k) => diff.counts[k] > 0 && (
            <span key={k} className="flex items-center gap-1">
              <span className={clsx('w-2 h-2 rounded-full', DOT[k])} aria-hidden />
              <span className="tabular-nums">{diff.counts[k]}</span> <span className="text-muted">{k}</span>
            </span>
          ))}
        </span>
        <span className="w-px h-4 bg-zinc-300 dark:bg-zinc-700" aria-hidden />
        <button
          onClick={() => setListOpen((v) => !v)}
          disabled={diff.counts.total === 0}
          aria-expanded={listOpen}
          className="flex items-center gap-1 px-2 py-1 rounded-full hover:bg-zinc-200/70 dark:hover:bg-zinc-800 disabled:opacity-40"
        >
          Changes <ChevronUp className={clsx('w-3 h-3 transition-transform', !listOpen && 'rotate-180')} />
        </button>
        <label className="flex items-center gap-1.5 cursor-pointer select-none" title="Fade what did not change, so the changes stand out">
          <input type="checkbox" className="accent-indigo-500" checked={dimRest} onChange={(e) => setDimRest(e.target.checked)} />
          Fade the rest
        </label>
        <button
          onClick={stopCompare}
          title="Stop comparing (Esc)"
          className="flex items-center gap-1 px-2.5 py-1 rounded-full bg-zinc-200/80 dark:bg-zinc-800 hover:bg-zinc-300 dark:hover:bg-zinc-700 font-medium"
        >
          <X className="w-3 h-3" aria-hidden /> Done
        </button>
      </div>
    </div>
  );
}
