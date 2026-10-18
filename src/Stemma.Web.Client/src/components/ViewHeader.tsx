import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import clsx from 'clsx';
import { useApp } from '@/lib/store';
import { renderNotes } from '@/lib/notesMarkdown';
import { headerTitle, legendItems, withHeaderField, type DrawnView, type HeaderField, type LegendItem } from '@/lib/viewHeader';

/**
 * The top of a view's page (F-014): what the picture is, the one sentence it should leave in the
 * room, how to read it, and what its colours mean.
 *
 * Drawn over the canvas in screen space rather than on it (ADR-0023), so it stays readable at any
 * zoom and stays put while a presented page moves the camera into its focus. It sits inside the
 * React Flow container, which is what the PDF export captures, so a page of the deck carries it.
 */
export function ViewHeader({ viewKey, viewName, drawn, readOnly, presenting }: {
  viewKey: string;
  viewName: string;
  drawn: DrawnView;
  /** Presenting or capturing: nothing is edited, and empty fields are not shown. */
  readOnly: boolean;
  /** Full screen: larger type, for the back of the room. */
  presenting: boolean;
}) {
  const header = useApp((s) => s.viewHeaders[viewKey]);
  const setViewHeader = useApp((s) => s.setViewHeader);
  const root = useApp((s) => s.workspace?.rootPath ?? '');
  const [collapsed, setCollapsed] = useCollapsed(root, viewKey);
  const items = useMemo(() => (header ? legendItems(header, drawn) : []), [header, drawn]);

  if (!header) return null;
  const folded = collapsed && !readOnly;
  const title = headerTitle(header, viewName);

  function commit(field: HeaderField, value: string) {
    const current = useApp.getState().viewHeaders[viewKey];
    if (!current || (current[field] ?? '') === value) return;
    if (!setViewHeader(viewKey, withHeaderField(current, field, value))) {
      useApp.getState().setToast({ kind: 'error', text: "The header couldn't be saved: the layout file hasn't been read yet." });
    }
  }

  return (
    <section
      data-view-header
      aria-label={`About this view: ${title}`}
      className={clsx(
        'stemma-view-header absolute top-0 inset-x-0 z-[7] border-b border-zinc-200/90 dark:border-zinc-800',
        'bg-white/[0.93] dark:bg-zinc-950/[0.9] backdrop-blur-sm shadow-[0_1px_10px_rgba(15,23,42,0.06)]',
        presenting ? 'px-10 pt-6 pb-5' : 'px-5 pt-3 pb-3',
      )}
      // Clicks on the header are the header's, not the canvas's: no pan, no deselect.
      onPointerDown={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
    >
      <div className={clsx('flex items-start', presenting ? 'gap-12' : 'gap-8')}>
        <div className="min-w-0 flex-1">
          <EditableText
            value={header.title ?? ''}
            shown={title}
            placeholder={viewName}
            readOnly={readOnly}
            onCommit={(v) => commit('title', v)}
            label="Title"
            className={clsx('font-semibold tracking-tight text-zinc-900 dark:text-zinc-50', presenting ? 'text-[30px] leading-tight' : 'text-[19px] leading-snug')}
          />
          {!folded && (
            <>
              <EditableText
                value={header.message ?? ''}
                placeholder="Add the message — the one sentence this view should leave in the room"
                readOnly={readOnly}
                onCommit={(v) => commit('message', v)}
                label="Message"
                className={clsx('font-medium text-zinc-800 dark:text-zinc-100', presenting ? 'text-[22px] leading-snug mt-2' : 'text-[15px] leading-snug mt-1')}
              />
              <EditableText
                value={header.context ?? ''}
                placeholder="Add context — what this shows, and how to read it"
                readOnly={readOnly}
                multiline
                onCommit={(v) => commit('context', v)}
                label="Context"
                className={clsx('stemma-view-header-context text-zinc-600 dark:text-zinc-300', presenting ? 'text-[16px] leading-relaxed mt-2.5 max-w-[78ch]' : 'text-[12.5px] leading-relaxed mt-1.5 max-w-[96ch]')}
              />
            </>
          )}
        </div>
        {!folded && items.length > 0 && <Legend items={items} presenting={presenting} />}
        {!readOnly && (
          <button
            onClick={() => setCollapsed(!collapsed)}
            aria-label={collapsed ? 'Show the whole header' : 'Fold the header to its title'}
            aria-expanded={!collapsed}
            title={collapsed ? 'Show the whole header' : 'Fold the header to its title'}
            className="shrink-0 -mr-1 p-1 rounded text-zinc-400 hover:text-zinc-700 hover:bg-zinc-100 dark:hover:text-zinc-200 dark:hover:bg-zinc-800"
          >
            {collapsed ? <ChevronDown className="w-4 h-4" /> : <ChevronUp className="w-4 h-4" />}
          </button>
        )}
      </div>
    </section>
  );
}

function Legend({ items, presenting }: { items: LegendItem[]; presenting: boolean }) {
  // Two columns once the key is long enough to need them, so it stays a band rather than a tower.
  const columns = items.length > 4 ? 2 : 1;
  return (
    <ul
      aria-label="Legend"
      className={clsx(
        'stemma-view-legend shrink-0 grid gap-y-1.5 self-center',
        columns === 2 ? 'grid-cols-2 gap-x-6' : 'grid-cols-1',
        presenting ? 'text-[15px] max-w-[46%]' : 'text-[12px] max-w-[44%]',
      )}
    >
      {items.map((item, i) => (
        <li key={`${item.label}-${i}`} className="flex items-center gap-2 min-w-0 text-zinc-700 dark:text-zinc-300">
          <LegendMark item={item} presenting={presenting} />
          <span className="truncate" title={item.label}>{item.label}</span>
        </li>
      ))}
    </ul>
  );
}

const DASH: Record<string, string | undefined> = { solid: undefined, dashed: '5 3', dotted: '1.5 3' };

function LegendMark({ item, presenting }: { item: LegendItem; presenting: boolean }) {
  const w = presenting ? 34 : 26;
  const h = presenting ? 20 : 15;
  if (item.kind === 'swatch') {
    return (
      <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden="true" className="shrink-0">
        <rect
          x={1} y={1} width={w - 2} height={h - 2} rx={4}
          className={clsx(!item.fill && 'fill-white dark:fill-zinc-900', !item.border && 'stroke-zinc-400')}
          fill={item.fill ?? undefined}
          stroke={item.border ?? undefined}
          strokeWidth={1.5}
          strokeDasharray={DASH[item.style]}
        />
      </svg>
    );
  }
  const y = h / 2;
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden="true" className={clsx('shrink-0', !item.color && 'text-zinc-500')}>
      <line x1={1} y1={y} x2={w - 7} y2={y} stroke={item.color ?? 'currentColor'} strokeWidth={1.75} strokeDasharray={DASH[item.style]} />
      <path d={`M ${w - 8} ${y - 3.5} L ${w - 1} ${y} L ${w - 8} ${y + 3.5} z`} fill={item.color ?? 'currentColor'} />
    </svg>
  );
}

/**
 * A header field: shown as text, edited in place. Enter (or Ctrl+Enter in the context) or leaving
 * the field saves; Esc puts it back. Read-only, an empty field is not shown at all.
 */
function EditableText({ value, shown, placeholder, readOnly, multiline, onCommit, label, className }: {
  value: string;
  /** What to show when not editing, if not the value itself (the title falls back to the view's name). */
  shown?: string;
  placeholder: string;
  readOnly: boolean;
  multiline?: boolean;
  onCommit: (value: string) => void;
  label: string;
  className?: string;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const ref = useRef<HTMLTextAreaElement & HTMLInputElement>(null);
  useEffect(() => {
    if (draft === null) return;
    ref.current?.focus();
  }, [draft === null]); // eslint-disable-line react-hooks/exhaustive-deps

  const display = shown ?? value;
  if (readOnly) {
    if (!display) return null;
    return multiline
      ? <div className={className} dangerouslySetInnerHTML={{ __html: renderNotes(display) }} />
      : <div className={className}>{display}</div>;
  }

  if (draft !== null) {
    const done = () => { onCommit(draft.trim()); setDraft(null); };
    const props = {
      ref,
      'aria-label': label,
      value: draft,
      onChange: (e: React.ChangeEvent<HTMLTextAreaElement & HTMLInputElement>) => setDraft(e.target.value),
      onBlur: done,
      onKeyDown: (e: React.KeyboardEvent) => {
        // The canvas must not see these: Delete would delete the selection, letters are shortcuts.
        e.stopPropagation();
        if (e.key === 'Escape') { e.preventDefault(); setDraft(null); }
        else if (e.key === 'Enter' && (!multiline || e.ctrlKey || e.metaKey)) { e.preventDefault(); done(); }
      },
      className: clsx(className, 'block w-full rounded-md bg-white dark:bg-zinc-900 ring-2 ring-indigo-500/60 px-1.5 -mx-1.5 py-0.5 outline-none'),
    };
    return multiline
      ? <textarea {...props} rows={Math.min(8, Math.max(2, draft.split('\n').length))} />
      : <input {...props} />;
  }

  return (
    <button
      type="button"
      onClick={() => setDraft(value)}
      aria-label={`Edit the ${label.toLowerCase()}`}
      title={`Edit the ${label.toLowerCase()}${multiline ? ' · Ctrl+Enter saves' : ''}`}
      className={clsx(className, 'block w-full text-left rounded-md px-1.5 -mx-1.5 py-0.5 hover:bg-zinc-100/80 dark:hover:bg-zinc-800/60 cursor-text')}
    >
      {display
        ? (multiline ? <span className="block" dangerouslySetInnerHTML={{ __html: renderNotes(display) }} /> : display)
        : <span className="italic text-zinc-400 dark:text-zinc-500 font-normal">{placeholder}</span>}
    </button>
  );
}

/** Folding the header is the reader's choice, kept in this browser only. */
function useCollapsed(root: string, viewKey: string): [boolean, (v: boolean) => void] {
  const key = `stemma.viewHeader.collapsed:${root}:${viewKey}`;
  const read = () => { try { return localStorage.getItem(key) === '1'; } catch { return false; } };
  const [value, setValue] = useState(read);
  useEffect(() => { setValue(read()); }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  return [value, (v: boolean) => {
    setValue(v);
    try { if (v) localStorage.setItem(key, '1'); else localStorage.removeItem(key); } catch { /* storage unavailable */ }
  }];
}

/** The header's height on screen right now, or 0 — what a fit leaves free at the top of the canvas. */
export function viewHeaderHeight(): number {
  if (typeof document === 'undefined') return 0;
  const el = document.querySelector<HTMLElement>('[data-view-header]');
  return el ? Math.ceil(el.getBoundingClientRect().height) : 0;
}
