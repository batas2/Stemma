import { useEffect, useRef, useState } from 'react';
import { ChevronDown, ChevronUp, Crosshair, Search, X } from 'lucide-react';
import clsx from 'clsx';
import { useApp, activePage } from '@/lib/store';
import { toggleToken, type Facet } from '@/lib/spotlight';

/**
 * Find on this view (F-018): a query and one-tap filters; what matches stays lit and the rest fades,
 * or goes. Enter steps through the matches in reading order. With a book open on this view, the
 * matches can become the page's focus — "show me everything the Core squad owns", made into a slide.
 */
export function FindBar({ matches, facets, viewId, onStep }: {
  /** The matching cards, in reading order; null while the query is empty. */
  matches: string[] | null;
  facets: Facet[];
  /** The view on screen, as a book page names it. */
  viewId: string | null;
  onStep: (id: string) => void;
}) {
  const find = useApp((s) => s.find);
  const setFind = useApp((s) => s.setFind);
  const page = useApp(activePage);
  const bookId = useApp((s) => s.activeBookId);
  const inputRef = useRef<HTMLInputElement>(null);
  const [index, setIndex] = useState(-1);
  const [top, setTop] = useState(12);

  // Focus the field whenever the bar is asked for, even when it is already open (⌘F again).
  useEffect(() => {
    function focus() { requestAnimationFrame(() => { inputRef.current?.focus(); inputRef.current?.select(); }); }
    focus();
    window.addEventListener('stemma:find', focus);
    return () => window.removeEventListener('stemma:find', focus);
  }, []);

  // A new query starts from the first match again.
  useEffect(() => { setIndex(-1); }, [find.query]);

  // Below the view's header, which spans the top of the canvas and changes height as it folds.
  useEffect(() => {
    const measure = () => {
      const header = document.querySelector<HTMLElement>('[data-view-header]');
      setTop(header ? Math.ceil(header.getBoundingClientRect().height) + 12 : 12);
    };
    measure();
    const id = setInterval(measure, 400);
    return () => clearInterval(id);
  }, []);

  const count = matches?.length ?? 0;
  function step(delta: 1 | -1) {
    if (!matches || count === 0) return;
    const next = index < 0 ? (delta > 0 ? 0 : count - 1) : (index + delta + count) % count;
    setIndex(next);
    onStep(matches[next]);
  }

  function close() {
    setFind({ open: false, query: '' });
  }

  const pageHere = bookId && page && page.view === viewId ? page : null;
  const groups: Facet['group'][] = ['Status', 'Squad', 'Kind'];
  const chip = 'shrink-0 inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-[11px] transition-colors';
  const tokens = find.query.toLowerCase().split(/\s+/);

  return (
    <div
      role="search"
      aria-label="Find on this view"
      className="absolute left-1/2 -translate-x-1/2 z-chrome w-[min(44rem,calc(100%-8rem))] rounded-xl surface-overlay shadow-xl"
      style={{ top }}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <div className="flex items-center gap-2 px-3 py-2">
        <Search className="w-4 h-4 text-faint shrink-0" aria-hidden />
        <input
          ref={inputRef}
          value={find.query}
          onChange={(e) => setFind({ query: e.target.value })}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'g')) { e.preventDefault(); step(e.shiftKey ? -1 : 1); }
            else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
          }}
          placeholder="Find on this view — a name, status:target, squad:core, #tag…"
          aria-label="Find"
          className="flex-1 min-w-0 bg-transparent text-sm outline-none placeholder:text-zinc-500"
        />
        <span className={clsx('text-xs tabular-nums shrink-0', matches && count === 0 ? 'text-rose-500' : 'text-muted')} aria-live="polite">
          {!matches ? '' : count === 0 ? 'No matches' : index >= 0 ? `${index + 1} of ${count}` : `${count} match${count === 1 ? '' : 'es'}`}
        </span>
        <div className="flex items-center shrink-0">
          <button onClick={() => step(-1)} disabled={count === 0} aria-label="Previous match (Shift+Enter)" title="Previous (⇧↩)" className="p-1 rounded text-muted hover:text-body hover:bg-zinc-200/60 dark:hover:bg-zinc-800 disabled:opacity-30">
            <ChevronUp className="w-4 h-4" />
          </button>
          <button onClick={() => step(1)} disabled={count === 0} aria-label="Next match (Enter)" title="Next (↩)" className="p-1 rounded text-muted hover:text-body hover:bg-zinc-200/60 dark:hover:bg-zinc-800 disabled:opacity-30">
            <ChevronDown className="w-4 h-4" />
          </button>
        </div>
        <div role="radiogroup" aria-label="The rest" className="inline-flex rounded-md border border-default overflow-hidden text-[11px] shrink-0">
          {(['dim', 'hide'] as const).map((m) => (
            <button
              key={m}
              role="radio"
              aria-checked={find.mode === m}
              onClick={() => setFind({ mode: m })}
              className={clsx('px-2 py-0.5', find.mode === m ? 'bg-indigo-500/15 text-indigo-700 dark:text-indigo-300' : 'text-muted hover:text-body')}
            >
              {m === 'dim' ? 'Fade the rest' : 'Hide the rest'}
            </button>
          ))}
        </div>
        <button onClick={close} aria-label="Close (Esc)" title="Close (Esc)" className="p-1 rounded text-muted hover:text-body hover:bg-zinc-200/60 dark:hover:bg-zinc-800 shrink-0">
          <X className="w-4 h-4" />
        </button>
      </div>

      {(facets.length > 0 || pageHere) && (
        <div className="flex items-center gap-1.5 px-3 pb-2 overflow-x-auto scrollbar-thin">
          {groups.map((g) => {
            const items = facets.filter((f) => f.group === g).slice(0, 6);
            if (items.length === 0) return null;
            return (
              <div key={g} className="flex items-center gap-1 shrink-0">
                <span className="text-[10px] uppercase tracking-wider text-zinc-500 pr-0.5">{g}</span>
                {items.map((f) => {
                  const on = tokens.includes(f.token.toLowerCase());
                  return (
                    <button
                      key={f.token}
                      onClick={() => setFind({ query: toggleToken(find.query, f.token) })}
                      aria-pressed={on}
                      title={on ? `Stop filtering by ${f.label}` : `Only ${f.label} (${f.count})`}
                      className={clsx(chip, on ? 'border-indigo-500/60 bg-indigo-500/15 text-indigo-700 dark:text-indigo-300' : 'border-default text-muted hover:text-body hover:border-indigo-400')}
                    >
                      {f.label} <span className="tabular-nums text-muted">{f.count}</span>
                    </button>
                  );
                })}
                <span className="w-px h-4 bg-zinc-200 dark:bg-zinc-700 mx-1" aria-hidden />
              </div>
            );
          })}
          {pageHere && (
            <button
              onClick={() => matches && useApp.getState().updateBookPage(bookId!, pageHere.id, { focus: matches })}
              disabled={count === 0}
              title="Make what is found the focus of the book page on screen"
              className={clsx(chip, 'ml-auto border-amber-500/50 text-amber-700 dark:text-amber-300 hover:bg-amber-500/10 disabled:opacity-40')}
            >
              <Crosshair className="w-3 h-3" aria-hidden /> Point the page at {count === 1 ? 'it' : `these ${count}`}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
