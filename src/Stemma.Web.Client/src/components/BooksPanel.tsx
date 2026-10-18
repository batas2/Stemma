import { useMemo } from 'react';
import { Pencil, Play, Plus, Trash2, TriangleAlert } from 'lucide-react';
import clsx from 'clsx';
import { useApp, pageViewIds } from '@/lib/store';
import { pageProblems, type Book } from '@/lib/books';
import { promptText } from './PromptDialog';
import { confirmAction } from './ConfirmDialog';

/**
 * The books in this workspace (F-013), in the Views & Books panel. A book is a walk through the
 * model for one audience; opening one puts its editor under the canvas, and ▶ presents it. The list
 * is read from `stemma.layout.json`, so a book a teammate pushed is here after the pull.
 */
export function BooksPanel() {
  const books = useApp((s) => s.books);
  const activeBookId = useApp((s) => s.activeBookId);
  const arch = useApp((s) => s.arch);
  const customViews = useApp((s) => s.customViews);
  const openBook = useApp((s) => s.openBook);
  const createBook = useApp((s) => s.createBook);
  const renameBook = useApp((s) => s.renameBook);
  const deleteBook = useApp((s) => s.deleteBook);
  const startPresenting = useApp((s) => s.startPresenting);

  const brokenByBook = useMemo(() => {
    const ctx = { views: pageViewIds({ customViews }), elements: new Set(arch?.elements.map((e) => e.id) ?? []) };
    return new Map(books.map((b) => [b.id, b.pages.filter((p) => pageProblems(p, ctx).length > 0).length]));
  }, [books, customViews, arch]);

  async function newBook() {
    const name = await promptText({
      title: 'New book',
      body: 'A walk through the model for one audience: each page shows a view, points at what matters, and holds what you will say.',
      placeholder: 'How a ticket is sold',
      confirmLabel: 'Create',
      validate: (v) => (v.trim() ? null : 'Give the book a name.'),
    });
    if (name) createBook(name.trim());
  }

  async function rename(book: Book) {
    const name = await promptText({
      title: 'Rename book',
      initialValue: book.name,
      confirmLabel: 'Rename',
      validate: (v) => (v.trim() ? null : 'A book needs a name.'),
    });
    if (name && name.trim() !== book.name) renameBook(book.id, name.trim());
  }

  async function remove(book: Book) {
    const ok = await confirmAction({
      title: `Delete “${book.name}”?`,
      body: `Its ${book.pages.length} page${book.pages.length === 1 ? '' : 's'} and narratives are removed from stemma.layout.json. The model and its views are not touched, and Git still has it.`,
      confirmLabel: 'Delete book',
      destructive: true,
    });
    if (ok) deleteBook(book.id);
  }

  return (
    <div className="space-y-1">
      {books.length === 0 && (
        <p className="text-xs text-zinc-500 px-1">
          No books yet. A book walks an audience through the model, from the context down to the detail.{' '}
          <button onClick={newBook} className="text-indigo-500 hover:underline">Create one</button>.
        </p>
      )}
      <ul className="space-y-0.5" aria-label="Books">
        {books.map((b) => {
          const active = b.id === activeBookId;
          const broken = brokenByBook.get(b.id) ?? 0;
          return (
            <li key={b.id} className="group relative">
              <button
                onClick={() => openBook(active ? null : b.id)}
                aria-pressed={active}
                className={clsx(
                  'w-full text-left pl-2 pr-20 py-1 rounded text-xs transition-colors',
                  active
                    ? 'bg-amber-500/15 text-amber-700 dark:text-amber-200'
                    : 'hover:bg-zinc-200/60 dark:hover:bg-zinc-800/60 text-zinc-700 dark:text-zinc-300',
                )}
              >
                <div className="font-medium truncate">{b.name}</div>
                <div className="text-[10px] text-zinc-500 truncate flex items-center gap-1">
                  {b.audience ?? 'general'} · {b.pages.length} page{b.pages.length === 1 ? '' : 's'}
                  {broken > 0 && (
                    <span className="inline-flex items-center gap-0.5 text-amber-600 dark:text-amber-400" title={`${broken} page${broken === 1 ? '' : 's'} point at something no longer in the model`}>
                      · <TriangleAlert className="w-2.5 h-2.5" aria-hidden />{broken}
                    </span>
                  )}
                </div>
              </button>
              <div className="absolute right-1 top-1/2 -translate-y-1/2 flex items-center gap-0.5">
                <button onClick={() => rename(b)} aria-label={`Rename ${b.name}`} title="Rename" className="p-1 rounded text-faint hover:text-body opacity-0 group-hover:opacity-100 focus:opacity-100">
                  <Pencil className="w-3 h-3" />
                </button>
                <button onClick={() => remove(b)} aria-label={`Delete ${b.name}`} title="Delete" className="p-1 rounded text-faint hover:text-red-500 opacity-0 group-hover:opacity-100 focus:opacity-100">
                  <Trash2 className="w-3 h-3" />
                </button>
                <button
                  onClick={() => startPresenting(b.id)}
                  disabled={b.pages.length === 0}
                  aria-label={`Present ${b.name}`}
                  title={b.pages.length === 0 ? 'Add a page to present this book' : 'Present'}
                  className="p-1 rounded text-amber-600 dark:text-amber-300 hover:bg-amber-500/20 disabled:opacity-30"
                >
                  <Play className="w-3 h-3" />
                </button>
              </div>
            </li>
          );
        })}
      </ul>
      <button
        onClick={newBook}
        className="w-full flex items-center justify-center gap-1.5 text-xs px-2 py-1.5 rounded bg-amber-500/10 hover:bg-amber-500/20 border border-amber-500/30 text-amber-700 dark:text-amber-300"
      >
        <Plus className="w-3 h-3" /> New book
      </button>
    </div>
  );
}
