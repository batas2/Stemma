import { useMemo, useState } from 'react';
import {
  BookOpen, Copy, Crosshair, FileDown, GripVertical, Maximize2, MonitorSpeaker, Play, Plus, Trash2, TriangleAlert, X, ZoomIn,
} from 'lucide-react';
import { openConsole } from '@/lib/presenterLink';
import clsx from 'clsx';
import { useApp, activeBook, activePage, currentViewId, pageViewIds } from '@/lib/store';
import { describeProblems, pageProblems, type Book, type BookPage } from '@/lib/books';
import { exportBookAsPdf, isExportingBook } from '@/lib/bookExport';
import { confirmAction } from './ConfirmDialog';
import { promptText } from './PromptDialog';

/**
 * The book editor (F-013 AC6), under the canvas while a book is open: the pages as a strip you can
 * reorder, and the page on screen as a form. A page is made from what the canvas shows — *Add page*
 * takes the current view and whatever is selected — so building a walk is opening the view you want
 * to talk about, clicking what you will point at, and writing what you will say.
 */
export function BookFooter() {
  const book = useApp(activeBook);
  const page = useApp(activePage);
  if (!book) return null;
  return <Editor book={book} page={page} />;
}

function Editor({ book, page }: { book: Book; page: BookPage | null }) {
  const arch = useApp((s) => s.arch);
  const customViews = useApp((s) => s.customViews);
  const view = useApp((s) => s.view);
  const activeCustomViewId = useApp((s) => s.activeCustomViewId);
  const canvasSelectedIds = useApp((s) => s.canvasSelectedIds);
  const selectedElementId = useApp((s) => s.selectedElementId);
  const st = useApp.getState;
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dropIndex, setDropIndex] = useState<number | null>(null);
  const [exporting, setExporting] = useState(isExportingBook);

  const ctx = useMemo(
    () => ({ views: pageViewIds({ customViews }), elements: new Set(arch?.elements.map((e) => e.id) ?? []) }),
    [customViews, arch],
  );
  const hereView = currentViewId({ view, activeCustomViewId });
  const selection = canvasSelectedIds.length > 0 ? canvasSelectedIds : selectedElementId ? [selectedElementId] : [];
  const index = page ? book.pages.findIndex((p) => p.id === page.id) : -1;
  const problems = page ? pageProblems(page, ctx) : [];

  function viewName(id: string): string {
    if (id === 'moduleMap') return 'Module Map';
    if (id === 'dependencyGraph') return 'Dependencies';
    return customViews.find((v) => v.id === id)?.name ?? id;
  }

  function onDrop(target: number) {
    if (dragIndex !== null && dragIndex !== target) st().moveBookPage(book.id, dragIndex, target);
    setDragIndex(null);
    setDropIndex(null);
  }

  async function editAudience() {
    const value = await promptText({
      title: 'Who is this book for?',
      body: 'Shown beside the book, on the PDF cover and in the report. Leave it empty for a general audience.',
      initialValue: book.audience ?? '',
      placeholder: 'engineering, leadership, operations…',
      confirmLabel: 'Save',
    });
    if (value !== null) st().setBookAudience(book.id, value);
  }

  async function deletePage(p: BookPage) {
    const ok = await confirmAction({ title: `Delete the page “${p.title || 'Untitled page'}”?`, confirmLabel: 'Delete page', destructive: true });
    if (ok) st().removeBookPage(book.id, p.id);
  }

  async function exportPdf() {
    setExporting(true);
    try { await exportBookAsPdf(book.id); } finally { setExporting(false); }
  }

  return (
    <footer
      role="region"
      aria-label={`Book editor: ${book.name}`}
      className="border-t border-default bg-amber-50/70 dark:bg-amber-950/20 px-4 py-2 flex flex-col gap-2 z-chrome"
    >
      <div className="flex items-center gap-2 text-xs">
        <BookOpen className="w-3.5 h-3.5 text-amber-600 dark:text-amber-300 shrink-0" aria-hidden />
        <span className="font-medium text-amber-800 dark:text-amber-100 truncate">{book.name}</span>
        <button onClick={editAudience} className="text-[11px] text-amber-700/80 dark:text-amber-200/70 hover:underline" title="Change the audience">
          {book.audience ?? 'general audience'}
        </button>
        <div className="flex-1" />
        <button
          onClick={() => st().startPresenting(book.id, page?.id)}
          disabled={book.pages.length === 0}
          className="flex items-center gap-1 px-2 py-1 rounded bg-amber-500 text-white hover:bg-amber-600 disabled:opacity-40"
          title="Present from this page — arrows or a clicker turn pages, Esc stops"
        >
          <Play className="w-3 h-3" /> Present
        </button>
        <button
          onClick={async () => {
            // The console first, in the click that may open a window; then the presentation, in this
            // window, ready to be put on the projector and made full screen with F.
            const opened = await openConsole();
            st().startPresenting(book.id, page?.id);
            st().setToast(opened
              ? { kind: 'info', text: 'Presenter view opened. Put this window on the projector and press F for full screen.' }
              : { kind: 'error', text: 'The presenter view could not open — allow pop-ups for Stemma. Presenting without it.' });
          }}
          disabled={book.pages.length === 0}
          aria-label="Present with the presenter view on another screen"
          title="Present with the presenter view: notes, next page and a timer on your screen, the picture on the projector"
          className="flex items-center gap-1 px-2 py-1 rounded border border-amber-500/60 text-amber-800 dark:text-amber-200 hover:bg-amber-100 dark:hover:bg-amber-900/40 disabled:opacity-40"
        >
          <MonitorSpeaker className="w-3 h-3" /> With notes
        </button>
        <button
          onClick={exportPdf}
          disabled={book.pages.length === 0 || exporting}
          aria-label="Export book as PDF"
          title="Export as PDF — one landscape page per page, as presented"
          className="flex items-center gap-1 px-2 py-1 rounded border border-default text-muted hover:text-body disabled:opacity-40"
        >
          <FileDown className="w-3 h-3" /> {exporting ? 'Exporting…' : 'PDF'}
        </button>
        <button onClick={() => st().openBook(null)} aria-label="Close book" title="Close book" className="p-1 rounded text-muted hover:text-body">
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      <div className="flex items-center gap-1 text-[11px] flex-wrap">
        <ol aria-label="Pages" className="flex flex-wrap items-center gap-1">
          {book.pages.map((p, i) => {
            const broken = pageProblems(p, ctx).length > 0;
            return (
              <li
                key={p.id}
                draggable
                onDragStart={(e) => { setDragIndex(i); e.dataTransfer.effectAllowed = 'move'; }}
                onDragOver={(e) => { e.preventDefault(); setDropIndex(i); }}
                onDragLeave={() => setDropIndex((cur) => (cur === i ? null : cur))}
                onDrop={(e) => { e.preventDefault(); onDrop(i); }}
                onDragEnd={() => { setDragIndex(null); setDropIndex(null); }}
              >
                <button
                  onClick={() => st().showPage(p.id)}
                  onKeyDown={(e) => {
                    // The keyboard's way to reorder: Alt+← and Alt+→ move the page one place.
                    if (!e.altKey || (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight')) return;
                    e.preventDefault();
                    e.stopPropagation();
                    const to = e.key === 'ArrowLeft' ? i - 1 : i + 1;
                    if (to >= 0 && to < book.pages.length) st().moveBookPage(book.id, i, to);
                  }}
                  aria-keyshortcuts="Alt+ArrowLeft Alt+ArrowRight"
                  aria-current={page?.id === p.id ? 'page' : undefined}
                  title={broken ? describeProblems(pageProblems(p, ctx), p) : `${viewName(p.view)}${p.focus.length ? ` · points at ${p.focus.length}` : ''}`}
                  className={clsx(
                    'flex items-center gap-1 px-1.5 py-0.5 rounded border transition-colors max-w-[14rem]',
                    page?.id === p.id
                      ? 'bg-amber-200/60 dark:bg-amber-800/40 border-amber-500/40 text-amber-900 dark:text-amber-100'
                      : 'border-transparent text-amber-700 dark:text-amber-200 hover:bg-amber-100 dark:hover:bg-amber-900/40',
                    dropIndex === i && dragIndex !== i && 'ring-2 ring-indigo-400',
                    dragIndex === i && 'opacity-50',
                  )}
                >
                  <GripVertical className="w-2.5 h-2.5 text-faint shrink-0" aria-hidden />
                  <span className="truncate">{i + 1}. {p.title || 'Untitled page'}</span>
                  {broken && <TriangleAlert className="w-3 h-3 text-amber-600 dark:text-amber-400 shrink-0" aria-label="Broken page" />}
                </button>
              </li>
            );
          })}
        </ol>
        <button
          onClick={() => st().addPageFromCanvas(book.id)}
          disabled={!hereView}
          title={hereView
            ? `Add a page showing ${viewName(hereView)}${selection.length ? `, pointing at the ${selection.length} selected` : ''}`
            : 'Concerns is a summary, not a diagram — open a view to add a page'}
          className="flex items-center gap-1 px-1.5 py-0.5 rounded border border-dashed border-amber-500/50 text-amber-700 dark:text-amber-200 hover:bg-amber-100 dark:hover:bg-amber-900/40 disabled:opacity-40"
        >
          <Plus className="w-3 h-3" /> Add page
        </button>
      </div>

      {book.pages.length === 0 && (
        <p className="text-xs text-amber-800/80 dark:text-amber-200/70">
          This book has no pages yet. Open the view you want to start with — usually the widest one — select what to point
          at, if anything, and add a page. Each next page can zoom closer.
        </p>
      )}

      {page && (
        <div className="grid grid-cols-[minmax(16rem,22rem)_1fr] gap-3 text-xs">
          <div className="flex flex-col gap-1.5">
            <label className="flex flex-col gap-0.5">
              <span className="text-[10px] uppercase tracking-wider text-muted">Page {index + 1} title</span>
              <input
                value={page.title}
                onChange={(e) => st().updateBookPage(book.id, page.id, { title: e.target.value })}
                placeholder="What this page is about"
                className="px-2 py-1 rounded border border-default bg-white/70 dark:bg-zinc-900/60 text-body"
              />
            </label>
            <div className="flex items-center gap-1.5 text-muted">
              <span className="truncate">Shows <span className="text-body">{viewName(page.view)}</span></span>
              {hereView && hereView !== page.view && (
                <button onClick={() => st().updateBookPage(book.id, page.id, { view: hereView })} className="text-indigo-500 hover:underline shrink-0">
                  Use {viewName(hereView)}
                </button>
              )}
            </div>
            <div className="flex items-center gap-1.5 text-muted flex-wrap">
              <Crosshair className="w-3 h-3 shrink-0" aria-hidden />
              <span>{page.focus.length ? `Points at ${page.focus.length}` : 'The whole view'}</span>
              <button
                onClick={() => st().updateBookPage(book.id, page.id, { focus: selection })}
                disabled={selection.length === 0}
                className="text-indigo-500 hover:underline disabled:text-faint disabled:no-underline"
                title="Point at what is selected on the canvas (Ctrl-click or Shift-drag to select several)"
              >
                Point at selection{selection.length ? ` (${selection.length})` : ''}
              </button>
              {page.focus.length > 0 && (
                <button onClick={() => st().updateBookPage(book.id, page.id, { focus: [] })} className="text-indigo-500 hover:underline">Clear</button>
              )}
            </div>
            <div className="flex items-center gap-2" aria-disabled={page.focus.length === 0}>
              <Segmented
                label="Frame"
                disabled={page.focus.length === 0}
                value={page.frame}
                options={[{ value: 'view', label: 'Whole view', icon: <Maximize2 className="w-3 h-3" /> }, { value: 'focus', label: 'Zoom in', icon: <ZoomIn className="w-3 h-3" /> }]}
                onChange={(frame) => st().updateBookPage(book.id, page.id, { frame })}
              />
              <Segmented
                label="The rest"
                disabled={page.focus.length === 0}
                value={page.others}
                options={[{ value: 'dim', label: 'Dim' }, { value: 'hide', label: 'Hide' }]}
                onChange={(others) => st().updateBookPage(book.id, page.id, { others })}
              />
            </div>
            <div className="flex items-center gap-2 pt-0.5">
              <button onClick={() => st().duplicateBookPage(book.id, page.id)} className="flex items-center gap-1 text-muted hover:text-body" title="Copy this page, to make the next step of a zoom">
                <Copy className="w-3 h-3" /> Duplicate
              </button>
              <button onClick={() => deletePage(page)} className="flex items-center gap-1 text-muted hover:text-red-500">
                <Trash2 className="w-3 h-3" /> Delete
              </button>
            </div>
          </div>
          <div className="flex flex-col gap-1 min-w-0">
            {problems.length > 0 && (
              <p className="flex items-start gap-1 text-amber-700 dark:text-amber-300">
                <TriangleAlert className="w-3.5 h-3.5 shrink-0 mt-px" aria-hidden />
                {describeProblems(problems, page)}
              </p>
            )}
            <label className="flex flex-col gap-0.5 flex-1">
              <span className="text-[10px] uppercase tracking-wider text-muted">Narrative</span>
              <textarea
                value={page.narrative}
                onChange={(e) => st().updateBookPage(book.id, page.id, { narrative: e.target.value })}
                placeholder="What you will say while this page is on screen. Markdown: **bold**, `code`, - lists."
                rows={4}
                className="flex-1 min-h-[5.5rem] px-2 py-1 rounded border border-default bg-white/70 dark:bg-zinc-900/60 text-body resize-y"
              />
            </label>
          </div>
        </div>
      )}
    </footer>
  );
}

function Segmented<T extends string>({ label, value, options, onChange, disabled }: {
  label: string;
  value: T;
  options: { value: T; label: string; icon?: React.ReactNode }[];
  onChange: (v: T) => void;
  disabled?: boolean;
}) {
  return (
    <div role="radiogroup" aria-label={label} className={clsx('inline-flex rounded border border-default overflow-hidden', disabled && 'opacity-40')}>
      {options.map((o) => (
        <button
          key={o.value}
          role="radio"
          aria-checked={value === o.value}
          disabled={disabled}
          onClick={() => onChange(o.value)}
          className={clsx(
            'flex items-center gap-1 px-1.5 py-0.5',
            value === o.value ? 'bg-amber-500/20 text-amber-800 dark:text-amber-100' : 'text-muted hover:text-body',
          )}
        >
          {o.icon}{o.label}
        </button>
      ))}
    </div>
  );
}
