import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Monitor, Pause, Play, RotateCcw, Square, TriangleAlert, X } from 'lucide-react';
import clsx from 'clsx';
import { ensureConnection, onPresenterState, sendPresenter } from '@/lib/signalr';
import { formatElapsed, isPresenterMessage, type ConsoleAction, type PresenterState } from '@/lib/presenterLink';
import { isTextTarget, presenterAction } from '@/lib/presenterKeys';
import { reflowNarrative } from '@/lib/books';
import { renderNotes } from '@/lib/notesMarkdown';

/**
 * The presenter's console (F-019): the window on the laptop while the canvas is on the projector.
 * What to say now, what comes next, how long it has been and what time it is — and the same keys and
 * clicker as the presenting window, so either one turns the page. It holds no model and writes
 * nothing; it shows what the presenting window tells it.
 */
export function PresenterConsole() {
  const [state, setState] = useState<PresenterState | null>(null);
  const [ended, setEnded] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  // The timer is the presenter's own: paused and reset here, never on the projector.
  const [pausedAt, setPausedAt] = useState<number | null>(null);
  const [offset, setOffset] = useState(0);
  const [resetAt, setResetAt] = useState<number | null>(null);
  const session = useRef<string | null>(null);
  // How to finish setting up, said here rather than on the projector, where the room would read it.
  const [hint, setHint] = useState(() => {
    try { return localStorage.getItem('stemma.presenterHintSeen') !== '1'; } catch { return true; }
  });
  function dismissHint() {
    setHint(false);
    try { localStorage.setItem('stemma.presenterHintSeen', '1'); } catch { /* private window */ }
  }

  useEffect(() => {
    document.title = 'Presenter — Stemma';
    document.documentElement.classList.add('dark');
    document.body.style.backgroundColor = 'rgb(9 9 11)';
    let live = true;
    const off = onPresenterState((raw) => {
      if (!isPresenterMessage(raw)) return;
      if (raw.type === 'ended') {
        if (raw.session === session.current) { setEnded(true); setState(null); }
        return;
      }
      if (session.current !== raw.session) {
        // A new presentation: its own clock.
        session.current = raw.session;
        setPausedAt(null); setOffset(0); setResetAt(null);
      }
      setEnded(false);
      setState(raw);
    });
    ensureConnection()
      .then(() => { if (live) void sendPresenter('PresenterCommand', { type: 'command', action: 'hello', session: null }); })
      .catch(() => {});
    const tick = setInterval(() => setNow(Date.now()), 500);
    return () => { live = false; off(); clearInterval(tick); };
  }, []);

  function send(action: ConsoleAction, index?: number) {
    void sendPresenter('PresenterCommand', { type: 'command', action, session: session.current, ...(index !== undefined ? { index } : {}) });
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (isTextTarget(e.target)) return;
      const action = presenterAction({ key: e.key, shiftKey: e.shiftKey, ctrlKey: e.ctrlKey, metaKey: e.metaKey, altKey: e.altKey, fromInput: false });
      if (!action || action === 'narrative' || action === 'fullscreen' || action === 'console') return;
      e.preventDefault();
      send(action);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const page = state?.pages[state.index] ?? null;
  const next = state && state.index + 1 < state.pages.length ? state.pages[state.index + 1] : null;
  const narrative = useMemo(() => (page?.narrative ? renderNotes(reflowNarrative(page.narrative)) : ''), [page?.narrative]);
  const start = resetAt ?? state?.startedAt ?? now;
  const elapsed = (pausedAt ?? now) - start - offset;
  const clock = new Date(now).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  function togglePause() {
    if (pausedAt === null) setPausedAt(Date.now());
    else { setOffset((o) => o + (Date.now() - pausedAt)); setPausedAt(null); }
  }
  function resetTimer() { setResetAt(Date.now()); setOffset(0); setPausedAt(null); }

  if (!state) {
    return (
      <div className="h-screen flex flex-col items-center justify-center gap-4 bg-zinc-950 text-zinc-100 px-8 text-center">
        <Monitor className="w-10 h-10 text-zinc-400" aria-hidden />
        <h1 className="text-2xl font-semibold">{ended ? 'The presentation has ended' : 'Waiting for a presentation'}</h1>
        <p className="text-zinc-400 max-w-md leading-relaxed">
          {ended
            ? 'Present a book again and this window will follow it.'
            : 'Present a book in Stemma. This window follows it: what to say, what comes next, and the time.'}
        </p>
        {ended && (
          <button onClick={() => window.close()} className="mt-2 px-4 py-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-sm">Close this window</button>
        )}
      </div>
    );
  }

  const btn = 'flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium transition-colors disabled:opacity-30';

  return (
    <div className="h-screen flex flex-col bg-zinc-950 text-zinc-100 select-none">
      <header className="flex items-center gap-4 px-6 py-3 border-b border-zinc-800">
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold truncate">{state.book.name}</div>
          <div className="text-xs text-zinc-400">{state.book.audience ?? 'general audience'}</div>
        </div>
        <div className="flex items-center gap-3" aria-label="Timer">
          <span className={clsx('text-3xl font-semibold tabular-nums', pausedAt !== null && 'text-amber-400')} aria-live="off">{formatElapsed(elapsed)}</span>
          <button onClick={togglePause} aria-label={pausedAt === null ? 'Pause the timer' : 'Resume the timer'} title={pausedAt === null ? 'Pause' : 'Resume'} className="p-2 rounded-lg hover:bg-zinc-800 text-zinc-400 hover:text-zinc-100">
            {pausedAt === null ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
          </button>
          <button onClick={resetTimer} aria-label="Reset the timer" title="Reset" className="p-2 rounded-lg hover:bg-zinc-800 text-zinc-400 hover:text-zinc-100">
            <RotateCcw className="w-4 h-4" />
          </button>
        </div>
        <div className="text-2xl tabular-nums text-zinc-400 pl-4 border-l border-zinc-800" aria-label="Time of day">{clock}</div>
      </header>

      {hint && (
        <div role="note" className="flex items-center gap-3 px-6 py-2 bg-amber-500/10 border-b border-amber-500/20 text-sm text-amber-100">
          <Monitor className="w-4 h-4 text-amber-300 shrink-0" aria-hidden />
          <span className="flex-1">Put the presentation window on the projector and press <kbd className="px-1 rounded bg-zinc-800">F</kbd> there for full screen. This window stays on your screen.</span>
          <button onClick={dismissHint} className="px-2 py-0.5 rounded hover:bg-zinc-800 text-zinc-300">Got it</button>
        </div>
      )}
      <main className="flex-1 min-h-0 grid grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <section aria-label="Now" className="min-h-0 overflow-y-auto px-8 py-6 border-r border-zinc-800">
          <div className="text-xs uppercase tracking-wider text-amber-400 mb-2">
            Now · {state.index + 1} of {state.pages.length}
            {state.blank && <span className="ml-2 text-zinc-400 normal-case tracking-normal">· the screen is blank</span>}
          </div>
          <h1 className="text-3xl font-semibold leading-tight">{page?.title || 'Untitled page'}</h1>
          <div className="mt-1 text-sm text-zinc-400">{page?.viewName}{page && page.focus > 0 ? ` · points at ${page.focus}` : ''}</div>
          {state.step && (
            <div className="mt-4 inline-flex items-center gap-2 rounded-lg bg-indigo-500/15 text-indigo-200 px-3 py-1.5 text-sm">
              <span className="font-semibold tabular-nums">Step {state.step.at} of {state.step.of}</span>
              {state.step.caption && <span className="text-indigo-100/80">{state.step.caption}</span>}
            </div>
          )}
          {page?.problem && (
            <p className="mt-4 flex items-start gap-2 text-amber-300 text-sm"><TriangleAlert className="w-4 h-4 mt-0.5 shrink-0" aria-hidden />{page.problem}</p>
          )}
          {narrative
            ? <div className="archnote mt-6 text-[21px] leading-relaxed text-zinc-100 space-y-3" dangerouslySetInnerHTML={{ __html: narrative }} />
            : <p className="mt-6 text-zinc-600 text-lg">No narrative on this page.</p>}
        </section>
        <section aria-label="Next" className="min-h-0 overflow-y-auto px-8 py-6 bg-zinc-900/40">
          <div className="text-xs uppercase tracking-wider text-zinc-400 mb-2">Next</div>
          {next ? (
            <>
              <h2 className="text-xl font-semibold leading-snug text-zinc-200">{next.title || 'Untitled page'}</h2>
              <div className="mt-1 text-sm text-zinc-400">{next.viewName}{next.focus > 0 ? ` · points at ${next.focus}` : ''}</div>
              {next.narrative && <p className="mt-4 text-[15px] leading-relaxed text-zinc-400 line-clamp-6 whitespace-pre-line">{reflowNarrative(next.narrative)}</p>}
            </>
          ) : (
            <p className="text-zinc-400 text-lg">This is the last page.</p>
          )}
          <ol aria-label="Pages" className="mt-8 space-y-1">
            {state.pages.map((p, i) => (
              <li key={i}>
                <button
                  onClick={() => send('goto', i)}
                  aria-current={i === state.index ? 'page' : undefined}
                  className={clsx(
                    'w-full text-left px-3 py-1.5 rounded-lg text-sm truncate transition-colors',
                    i === state.index ? 'bg-amber-500/15 text-amber-200' : 'text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200',
                  )}
                >
                  <span className="tabular-nums text-zinc-400 mr-2">{i + 1}</span>{p.title || 'Untitled page'}
                </button>
              </li>
            ))}
          </ol>
        </section>
      </main>

      <footer className="flex items-center gap-3 px-6 py-3 border-t border-zinc-800">
        <button onClick={() => send('prev')} disabled={state.index === 0 && !state.step} className={clsx(btn, 'bg-zinc-800 hover:bg-zinc-700')}>
          <ChevronLeft className="w-4 h-4" /> Previous
        </button>
        <button onClick={() => send('next')} className={clsx(btn, 'bg-amber-500 hover:bg-amber-400 text-zinc-950')}>
          Next <ChevronRight className="w-4 h-4" />
        </button>
        <div className="flex-1 h-1 rounded-full bg-zinc-800 overflow-hidden mx-2" aria-hidden>
          <div className="h-full bg-amber-500 transition-[width] duration-300" style={{ width: `${((state.index + 1) / state.pages.length) * 100}%` }} />
        </div>
        <button onClick={() => send('blank')} aria-pressed={state.blank} title="Blank the projector (B)" className={clsx(btn, state.blank ? 'bg-zinc-100 text-zinc-900' : 'bg-zinc-800 hover:bg-zinc-700')}>
          <Square className="w-4 h-4" /> {state.blank ? 'Show again' : 'Blank'}
        </button>
        <button onClick={() => send('exit')} title="End the presentation (Esc)" className={clsx(btn, 'bg-zinc-800 hover:bg-rose-600/80')}>
          <X className="w-4 h-4" /> End
        </button>
      </footer>
    </div>
  );
}
