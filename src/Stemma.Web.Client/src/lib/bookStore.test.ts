// @vitest-environment happy-dom
// F-013 — the store's books are the sidecar's: read when it is, edited back into it, and walked
// page by page with the canvas following each page to its view.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CustomView } from './types';

vi.mock('./api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./api')>()),
  fetchLayout: vi.fn(),
  patchLayoutSidecar: vi.fn(async () => null),
  listServerViews: vi.fn(async () => []),
}));

const ROOT = '/ws/books-store';

const onDisk = () => ({
  version: 1,
  views: {},
  books: {
    book_sold: {
      name: 'How a Ticket Is Sold',
      order: ['wide', 'money'],
      pages: {
        wide: { title: 'Everything', view: 'moduleMap' },
        money: { title: 'Where the money moves', view: 'view_buy', focus: ['mod_pay'] },
      },
    },
  },
});

const buyView: CustomView = { id: 'view_buy', name: 'Buying a journey', baseView: 'all', elementIds: ['mod_pay'], createdAt: '' };

async function session(disk: unknown = onDisk()) {
  vi.resetModules();
  const api = vi.mocked(await import('./api'));
  vi.clearAllMocks();
  api.patchLayoutSidecar.mockResolvedValue(null);
  api.listServerViews.mockResolvedValue([]);
  api.fetchLayout.mockImplementation(async () => structuredClone(disk));
  const layout = await import('./layout');
  const { useApp } = await import('./store');
  useApp.setState({
    workspace: { rootPath: ROOT, projects: [] }, view: 'moduleMap', activeCustomViewId: null,
    customViews: [buyView], selectedElementId: null, canvasSelectedIds: [], toast: null,
    books: [], activeBookId: null, activePageId: null, presenting: false, capturing: false,
  });
  return { api, layout, useApp };
}

beforeEach(() => { localStorage.clear(); vi.useFakeTimers(); });
afterEach(() => vi.useRealTimers());

describe('books in the store', () => {
  it('has none until the sidecar is read, then exactly the sidecar’s', async () => {
    const { layout, useApp } = await session();
    useApp.getState().reloadBooks();
    expect(useApp.getState().books).toEqual([]);
    await layout.primeLayoutSidecar(ROOT);
    useApp.getState().reloadBooks();
    expect(useApp.getState().books.map((b) => b.id)).toEqual(['book_sold']);
  });

  it('refuses an edit out loud before then', async () => {
    const { useApp } = await session();
    expect(useApp.getState().createBook('Onboarding')).toBeNull();
    expect(useApp.getState().toast?.kind).toBe('error');
  });

  it('adds a page of what the canvas shows, pointing at what is selected, after the page on screen', async () => {
    const { api, layout, useApp } = await session();
    await layout.primeLayoutSidecar(ROOT);
    useApp.getState().reloadBooks();
    useApp.getState().openBook('book_sold');
    expect(useApp.getState().activePageId).toBe('wide');

    useApp.setState({ view: 'dependencyGraph', activeCustomViewId: null, canvasSelectedIds: ['mod_a', 'mod_b'] });
    const id = useApp.getState().addPageFromCanvas('book_sold')!;
    const book = useApp.getState().books[0];
    expect(book.pages.map((p) => p.id)).toEqual(['wide', id, 'money']);
    expect(book.pages[1]).toMatchObject({ view: 'dependencyGraph', title: 'Dependencies', focus: ['mod_a', 'mod_b'], frame: 'focus' });
    expect(useApp.getState().activePageId).toBe(id);

    await vi.advanceTimersByTimeAsync(1000);
    const sent = api.patchLayoutSidecar.mock.calls.flatMap((c) => c[0]);
    expect(sent.map((c) => c.path.join('.'))).toEqual(['books.book_sold.order', `books.book_sold.pages.${id}`]);
  });

  it('takes the single clicked element as the focus when nothing is multi-selected', async () => {
    const { layout, useApp } = await session();
    await layout.primeLayoutSidecar(ROOT);
    useApp.getState().reloadBooks();
    useApp.setState({ selectedElementId: 'mod_x', canvasSelectedIds: [] });
    const id = useApp.getState().addPageFromCanvas('book_sold')!;
    expect(useApp.getState().books[0].pages.find((p) => p.id === id)?.focus).toEqual(['mod_x']);
  });

  it('has no page to add on Concerns, which is not a diagram', async () => {
    const { layout, useApp } = await session();
    await layout.primeLayoutSidecar(ROOT);
    useApp.getState().reloadBooks();
    useApp.setState({ view: 'concerns' });
    expect(useApp.getState().addPageFromCanvas('book_sold')).toBeNull();
  });

  it('puts each page’s view on the canvas: a built-in, or a view from Views/', async () => {
    const { layout, useApp } = await session();
    await layout.primeLayoutSidecar(ROOT);
    useApp.getState().reloadBooks();
    useApp.setState({ view: 'concerns' });
    useApp.getState().openBook('book_sold');
    expect(useApp.getState()).toMatchObject({ view: 'moduleMap', activeCustomViewId: null });

    useApp.getState().stepPage(1);
    expect(useApp.getState()).toMatchObject({ activePageId: 'money', activeCustomViewId: 'view_buy' });
    useApp.getState().stepPage(1);
    expect(useApp.getState().activePageId).toBe('money');
    useApp.getState().edgePage('first');
    expect(useApp.getState()).toMatchObject({ activePageId: 'wide', view: 'moduleMap', activeCustomViewId: null });
  });

  it('plays a page\'s steps before turning it, and comes back into the page before at its end (F-020)', async () => {
    const disk = onDisk();
    (disk.books.book_sold.pages.wide as Record<string, unknown>).steps = ['df_1', { link: 'df_2', note: 'Then it pays' }];
    const { layout, useApp } = await session(disk);
    await layout.primeLayoutSidecar(ROOT);
    useApp.getState().reloadBooks();
    useApp.getState().openBook('book_sold');
    expect(useApp.getState()).toMatchObject({ activePageId: 'wide', activeStep: 0 });

    useApp.getState().advance(1);
    expect(useApp.getState()).toMatchObject({ activePageId: 'wide', activeStep: 1 });
    useApp.getState().advance(1);
    expect(useApp.getState()).toMatchObject({ activePageId: 'wide', activeStep: 2 });
    useApp.getState().advance(1);
    expect(useApp.getState()).toMatchObject({ activePageId: 'money', activeStep: 0 });

    // Back arrives where the page ended, every step lit, and unwinds them one at a time.
    useApp.getState().advance(-1);
    expect(useApp.getState()).toMatchObject({ activePageId: 'wide', activeStep: 2 });
    useApp.getState().advance(-1);
    expect(useApp.getState().activeStep).toBe(1);
  });

  it('records a clicked relationship as the next step of the page on screen', async () => {
    const { layout, useApp } = await session();
    await layout.primeLayoutSidecar(ROOT);
    useApp.getState().reloadBooks();
    useApp.getState().openBook('book_sold');
    expect(useApp.getState().addStep('df_1')).toBe(true);
    expect(useApp.getState().addStep('df_1')).toBe(false); // the same arrow twice in a row is a double click
    expect(useApp.getState().addStep('df_2')).toBe(true);
    const page = useApp.getState().books[0].pages.find((p) => p.id === 'wide')!;
    expect(page.steps.map((st) => st.link)).toEqual(['df_1', 'df_2']);
    expect(useApp.getState().activeStep).toBe(2);
    await vi.waitFor(() => expect(layout.loadBooksSection(ROOT)).toMatchObject({ book_sold: { pages: { wide: { steps: ['df_1', 'df_2'] } } } }));
  });

  it('leaves the canvas alone on a page whose view is gone', async () => {
    const { layout, useApp } = await session();
    await layout.primeLayoutSidecar(ROOT);
    useApp.setState({ customViews: [] });
    useApp.getState().reloadBooks();
    useApp.getState().openBook('book_sold');
    useApp.getState().stepPage(1);
    expect(useApp.getState()).toMatchObject({ activePageId: 'money', view: 'moduleMap', activeCustomViewId: null });
  });

  it('falls back to the first page when a pull takes away the one on screen', async () => {
    const { layout, useApp } = await session();
    await layout.primeLayoutSidecar(ROOT);
    useApp.getState().reloadBooks();
    useApp.getState().startPresenting('book_sold', 'money');
    expect(useApp.getState()).toMatchObject({ presenting: true, activePageId: 'money' });

    const pulled = onDisk();
    delete (pulled.books.book_sold.pages as Record<string, unknown>).money;
    pulled.books.book_sold.order = ['wide'];
    vi.mocked((await import('./api')).fetchLayout).mockImplementation(async () => structuredClone(pulled));
    await layout.rereadLayoutSidecar(ROOT);
    useApp.getState().reloadBooks();
    expect(useApp.getState()).toMatchObject({ presenting: true, activePageId: 'wide', view: 'moduleMap', activeCustomViewId: null });
  });

  it('stops presenting when the book is taken away', async () => {
    const { layout, useApp } = await session();
    await layout.primeLayoutSidecar(ROOT);
    useApp.getState().reloadBooks();
    useApp.getState().startPresenting('book_sold');
    vi.mocked((await import('./api')).fetchLayout).mockImplementation(async () => ({ version: 1, views: {}, books: {} }));
    await layout.rereadLayoutSidecar(ROOT);
    useApp.getState().reloadBooks();
    expect(useApp.getState()).toMatchObject({ presenting: false, activeBookId: null, activePageId: null });
  });

  it('will not present a book with no pages', async () => {
    const { layout, useApp } = await session({ version: 1, books: { b: { name: 'Empty', pages: {} } } });
    await layout.primeLayoutSidecar(ROOT);
    useApp.getState().reloadBooks();
    useApp.getState().startPresenting('b');
    expect(useApp.getState().presenting).toBe(false);
  });

  it('removing the page on screen moves to the page after it, not back to the first', async () => {
    const disk = onDisk();
    (disk.books.book_sold.pages as Record<string, unknown>).close = { title: 'Close up', view: 'moduleMap' };
    disk.books.book_sold.order = ['wide', 'money', 'close'];
    const { layout, useApp } = await session(disk);
    await layout.primeLayoutSidecar(ROOT);
    useApp.getState().reloadBooks();
    useApp.getState().openBook('book_sold');
    useApp.getState().showPage('money');
    useApp.getState().removeBookPage('book_sold', 'money');
    expect(useApp.getState().activePageId).toBe('close');
    expect(useApp.getState().books[0].pages.map((p) => p.id)).toEqual(['wide', 'close']);
    useApp.getState().removeBookPage('book_sold', 'close');
    expect(useApp.getState().activePageId).toBe('wide');
  });

  it('reorders by the pages a person sees', async () => {
    const { layout, useApp } = await session();
    await layout.primeLayoutSidecar(ROOT);
    useApp.getState().reloadBooks();
    useApp.getState().moveBookPage('book_sold', 1, 0);
    expect(useApp.getState().books[0].pages.map((p) => p.id)).toEqual(['money', 'wide']);
  });
});
