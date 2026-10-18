// @vitest-environment happy-dom
// F-013 / ADR-0022. Books are read from the `books` section of the sidecar whatever shape a hand
// edit left it in, and every edit changes the smallest value it is about — so the diff of a
// narrative edit is that narrative, and a reorder is the `order` line.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  addBook, addPage, describeProblems, duplicatePage, movePage, newBookId, newPageId, pageProblems,
  readBooks, reflowNarrative, removeBook, removePage, renameBook, resolveFrame, setBookAudience, updatePage, viewKeyOf,
  type BooksSection,
} from './books';
import { sidecarChanges } from './layout';

vi.mock('./api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./api')>()),
  fetchLayout: vi.fn(),
  patchLayoutSidecar: vi.fn(async () => null),
}));

const section = (): BooksSection => ({
  book_sold: {
    name: 'How a Ticket Is Sold',
    audience: 'engineering',
    order: ['path', 'money'],
    pages: {
      money: { title: 'Where the money moves', view: 'view_buy', narrative: 'Only Payment talks to the gateway.', focus: ['mod_pay', 'ext_psp'] },
      path: { title: 'The path a purchase takes', view: 'view_buy', narrative: 'Follow the arrows.' },
    },
  },
});

/** The changes an edit to the section produces, as the writer would send them. */
function changesOf(edit: (s: BooksSection) => void) {
  const before = { books: section() };
  const after = { books: section() };
  edit(after.books);
  return sidecarChanges(before, after);
}

describe('reading a book', () => {
  it('shows pages in their order, with what each one points at', () => {
    const [book] = readBooks(section());
    expect(book).toMatchObject({ id: 'book_sold', name: 'How a Ticket Is Sold', audience: 'engineering' });
    expect(book.pages.map((p) => p.id)).toEqual(['path', 'money']);
    expect(book.pages[0]).toEqual({
      id: 'path', title: 'The path a purchase takes', view: 'view_buy', narrative: 'Follow the arrows.',
      focus: [], frame: 'view', others: 'dim',
    });
    expect(book.pages[1]).toMatchObject({ focus: ['mod_pay', 'ext_psp'], frame: 'focus', others: 'dim' });
  });

  it('presents a hand-written book that has no order, or an order a merge left behind', () => {
    const noOrder = section();
    delete (noOrder.book_sold as Record<string, unknown>).order;
    expect(readBooks(noOrder)[0].pages.map((p) => p.id)).toEqual(['money', 'path']);

    const stale = section();
    (stale.book_sold as Record<string, unknown>).order = ['gone', 'money', 'money'];
    expect(readBooks(stale)[0].pages.map((p) => p.id)).toEqual(['money', 'path']);
  });

  it('makes the best of fields that are the wrong type, and skips a page that is not an object', () => {
    const odd = {
      b: { name: 42, pages: { p1: { title: 7, view: 'moduleMap', focus: ['a', 3], frame: 'sideways', others: 'hide' }, p2: 'not a page' } },
      notABook: [1, 2],
    };
    const books = readBooks(odd);
    expect(books).toHaveLength(1);
    expect(books[0].name).toBe('b');
    expect(books[0].audience).toBeNull();
    expect(books[0].pages).toEqual([{ id: 'p1', title: '', view: 'moduleMap', narrative: '', focus: ['a'], frame: 'focus', others: 'hide' }]);
  });

  it('reads nothing from a section that is not an object', () => {
    expect(readBooks(undefined)).toEqual([]);
    expect(readBooks([])).toEqual([]);
  });

  it('frames the whole view when there is nothing to point at, whatever the page says', () => {
    expect(resolveFrame([], 'focus')).toBe('view');
    expect(resolveFrame(['a'], undefined)).toBe('focus');
    expect(resolveFrame(['a'], 'view')).toBe('view');
  });
});

describe('an edit is the smallest change', () => {
  it('a narrative is one value', () => {
    expect(changesOf((s) => updatePage(s, 'book_sold', 'path', { narrative: 'Left to right.' }))).toEqual([
      { path: ['books', 'book_sold', 'pages', 'path', 'narrative'], value: 'Left to right.' },
    ]);
  });

  it('a reorder is the order and nothing else', () => {
    expect(changesOf((s) => movePage(s, 'book_sold', 'money', 'path'))).toEqual([
      { path: ['books', 'book_sold', 'order'], value: ['money', 'path'] },
    ]);
  });

  it('a new page is that page and its place in the order', () => {
    expect(changesOf((s) => addPage(s, 'book_sold', { id: 'p_new', title: 'Issuing', view: 'view_buy', focus: ['mod_issue'] }))).toEqual([
      { path: ['books', 'book_sold', 'order'], value: ['path', 'money', 'p_new'] },
      { path: ['books', 'book_sold', 'pages', 'p_new'], value: { title: 'Issuing', view: 'view_buy', focus: ['mod_issue'] } },
    ]);
  });

  it('a rename is the name', () => {
    expect(changesOf((s) => renameBook(s, 'book_sold', 'Selling a ticket'))).toEqual([
      { path: ['books', 'book_sold', 'name'], value: 'Selling a ticket' },
    ]);
  });

  it('a default is removed rather than written', () => {
    expect(changesOf((s) => updatePage(s, 'book_sold', 'money', { focus: [] }))).toEqual([
      { path: ['books', 'book_sold', 'pages', 'money', 'focus'], remove: true },
    ]);
    expect(changesOf((s) => updatePage(s, 'book_sold', 'money', { frame: 'focus' }))).toEqual([]);
    expect(changesOf((s) => updatePage(s, 'book_sold', 'money', { frame: 'view' }))).toEqual([
      { path: ['books', 'book_sold', 'pages', 'money', 'frame'], value: 'view' },
    ]);
    expect(changesOf((s) => updatePage(s, 'book_sold', 'path', { others: 'dim', narrative: '' }))).toEqual([
      { path: ['books', 'book_sold', 'pages', 'path', 'narrative'], remove: true },
    ]);
  });

  it('a narrative edit leaves a default somebody spelled out alone', () => {
    const before = { books: section() };
    ((before.books.book_sold as { pages: Record<string, Record<string, unknown>> }).pages.money).frame = 'focus';
    const after = structuredClone(before);
    updatePage(after.books, 'book_sold', 'money', { narrative: 'Synchronously.' });
    expect(sidecarChanges(before, after)).toEqual([
      { path: ['books', 'book_sold', 'pages', 'money', 'narrative'], value: 'Synchronously.' },
    ]);
  });

  it('clearing the focus drops a frame that no longer means anything', () => {
    const before = { books: section() };
    ((before.books.book_sold as { pages: Record<string, Record<string, unknown>> }).pages.money).frame = 'view';
    const after = structuredClone(before);
    updatePage(after.books, 'book_sold', 'money', { focus: [] });
    expect(sidecarChanges(before, after)).toEqual([
      { path: ['books', 'book_sold', 'pages', 'money', 'focus'], remove: true },
      { path: ['books', 'book_sold', 'pages', 'money', 'frame'], remove: true },
    ]);
  });

  it('removing a page takes it out of the order too', () => {
    expect(changesOf((s) => removePage(s, 'book_sold', 'path'))).toEqual([
      { path: ['books', 'book_sold', 'order'], value: ['money'] },
      { path: ['books', 'book_sold', 'pages', 'path'], remove: true },
    ]);
  });

  it('places by page id, so a page a hand edit broke cannot shift what a position means', () => {
    const s = section();
    const pages = (s.book_sold as { pages: Record<string, unknown> }).pages;
    pages.broken = 'not a page';
    (s.book_sold as { order: string[] }).order = ['path', 'broken', 'money'];
    movePage(s, 'book_sold', 'money', 'path');
    expect((s.book_sold as { order: string[] }).order).toEqual(['money', 'path', 'broken']);
    addPage(s, 'book_sold', { id: 'p_new', title: 'N', view: 'moduleMap' }, 'money');
    expect(readBooks(s)[0].pages.map((p) => p.id)).toEqual(['money', 'p_new', 'path']);
  });

  it('a duplicate lands right after its original', () => {
    const s = section();
    duplicatePage(s, 'book_sold', 'path', 'p_copy');
    expect(readBooks(s)[0].pages.map((p) => p.id)).toEqual(['path', 'p_copy', 'money']);
    expect(readBooks(s)[0].pages[1].title).toBe('The path a purchase takes');
  });

  it('a book is added, given an audience, and removed as one member', () => {
    const s: BooksSection = {};
    addBook(s, 'book_x', 'Onboarding');
    setBookAudience(s, 'book_x', '  new joiners ');
    expect(s.book_x).toEqual({ name: 'Onboarding', pages: {}, audience: 'new joiners' });
    setBookAudience(s, 'book_x', '');
    expect(s.book_x).toEqual({ name: 'Onboarding', pages: {} });
    expect(changesOf((x) => removeBook(x, 'book_sold'))).toEqual([{ path: ['books', 'book_sold'], remove: true }]);
  });

  it('an edit to a book or page that is not there changes nothing', () => {
    expect(changesOf((s) => updatePage(s, 'book_sold', 'nope', { title: 'x' }))).toEqual([]);
    expect(changesOf((s) => movePage(s, 'book_sold', 'path', 'nope'))).toEqual([]);
    expect(changesOf((s) => renameBook(s, 'nope', 'x'))).toEqual([]);
  });
});

describe('ids and views', () => {
  it('never hands out an id that is taken', () => {
    const taken = new Set<string>();
    for (let i = 0; i < 200; i++) taken.add(newPageId(taken));
    expect(taken.size).toBe(200);
    expect(newBookId([])).toMatch(/^book_[a-z0-9]{6}$/);
  });

  it('draws a view from Views/ under its custom key', () => {
    expect(viewKeyOf('moduleMap')).toBe('moduleMap');
    expect(viewKeyOf('dependencyGraph')).toBe('dependencyGraph');
    expect(viewKeyOf('view_buy')).toBe('custom:view_buy');
  });
});

describe('a broken page', () => {
  const ctx = { views: new Set(['moduleMap', 'view_buy']), elements: new Set(['mod_pay']) };

  it('says which view is gone and which elements are', () => {
    const [book] = readBooks(section());
    expect(pageProblems(book.pages[0], ctx)).toEqual([]);
    const problems = pageProblems(book.pages[1], ctx);
    expect(problems).toEqual([{ kind: 'dangling-focus', ids: ['ext_psp'] }]);
    expect(describeProblems(problems, book.pages[1])).toBe('An element it points at is no longer in the model (ext_psp).');

    const gone = { ...book.pages[0], view: 'view_deleted' };
    expect(describeProblems(pageProblems(gone, ctx), gone)).toBe('The view "view_deleted" no longer exists.');
  });
});

describe('a narrative on screen', () => {
  it('joins lines an editor wrapped, and keeps paragraphs and list items apart', () => {
    const md = 'Follow the arrows left to right. The app talks to\none place.\n\n- Quote prices it\n  against the fares\n- Basket holds it\nNothing is issued yet.';
    expect(reflowNarrative(md)).toBe(
      'Follow the arrows left to right. The app talks to one place.\n\n- Quote prices it against the fares\n- Basket holds it Nothing is issued yet.',
    );
    expect(reflowNarrative('a\r\nb')).toBe('a b');
  });

  it('keeps numbered lists, headings, quotes and code fences as they are', () => {
    expect(reflowNarrative('1. one\n2. two')).toBe('1. one\n2. two');
    expect(reflowNarrative('## Why\nBecause it is\nso.')).toBe('## Why\nBecause it is so.');
    expect(reflowNarrative('> quoted\n> more')).toBe('> quoted\n> more');
    expect(reflowNarrative('```\nvar a = 1;\nvar b = 2;\n```\nAfter.')).toBe('```\nvar a = 1;\nvar b = 2;\n```\nAfter.');
  });
});

describe('editing through the sidecar', () => {
  const ROOT = '/ws/books';

  beforeEach(() => { localStorage.clear(); vi.useFakeTimers(); });
  afterEach(() => vi.useRealTimers());

  async function session(onDisk: unknown) {
    vi.resetModules();
    const api = vi.mocked(await import('./api'));
    vi.clearAllMocks();
    api.patchLayoutSidecar.mockResolvedValue(null);
    api.fetchLayout.mockImplementation(async () => structuredClone(onDisk));
    const layout = await import('./layout');
    return { api, layout };
  }

  it('is refused until the sidecar has been read', async () => {
    const { api, layout } = await session({ version: 1, books: section() });
    expect(layout.editBooksSection(ROOT, (s) => renameBook(s, 'book_sold', 'x'))).toBe(false);
    expect(layout.loadBooksSection(ROOT)).toBeUndefined();
    await vi.advanceTimersByTimeAsync(1000);
    expect(api.patchLayoutSidecar).not.toHaveBeenCalled();
  });

  it('sends only the edit once it has', async () => {
    const { api, layout } = await session({ version: 1, views: {}, books: section() });
    await layout.primeLayoutSidecar(ROOT);
    expect(layout.editBooksSection(ROOT, (s) => updatePage(s, 'book_sold', 'path', { title: 'The path' }))).toBe(true);
    await vi.advanceTimersByTimeAsync(1000);
    expect(api.patchLayoutSidecar.mock.calls.flatMap((c) => c[0])).toEqual([
      { path: ['books', 'book_sold', 'pages', 'path', 'title'], value: 'The path' },
    ]);
    expect(readBooks(layout.loadBooksSection(ROOT))[0].pages[0].title).toBe('The path');
  });

  it('starts a books section in a sidecar that has none', async () => {
    const { api, layout } = await session({ version: 1, views: {} });
    await layout.primeLayoutSidecar(ROOT);
    expect(layout.loadBooksSection(ROOT)).toEqual({});
    layout.editBooksSection(ROOT, (s) => addBook(s, 'book_a', 'A'));
    await vi.advanceTimersByTimeAsync(1000);
    expect(api.patchLayoutSidecar.mock.calls.flatMap((c) => c[0])).toEqual([
      { path: ['books'], value: { book_a: { name: 'A', pages: {} } } },
    ]);
  });

  it('sends an edit made while the write before it is still in flight', async () => {
    const { api, layout } = await session({ version: 1, views: {}, books: {} });
    await layout.primeLayoutSidecar(ROOT);
    let land: (v: null) => void = () => {};
    api.patchLayoutSidecar.mockImplementationOnce(() => new Promise((resolve) => { land = resolve; }));

    layout.editBooksSection(ROOT, (s) => { addBook(s, 'b', 'B'); addPage(s, 'b', { id: 'p', title: 'P', view: 'moduleMap' }); });
    await vi.advanceTimersByTimeAsync(500); // the first write is now in flight
    layout.editBooksSection(ROOT, (s) => updatePage(s, 'b', 'p', { focus: ['mod_a'] }));
    land(null);
    await vi.advanceTimersByTimeAsync(1000);

    const sent = api.patchLayoutSidecar.mock.calls.map((c) => c[0]);
    expect(sent).toHaveLength(2);
    expect(sent[1]).toEqual([{ path: ['books', 'b', 'pages', 'p', 'focus'], value: ['mod_a'] }]);
  });

  it('will not replace a books section that is not an object', async () => {
    const { api, layout } = await session({ version: 1, books: ['hand', 'edit'] });
    await layout.primeLayoutSidecar(ROOT);
    expect(layout.editBooksSection(ROOT, (s) => addBook(s, 'book_a', 'A'))).toBe(false);
    await vi.advanceTimersByTimeAsync(1000);
    expect(api.patchLayoutSidecar).not.toHaveBeenCalled();
  });
});
