/**
 * A book as a PDF (F-013 AC10): one landscape page per book page, with the diagram exactly as it is
 * presented — the page's view, its focus lit and the rest dimmed, framed as the page says.
 *
 * The pictures come from the canvas rather than from a second renderer, for the same reason the
 * headless render does: a PDF that drew differently from the meeting would be a second truth about
 * what the architecture looks like. So the export walks the book on screen, page by page, framing
 * each one at once (`capturing`) instead of animating to it, and takes the viewport.
 */

import { useApp, pageViewIds } from './store';
import { exportBookPdf } from './api';
import { reportFailure, ClientEvent } from './log';
import { reflowNarrative, type Book } from './books';
import { saveOpenViews } from './views';

/** Longest wait for a page to say it is framed before it is taken as it is. */
const FRAMED_TIMEOUT_MS = 3000;
const CAPTURE_TIMEOUT_MS = 10000;

function framed(pageId: string): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(done, FRAMED_TIMEOUT_MS);
    function on(ev: Event) { if ((ev as CustomEvent).detail?.pageId === pageId) done(); }
    function done() { clearTimeout(timer); window.removeEventListener('stemma:book-framed', on); resolve(); }
    window.addEventListener('stemma:book-framed', on);
  });
}

function captureViewport(): Promise<string | null> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), CAPTURE_TIMEOUT_MS);
    window.dispatchEvent(new CustomEvent('stemma:capture-viewport', {
      detail: { resolve: (url: string | null) => { clearTimeout(timer); resolve(url); } },
    }));
  });
}

// The editor that started an export is unmounted while the pages are captured, so it cannot be
// what remembers that one is running.
let running = false;

/** Whether a book is being exported right now. */
export function isExportingBook(): boolean {
  return running;
}

export async function exportBookAsPdf(bookId: string): Promise<void> {
  if (running) {
    useApp.getState().setToast({ kind: 'info', text: 'A book is already being exported.' });
    return;
  }
  const before = useApp.getState();
  const book = before.books.find((b) => b.id === bookId);
  if (!book || book.pages.length === 0) return;
  running = true;
  try {
    await capture(bookId, book);
  } finally {
    running = false;
  }
}

async function capture(bookId: string, book: Book): Promise<void> {
  const before = useApp.getState();
  const restore = {
    bookId: before.activeBookId, pageId: before.activePageId, view: before.view,
    customViewId: before.activeCustomViewId, openViewIds: before.openViewIds,
  };
  const views = pageViewIds(before);

  if (before.activeBookId !== bookId) before.openBook(bookId);
  const pages: { title: string; narrative: string; capturePngBase64?: string }[] = [];
  try {
    for (const [i, page] of book.pages.entries()) {
      useApp.getState().setToast({ kind: 'info', text: `Capturing page ${i + 1} of ${book.pages.length}…` });
      let image: string | null = null;
      // A page whose view is gone has no picture to take; whatever the canvas shows is not it.
      if (views.has(page.view)) {
        const settled = framed(page.id);
        // Switching to instant framing re-frames the page on screen, so the first page is framed
        // the same way whether or not it was already showing.
        if (!useApp.getState().capturing) useApp.getState().setCapturing(true);
        if (useApp.getState().activePageId !== page.id) useApp.getState().showPage(page.id);
        await settled;
        image = await captureViewport();
      }
      pages.push({
        title: page.title,
        // Read as prose on paper: the editor's wrapping is not the author's line breaks.
        narrative: reflowNarrative(page.narrative),
        ...(image ? { capturePngBase64: image.replace(/^data:image\/png;base64,/, '') } : {}),
      });
    }
  } finally {
    // Back to where the person was: the page, then the view they were on, which need not be the
    // page's, and only the view tabs they had open — walking the book opened one per view.
    const st = useApp.getState();
    st.setCapturing(false);
    if (restore.bookId === bookId && restore.pageId) st.showPage(restore.pageId);
    else st.openBook(restore.bookId);
    if (restore.customViewId) st.setActiveCustomView(restore.customViewId);
    else st.setView(restore.view);
    useApp.setState({ openViewIds: restore.openViewIds });
    const root = st.workspace?.rootPath;
    if (root) saveOpenViews(root, restore.openViewIds);
  }

  try {
    const blob = await exportBookPdf({ name: book.name, audience: book.audience, pages });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${book.name || 'book'}.pdf`;
    a.click();
    URL.revokeObjectURL(url);
    useApp.getState().setToast({ kind: 'success', text: `Exported “${book.name}” as PDF` });
  } catch (error) {
    reportFailure('Api', ClientEvent.RequestFailed, 'Exporting a book as PDF')(error);
    const tooBig = /\b(400|413)\b/.test(String((error as Error)?.message));
    useApp.getState().setToast({
      kind: 'error',
      text: tooBig
        ? 'The book is too large to export as one PDF (at most 200 pages). Split it, or export a shorter book.'
        : "The book couldn't be exported as PDF.",
    });
  }
}
