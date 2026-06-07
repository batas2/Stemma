import { Plus, X } from 'lucide-react';
import clsx from 'clsx';
import { useApp } from '@/lib/store';
import type { Book } from '@/lib/types';

/**
 * Epic 13 Track 3 — Books live in the unified Views & Books panel (the standalone topbar
 * popover is gone). A book is a narrated, ordered sequence of pages; selecting one enters
 * Present/book mode (the BookFooter then drives page navigation). Filtered by the workspace
 * audience switch. New books inherit the current audience so the filter stays coherent.
 */
export function BooksPanel() {
  const books = useApp((s) => s.books);
  const activeBookId = useApp((s) => s.activeBookId);
  const setActiveBook = useApp((s) => s.setActiveBook);
  const addBook = useApp((s) => s.addBook);

  function newBook() {
    const id = 'book_' + Math.random().toString(36).slice(2, 8);
    const fresh: Book = { id, name: 'Untitled book', audience: null, pages: [] };
    addBook(fresh);
    setActiveBook(id);
  }

  return (
    <div className="space-y-1">
      {books.length === 0 && (
        <p className="text-xs text-zinc-500 px-1">
          No books yet. <button onClick={newBook} className="text-indigo-500 hover:underline">Create one</button>.
        </p>
      )}
      <ul className="space-y-0.5">
        {books.map((b) => {
          const active = b.id === activeBookId;
          return (
            <li key={b.id}>
              <button
                onClick={() => setActiveBook(active ? null : b.id)}
                aria-pressed={active}
                className={clsx(
                  'w-full text-left px-2 py-1 rounded text-xs transition-colors',
                  active
                    ? 'bg-amber-500/15 text-amber-700 dark:text-amber-200'
                    : 'hover:bg-zinc-200/60 dark:hover:bg-zinc-800/60 text-zinc-700 dark:text-zinc-300',
                )}
              >
                <div className="font-medium truncate">{b.name}</div>
                <div className="text-[10px] text-zinc-500 truncate">
                  {b.audience ?? 'general'} · {b.pages.length} page{b.pages.length === 1 ? '' : 's'}
                  {active && ' · presenting'}
                </div>
              </button>
            </li>
          );
        })}
      </ul>
      <div className="flex items-center gap-1 pt-1">
        <button
          onClick={newBook}
          className="flex-1 flex items-center justify-center gap-1.5 text-xs px-2 py-1.5 rounded bg-amber-500/10 hover:bg-amber-500/20 border border-amber-500/30 text-amber-700 dark:text-amber-300"
        >
          <Plus className="w-3 h-3" /> New book
        </button>
        {activeBookId && (
          <button
            onClick={() => setActiveBook(null)}
            title="Exit book mode"
            className="flex items-center gap-1 text-xs px-2 py-1.5 rounded border border-default text-muted hover:text-body"
          >
            <X className="w-3 h-3" /> Exit
          </button>
        )}
      </div>
    </div>
  );
}
