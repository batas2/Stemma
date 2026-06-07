// Epic 08 Track A — book store operations: add, remove, rename, page management,
// active selection, and prev/next nav. Mirrors the engine-side ViewBookOps surface
// so the UI can stage book edits before round-tripping to YAML.

import { beforeEach, describe, expect, it } from 'vitest';
import { useApp } from './store';
import type { Book } from './types';

const book = (id: string, pages = 0): Book => ({
  id,
  name: id,
  audience: null,
  pages: Array.from({ length: pages }, (_, i) => ({ viewId: 'moduleMap', title: `P${i}`, narrative: `n${i}` })),
});

beforeEach(() => {
  useApp.setState({
    workspace: null, arch: null, view: 'moduleMap',
    customViews: [], activeCustomViewId: null,
    selectedElementId: null, selectedLinkId: null,
    books: [], activeBookId: null, activeBookPageIndex: 0,
  });
  if (typeof window !== 'undefined') localStorage.clear();
});

describe('Epic 08 — Book store', () => {
  it('addBook appends to books list', () => {
    useApp.getState().addBook(book('book_a'));
    expect(useApp.getState().books).toHaveLength(1);
    expect(useApp.getState().books[0].id).toBe('book_a');
  });

  it('removeBook drops the entry and clears activeBookId if it pointed there', () => {
    useApp.getState().addBook(book('book_a'));
    useApp.getState().setActiveBook('book_a');
    useApp.getState().removeBook('book_a');
    expect(useApp.getState().books).toHaveLength(0);
    expect(useApp.getState().activeBookId).toBeNull();
  });

  it('removeBook leaves activeBookId alone if another book is active', () => {
    useApp.getState().addBook(book('book_a'));
    useApp.getState().addBook(book('book_b'));
    useApp.getState().setActiveBook('book_b');
    useApp.getState().removeBook('book_a');
    expect(useApp.getState().activeBookId).toBe('book_b');
  });

  it('renameBook updates only the name field', () => {
    useApp.getState().addBook(book('book_a'));
    useApp.getState().renameBook('book_a', 'My Book');
    expect(useApp.getState().books[0].name).toBe('My Book');
    expect(useApp.getState().books[0].id).toBe('book_a');
  });

  it('addBookPage appends a page to the named book', () => {
    useApp.getState().addBook(book('book_a'));
    useApp.getState().addBookPage('book_a', { viewId: 'moduleMap', title: 'X', narrative: '' });
    expect(useApp.getState().books[0].pages).toHaveLength(1);
    expect(useApp.getState().books[0].pages[0].title).toBe('X');
  });

  it('removeBookPage drops the indexed page and clamps active page index', () => {
    useApp.getState().addBook(book('book_a', 3));
    useApp.getState().setActiveBook('book_a');
    useApp.getState().setActiveBookPageIndex(2);
    useApp.getState().removeBookPage('book_a', 1);
    expect(useApp.getState().books[0].pages.map((p) => p.title)).toEqual(['P0', 'P2']);
    expect(useApp.getState().activeBookPageIndex).toBe(1);
  });

  it('reorderBookPages permutes pages in-place', () => {
    useApp.getState().addBook(book('book_a', 3));
    useApp.getState().reorderBookPages('book_a', [2, 0, 1]);
    expect(useApp.getState().books[0].pages.map((p) => p.title)).toEqual(['P2', 'P0', 'P1']);
  });

  it('reorderBookPages rejects wrong length silently', () => {
    useApp.getState().addBook(book('book_a', 3));
    useApp.getState().reorderBookPages('book_a', [0, 1]);
    expect(useApp.getState().books[0].pages.map((p) => p.title)).toEqual(['P0', 'P1', 'P2']);
  });

  it('setBookPageNarrative updates only the target page', () => {
    useApp.getState().addBook(book('book_a', 2));
    useApp.getState().setBookPageNarrative('book_a', 1, 'revised');
    expect(useApp.getState().books[0].pages[0].narrative).toBe('n0');
    expect(useApp.getState().books[0].pages[1].narrative).toBe('revised');
  });

  it('setActiveBook resets page index to 0', () => {
    useApp.getState().addBook(book('book_a', 3));
    useApp.getState().setActiveBook('book_a');
    useApp.getState().setActiveBookPageIndex(2);
    useApp.getState().addBook(book('book_b', 3));
    useApp.getState().setActiveBook('book_b');
    expect(useApp.getState().activeBookPageIndex).toBe(0);
  });

  it('nextBookPage advances, stops at last', () => {
    useApp.getState().addBook(book('book_a', 2));
    useApp.getState().setActiveBook('book_a');
    useApp.getState().nextBookPage();
    expect(useApp.getState().activeBookPageIndex).toBe(1);
    useApp.getState().nextBookPage();
    expect(useApp.getState().activeBookPageIndex).toBe(1);
  });

  it('prevBookPage retreats, stops at zero', () => {
    useApp.getState().addBook(book('book_a', 2));
    useApp.getState().setActiveBook('book_a');
    useApp.getState().setActiveBookPageIndex(1);
    useApp.getState().prevBookPage();
    expect(useApp.getState().activeBookPageIndex).toBe(0);
    useApp.getState().prevBookPage();
    expect(useApp.getState().activeBookPageIndex).toBe(0);
  });
});
