import { useState } from 'react';
import { ChevronLeft, ChevronRight, FileDown, GripVertical } from 'lucide-react';
import clsx from 'clsx';
import { useApp } from '@/lib/store';
import { exportBookPdf } from '@/lib/api';

/**
 * Epic 08 Track A — narrative strip + prev/next page controls.
 * Renders only when a book is active. Inline edit on the narrative is allowed in
 * book authoring mode (the textarea writes through `setBookPageNarrative`).
 */
export function BookFooter() {
  const books = useApp((s) => s.books);
  const activeBookId = useApp((s) => s.activeBookId);
  const pageIndex = useApp((s) => s.activeBookPageIndex);
  const next = useApp((s) => s.nextBookPage);
  const prev = useApp((s) => s.prevBookPage);
  const setNarrative = useApp((s) => s.setBookPageNarrative);
  const reorderPages = useApp((s) => s.reorderBookPages);
  const setActiveBookPageIndex = useApp((s) => s.setActiveBookPageIndex);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dropIndex, setDropIndex] = useState<number | null>(null);

  if (!activeBookId) return null;
  const book = books.find((b) => b.id === activeBookId);
  if (!book) return null;

  function onPageDrop(targetIndex: number) {
    if (dragIndex === null || !book) return;
    if (dragIndex === targetIndex) { setDragIndex(null); setDropIndex(null); return; }
    const order = book.pages.map((_, i) => i);
    const [moved] = order.splice(dragIndex, 1);
    order.splice(targetIndex, 0, moved);
    reorderPages(book.id, order);
    // Keep the active page sticky: if the user was on the page being moved, follow it.
    if (pageIndex === dragIndex) setActiveBookPageIndex(targetIndex);
    else {
      const after = order.indexOf(pageIndex);
      if (after >= 0) setActiveBookPageIndex(after);
    }
    setDragIndex(null);
    setDropIndex(null);
  }
  if (book.pages.length === 0) {
    return (
      <footer className="border-t border-default bg-amber-50 dark:bg-amber-950/30 px-4 py-2 text-xs text-amber-700 dark:text-amber-200">
        <span className="font-medium">{book.name}</span> · this book has no pages yet.
      </footer>
    );
  }
  const page = book.pages[pageIndex];
  const atFirst = pageIndex === 0;
  const atLast = pageIndex === book.pages.length - 1;

  return (
    <footer
      role="region"
      aria-label={`Book ${book.name} — page ${pageIndex + 1} of ${book.pages.length}`}
      className="border-t border-default bg-amber-50/70 dark:bg-amber-950/20 px-4 py-2 flex flex-col gap-1.5 z-chrome"
    >
      <ol
        role="list"
        aria-label="Book pages"
        className="flex flex-wrap items-center gap-1 text-[11px]"
      >
        <li className="text-amber-700 dark:text-amber-200 font-medium pr-1.5">{book.name}</li>
        {book.pages.map((p, i) => (
          <li
            key={`${i}-${p.title}`}
            draggable
            onDragStart={(e) => { setDragIndex(i); e.dataTransfer.effectAllowed = 'move'; }}
            onDragOver={(e) => { e.preventDefault(); setDropIndex(i); }}
            onDragLeave={() => setDropIndex((cur) => (cur === i ? null : cur))}
            onDrop={(e) => { e.preventDefault(); onPageDrop(i); }}
            onDragEnd={() => { setDragIndex(null); setDropIndex(null); }}
          >
            <button
              onClick={() => setActiveBookPageIndex(i)}
              aria-current={i === pageIndex ? 'page' : undefined}
              className={clsx(
                'flex items-center gap-1 px-1.5 py-0.5 rounded border transition-colors',
                i === pageIndex
                  ? 'bg-amber-200/60 dark:bg-amber-800/40 border-amber-500/40 text-amber-900 dark:text-amber-100'
                  : 'border-transparent text-amber-700 dark:text-amber-200 hover:bg-amber-100 dark:hover:bg-amber-900/40',
                dropIndex === i && dragIndex !== i && 'ring-2 ring-indigo-400',
                dragIndex === i && 'opacity-50',
              )}
            >
              <GripVertical className="w-2.5 h-2.5 text-faint shrink-0" />
              {i + 1}. {p.title}
            </button>
          </li>
        ))}
      </ol>
      <div className="flex items-center gap-3">
      <div className="text-[11px] text-amber-700 dark:text-amber-200 font-medium shrink-0">
        {pageIndex + 1}/{book.pages.length}
      </div>
      <div className="text-xs font-medium shrink-0">{page.title}</div>
      <textarea
        value={page.narrative}
        onChange={(e) => setNarrative(book.id, pageIndex, e.target.value)}
        placeholder="Write the page narrative…"
        rows={1}
        aria-label="Page narrative"
        className="flex-1 bg-transparent text-xs text-body placeholder:text-faint resize-none outline-none border-0 focus:bg-white/50 dark:focus:bg-zinc-900/50 px-2 py-1 rounded"
      />
      <div className="flex items-center gap-0.5 shrink-0">
        <button
          onClick={async () => {
            const blob = await exportBookPdf({
              name: book.name,
              audience: book.audience,
              pages: book.pages.map((p) => ({ viewId: String(p.viewId), title: p.title, narrative: p.narrative })),
            });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url; a.download = `${book.name || 'book'}.pdf`; a.click();
            URL.revokeObjectURL(url);
          }}
          aria-label="Export book as PDF"
          title="Export book as PDF"
          className="p-1 rounded hover:bg-amber-100 dark:hover:bg-amber-900/40"
        >
          <FileDown className="w-3.5 h-3.5" />
        </button>
        <button
          onClick={prev}
          disabled={atFirst}
          aria-label="Previous page"
          className="p-1 rounded hover:bg-amber-100 dark:hover:bg-amber-900/40 disabled:opacity-30 disabled:cursor-not-allowed"
        >
          <ChevronLeft className="w-3.5 h-3.5" />
        </button>
        <button
          onClick={next}
          disabled={atLast}
          aria-label="Next page"
          className="p-1 rounded hover:bg-amber-100 dark:hover:bg-amber-900/40 disabled:opacity-30 disabled:cursor-not-allowed"
        >
          <ChevronRight className="w-3.5 h-3.5" />
        </button>
      </div>
      </div>
    </footer>
  );
}

