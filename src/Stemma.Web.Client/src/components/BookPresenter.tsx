import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, TriangleAlert, X } from 'lucide-react';
import clsx from 'clsx';
import { useApp, activeBook, activePage, pageViewIds } from '@/lib/store';
import { describeProblems, pageProblems, reflowNarrative } from '@/lib/books';
import { renderNotes } from '@/lib/notesMarkdown';
import { isTextTarget, presenterAction } from '@/lib/presenterKeys';

/**
 * Presenting a book (F-013 AC7): the canvas fills the window, the page's words sit over it, and the
 * keys a presenter already knows turn the pages. Rendered over the canvas, which App strips of its
 * chrome and makes read-only while this is up; nothing here writes anything.
 */
export function BookPresenter() {
  const book = useApp(activeBook);
  const page = useApp(activePage);
  const arch = useApp((s) => s.arch);
  const customViews = useApp((s) => s.customViews);
  const stepPage = useApp((s) => s.stepPage);
  const stopPresenting = useApp((s) => s.stopPresenting);
  const [narrativeShown, setNarrativeShown] = useState(true);
  const [blank, setBlank] = useState(false);
  const [idle, setIdle] = useState(false);
  // Whether this presentation took the screen, so that leaving full screen (Esc, which the browser
  // keeps for itself) is taken as stopping, and a presentation that never had it is not stopped.
  const ownsFullscreen = useRef(false);
  // Read by the key handler, which is bound once.
  const blankRef = useRef(blank);
  blankRef.current = blank;

  const pages = book?.pages ?? [];
  const index = page ? pages.findIndex((p) => p.id === page.id) : -1;
  const problems = useMemo(() => {
    if (!page) return [];
    return pageProblems(page, { views: pageViewIds({ customViews }), elements: new Set(arch?.elements.map((e) => e.id) ?? []) });
  }, [page, customViews, arch]);
  const narrativeHtml = useMemo(() => (page?.narrative ? renderNotes(reflowNarrative(page.narrative)) : ''), [page?.narrative]);

  useEffect(() => {
    // Whatever was selected for the last page edit is not part of the presentation.
    window.dispatchEvent(new CustomEvent('stemma:clear-selection'));
    const root = document.documentElement;
    if (!document.fullscreenElement && root.requestFullscreen) {
      root.requestFullscreen().then(() => { ownsFullscreen.current = true; }).catch(() => { /* not allowed here: present in the window */ });
    }
    function onFullscreenChange() {
      if (document.fullscreenElement) { ownsFullscreen.current = true; return; }
      if (ownsFullscreen.current) { ownsFullscreen.current = false; useApp.getState().stopPresenting(); }
    }
    document.addEventListener('fullscreenchange', onFullscreenChange);
    return () => {
      document.removeEventListener('fullscreenchange', onFullscreenChange);
      if (ownsFullscreen.current && document.fullscreenElement) {
        ownsFullscreen.current = false;
        void document.exitFullscreen().catch(() => { /* already gone */ });
      }
    };
  }, []);

  useEffect(() => {
    // Capture phase, ahead of the editor's shortcuts: while presenting, an arrow is a page turn and
    // not a nudge, and Delete or Ctrl+Z must not reach a model the audience is looking at.
    function onKey(e: KeyboardEvent) {
      const fromInput = isTextTarget(e.target);
      if (fromInput) return;
      e.stopImmediatePropagation();
      const action = presenterAction({ key: e.key, shiftKey: e.shiftKey, ctrlKey: e.ctrlKey, metaKey: e.metaKey, altKey: e.altKey, fromInput });
      if (!action) return;
      e.preventDefault();
      setIdle(false);
      if (action === 'blank') { setBlank((b) => !b); return; }
      if (action === 'exit') { useApp.getState().stopPresenting(); return; }
      // A key on a blank screen brings the picture back before it moves on.
      if (blankRef.current && (action === 'next' || action === 'prev')) { setBlank(false); return; }
      setBlank(false);
      if (action === 'next') useApp.getState().stepPage(1);
      else if (action === 'prev') useApp.getState().stepPage(-1);
      else if (action === 'first') useApp.getState().edgePage('first');
      else if (action === 'last') useApp.getState().edgePage('last');
      else if (action === 'narrative') {
        setNarrativeShown((v) => !v);
        // After the card has gone or come back, so the frame is measured against what is on screen.
        requestAnimationFrame(() => window.dispatchEvent(new Event('stemma:book-reframe')));
      }
      else if (action === 'fullscreen') {
        // Leaving full screen on purpose is not stopping the presentation.
        if (document.fullscreenElement) { ownsFullscreen.current = false; void document.exitFullscreen().catch(() => {}); }
        else void document.documentElement.requestFullscreen?.().then(() => { ownsFullscreen.current = true; }).catch(() => {});
      }
    }
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);

  // The controls step back while the presenter talks, and return when the mouse moves.
  useEffect(() => {
    let timer = setTimeout(() => setIdle(true), 2500);
    function onMove() {
      setIdle(false);
      clearTimeout(timer);
      timer = setTimeout(() => setIdle(true), 2500);
    }
    window.addEventListener('mousemove', onMove);
    return () => { clearTimeout(timer); window.removeEventListener('mousemove', onMove); };
  }, []);

  if (!book || !page) return null;
  const announcement = `Page ${index + 1} of ${pages.length}: ${page.title || 'Untitled page'}`;

  return (
    <div className={clsx('absolute inset-0 pointer-events-none z-chrome', idle && 'cursor-none')}>
      <div className="sr-only" aria-live="polite">{announcement}</div>

      {blank && <div className="absolute inset-0 bg-black pointer-events-auto" aria-label="Screen blanked — press B to return" />}

      {!blank && narrativeShown && (page.title || narrativeHtml || problems.length > 0) && (
        <section
          data-book-narrative
          aria-label="Page narrative"
          className="absolute left-6 bottom-6 max-w-[min(44rem,calc(100%-10rem))] pointer-events-auto rounded-xl border border-default bg-white/90 dark:bg-zinc-900/90 backdrop-blur shadow-xl px-5 py-4"
        >
          <div className="text-[11px] uppercase tracking-wider text-amber-700 dark:text-amber-300 mb-1">
            {book.name} · {index + 1} / {pages.length}
          </div>
          {page.title && <h2 className="text-xl font-semibold text-body leading-snug">{page.title}</h2>}
          {problems.length > 0 && (
            <p className="mt-2 flex items-start gap-1.5 text-sm text-amber-700 dark:text-amber-300">
              <TriangleAlert className="w-4 h-4 shrink-0 mt-0.5" aria-hidden />
              <span>{describeProblems(problems, page)}</span>
            </p>
          )}
          {narrativeHtml && (
            <div
              className="mt-2 text-[15px] leading-relaxed text-body max-h-[38vh] overflow-y-auto space-y-1"
              dangerouslySetInnerHTML={{ __html: narrativeHtml }}
            />
          )}
        </section>
      )}

      {!blank && (
        <div className="absolute left-0 right-0 bottom-0 h-1 bg-amber-500/10" aria-hidden>
          <div className="h-full bg-amber-500 transition-[width] duration-300" style={{ width: `${((index + 1) / pages.length) * 100}%` }} />
        </div>
      )}

      <nav
        aria-label="Presentation"
        className={clsx(
          'absolute right-6 bottom-6 flex items-center gap-1 pointer-events-auto rounded-full border border-default bg-white/80 dark:bg-zinc-900/80 backdrop-blur px-1.5 py-1 shadow transition-opacity',
          idle && !blank ? 'opacity-0' : 'opacity-100',
        )}
      >
        <button onClick={() => stepPage(-1)} disabled={index <= 0} aria-label="Previous page" className="p-2 rounded-full hover:bg-zinc-200/70 dark:hover:bg-zinc-800 disabled:opacity-30">
          <ChevronLeft className="w-4 h-4" />
        </button>
        <span className="text-xs tabular-nums text-muted px-1">{index + 1} / {pages.length}</span>
        <button onClick={() => stepPage(1)} disabled={index >= pages.length - 1} aria-label="Next page" className="p-2 rounded-full hover:bg-zinc-200/70 dark:hover:bg-zinc-800 disabled:opacity-30">
          <ChevronRight className="w-4 h-4" />
        </button>
        <button onClick={stopPresenting} aria-label="Stop presenting (Esc)" title="Stop presenting (Esc) · N narrative · B blank screen" className="p-2 rounded-full hover:bg-zinc-200/70 dark:hover:bg-zinc-800">
          <X className="w-4 h-4" />
        </button>
      </nav>
    </div>
  );
}
