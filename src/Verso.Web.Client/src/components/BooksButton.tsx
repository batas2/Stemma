import { useMemo, useState } from 'react';
import { Book as BookIcon, ChevronDown, Plus, X } from 'lucide-react';
import clsx from 'clsx';
import { useApp } from '@/lib/store';
import type { Book } from '@/lib/types';

/**
 * Epic 08 Track A — entry point into Book mode. Lists known books in a popover;
 * picking one sets `activeBookId` and the App switches into book mode (the canvas
 * follows the active page's viewId and the BookFooter strip controls page nav).
 */
export function BooksButton() {
  const [open, setOpen] = useState(false);
  const books = useApp((s) => s.books);
  const activeBookId = useApp((s) => s.activeBookId);
  const setActiveBook = useApp((s) => s.setActiveBook);
  const addBook = useApp((s) => s.addBook);
  const audienceFilter = useApp((s) => s.booksAudienceFilter);
  const setAudienceFilter = useApp((s) => s.setBooksAudienceFilter);

  const audiences = useMemo(() => {
    const set = new Set<string>();
    for (const b of books) if (b.audience) set.add(b.audience);
    return [...set].sort();
  }, [books]);

  const filteredBooks = useMemo(() => {
    if (!audienceFilter) return books;
    return books.filter((b) => (b.audience ?? '') === audienceFilter);
  }, [books, audienceFilter]);

  function newBook() {
    const id = 'book_' + Math.random().toString(36).slice(2, 8);
    const fresh: Book = { id, name: 'Untitled book', audience: null, pages: [] };
    addBook(fresh);
    setActiveBook(id);
    setOpen(false);
  }

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Open books menu"
        title="View Books — narrated walk-throughs"
        className={clsx(
          'flex items-center gap-1.5 px-2.5 py-1 rounded text-xs transition-colors border',
          activeBookId
            ? 'bg-amber-500/15 text-amber-700 dark:text-amber-200 border-amber-500/40'
            : 'bg-zinc-100 dark:bg-zinc-900 text-muted hover:text-body border-default'
        )}
      >
        <BookIcon className="w-3 h-3" />
        Books
        <ChevronDown className="w-3 h-3" />
      </button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full mt-1 w-72 max-h-96 overflow-auto rounded surface-overlay z-popover"
          onMouseLeave={() => setOpen(false)}
        >
          {books.length === 0 && (
            <div className="px-3 py-3 text-xs text-zinc-500">
              No books yet. <button onClick={newBook} className="text-indigo-500 hover:underline">Create one</button>.
            </div>
          )}
          {audiences.length > 0 && (
            <div
              role="group"
              aria-label="Filter by audience"
              className="flex flex-wrap gap-1 px-2 py-1.5 border-b border-zinc-200 dark:border-zinc-800"
            >
              <button
                onClick={() => setAudienceFilter(null)}
                aria-pressed={audienceFilter === null}
                className={clsx(
                  'text-[10px] px-1.5 py-0.5 rounded',
                  audienceFilter === null
                    ? 'bg-indigo-500/15 text-indigo-700 dark:text-indigo-300'
                    : 'text-faint hover:bg-zinc-100 dark:hover:bg-zinc-800/60',
                )}
              >
                all
              </button>
              {audiences.map((a) => (
                <button
                  key={a}
                  onClick={() => setAudienceFilter(audienceFilter === a ? null : a)}
                  aria-pressed={audienceFilter === a}
                  className={clsx(
                    'text-[10px] px-1.5 py-0.5 rounded',
                    audienceFilter === a
                      ? 'bg-indigo-500/15 text-indigo-700 dark:text-indigo-300'
                      : 'text-faint hover:bg-zinc-100 dark:hover:bg-zinc-800/60',
                  )}
                >
                  {a}
                </button>
              ))}
            </div>
          )}
          {filteredBooks.length === 0 && books.length > 0 && (
            <div className="px-3 py-3 text-xs text-faint">No books for audience "{audienceFilter}".</div>
          )}
          {filteredBooks.map((b) => (
            <div key={b.id} className="flex items-center border-b border-zinc-100 dark:border-zinc-800 last:border-b-0">
              <button
                onClick={() => { setActiveBook(b.id); setOpen(false); }}
                className={clsx(
                  'flex-1 text-left px-3 py-2 text-xs hover:bg-zinc-100 dark:hover:bg-zinc-800/60',
                  b.id === activeBookId && 'bg-amber-500/10'
                )}
              >
                <div className="font-medium truncate">{b.name}</div>
                <div className="text-[10px] text-zinc-500 truncate">
                  {b.audience ?? 'general'} · {b.pages.length} page{b.pages.length === 1 ? '' : 's'}
                </div>
              </button>
            </div>
          ))}
          <button
            onClick={newBook}
            className="w-full text-left px-3 py-2 text-xs hover:bg-zinc-100 dark:hover:bg-zinc-800/60 border-t border-zinc-200 dark:border-zinc-800 flex items-center gap-2"
          >
            <Plus className="w-3 h-3" /> New book
          </button>
          {activeBookId && (
            <button
              onClick={() => { useApp.getState().setActiveBook(null); setOpen(false); }}
              className="w-full text-left px-3 py-2 text-xs hover:bg-zinc-100 dark:hover:bg-zinc-800/60 border-t border-zinc-100 dark:border-zinc-800 flex items-center gap-2 text-muted"
            >
              <X className="w-3 h-3" /> Exit book mode
            </button>
          )}
        </div>
      )}
    </div>
  );
}
