import { useEffect, useRef } from 'react';
import { MessageSquare, ArrowLeftRight, GitCompare, Bot, X } from 'lucide-react';

/**
 * What's new (the changelog's "The review loop"), said inside the app with
 * the keys that do each thing. Never opened on its own — a sheet appearing on launch could appear in
 * the middle of a meeting — but offered once, quietly, in the status bar, and always from ⌘K.
 */

export const WHATS_NEW_ID = '2026-11-07';
const SEEN_KEY = 'stemma.whatsNewSeen';

export function whatsNewSeen(): boolean {
  try { return localStorage.getItem(SEEN_KEY) === WHATS_NEW_ID; } catch { return true; }
}

export function markWhatsNewSeen(): void {
  try { localStorage.setItem(SEEN_KEY, WHATS_NEW_ID); } catch { /* private window */ }
}

const ITEMS = [
  {
    icon: MessageSquare,
    title: 'The cards say where the review is',
    body: <>A card with open comments shows how many. Press the count to select the card and open its comments — and see the answers Claude left there, as they arrive.</>,
  },
  {
    icon: Bot,
    title: 'Claude answers the review',
    body: <>Comment on the cards, then ask for <code>/stemma:respond</code>. Claude changes the model, replies on each card, signed as Claude, and resolves what it did.</>,
  },
  {
    icon: GitCompare,
    title: 'The change, in words',
    body: <><code>stemma diff</code> says what a branch changed in the model — renamed, moved, a new technology, an arrow turned round — and which comments it resolved. <code>--markdown</code> is ready for the pull request.</>,
  },
  {
    icon: ArrowLeftRight,
    title: 'Reversing keeps the relationship',
    body: <><strong>Reverse direction</strong> and dragging an end to another box now change the two ends and nothing else: same line, same id, its comments and its look. One undo puts it back.</>,
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
            <p className="text-sm text-muted">Review the architecture where it is drawn.</p>
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
