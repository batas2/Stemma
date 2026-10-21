import { useEffect, useRef } from 'react';
import { Copy, Compass, GitCompareArrows, Search, MonitorSpeaker, ListOrdered, X } from 'lucide-react';
import { SHORTCUT_HINTS } from '@/lib/shortcuts';

/**
 * What's new (the changelog's "Faster on the canvas, clearer in the room"), said inside the app with
 * the keys that do each thing. Never opened on its own — a sheet appearing on launch could appear in
 * the middle of a meeting — but offered once, quietly, in the status bar, and always from ⌘K.
 */

export const WHATS_NEW_ID = '2026-10-21';
const SEEN_KEY = 'stemma.whatsNewSeen';

export function whatsNewSeen(): boolean {
  try { return localStorage.getItem(SEEN_KEY) === WHATS_NEW_ID; } catch { return true; }
}

export function markWhatsNewSeen(): void {
  try { localStorage.setItem(SEEN_KEY, WHATS_NEW_ID); } catch { /* private window */ }
}

function Keys({ children }: { children: string }) {
  return <kbd className="px-1.5 py-0.5 rounded border border-default bg-zinc-100 dark:bg-zinc-800 font-mono text-[11px] text-body">{children}</kbd>;
}

const ITEMS = [
  {
    icon: Copy,
    title: 'Copy, paste, duplicate — and copy a look',
    body: <>Select boxes, <Keys>{SHORTCUT_HINTS.copy}</Keys> then <Keys>{SHORTCUT_HINTS.paste}</Keys>; <Keys>{SHORTCUT_HINTS.duplicate}</Keys> duplicates. <Keys>{SHORTCUT_HINTS.copyStyle}</Keys> / <Keys>{SHORTCUT_HINTS.pasteStyle}</Keys> copy a style onto other boxes. One <Keys>{SHORTCUT_HINTS.undo}</Keys> undoes the last thing you did, whatever it was.</>,
  },
  {
    icon: Compass,
    title: 'Go anywhere, and back',
    body: <><Keys>{SHORTCUT_HINTS.palette}</Keys> finds any view, book or element and takes you to it. <Keys>{SHORTCUT_HINTS.back}</Keys> / <Keys>{SHORTCUT_HINTS.forward}</Keys> go back and forward. An element's Properties say which views it appears in.</>,
  },
  {
    icon: GitCompareArrows,
    title: 'See what changed',
    body: <><strong>Compare</strong> in the top bar draws the difference from the last commit, a tag or where your branch started: New, Changed, and ghosts of what was removed.</>,
  },
  {
    icon: Search,
    title: 'Find on this view',
    body: <><Keys>{SHORTCUT_HINTS.find}</Keys>, then a word or a chip — <code>status:target</code>, <code>squad:core</code>, <code>#tag</code>. What matches stays lit; <Keys>↩</Keys> walks through it.</>,
  },
  {
    icon: MonitorSpeaker,
    title: 'A presenter view',
    body: <>While presenting, <Keys>P</Keys> opens your notes, the next page and a timer in another window; the projector shows the diagram alone.</>,
  },
  {
    icon: ListOrdered,
    title: 'Steps',
    body: <>In the book editor, <strong>Record</strong> and click arrows in the order things happen. Presenting, each Next lights the next one, numbered.</>,
  },
];

export function WhatsNew({ open, onClose }: { open: boolean; onClose: () => void }) {
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    markWhatsNewSeen();
    closeRef.current?.focus();
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } }
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-modal flex items-center justify-center bg-black/50 backdrop-blur-sm p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="whats-new-title"
        onClick={(e) => e.stopPropagation()}
        className="w-[34rem] max-w-full max-h-[85vh] overflow-y-auto rounded-2xl surface-overlay p-6"
      >
        <div className="flex items-start gap-3 mb-4">
          <div className="flex-1">
            <h2 id="whats-new-title" className="text-lg font-semibold text-body">What's new in Stemma</h2>
            <p className="text-sm text-muted">Faster on the canvas, clearer in the room.</p>
          </div>
          <button onClick={onClose} aria-label="Close" className="p-1 rounded text-muted hover:text-body"><X className="w-4 h-4" /></button>
        </div>
        <ul className="flex flex-col gap-4">
          {ITEMS.map((item) => {
            const Icon = item.icon;
            return (
              <li key={item.title} className="flex gap-3">
                <span className="mt-0.5 w-8 h-8 shrink-0 rounded-lg bg-indigo-500/10 text-indigo-600 dark:text-indigo-300 flex items-center justify-center">
                  <Icon className="w-4 h-4" aria-hidden />
                </span>
                <div className="min-w-0">
                  <div className="text-sm font-medium text-body">{item.title}</div>
                  <div className="text-[13px] leading-relaxed text-muted">{item.body}</div>
                </div>
              </li>
            );
          })}
        </ul>
        <div className="mt-6 flex justify-end">
          <button ref={closeRef} onClick={onClose} className="px-4 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium">Continue</button>
        </div>
      </div>
    </div>
  );
}
