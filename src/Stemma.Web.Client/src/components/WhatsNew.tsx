import { useEffect, useRef } from 'react';
import { Network, Server, ShieldCheck, FolderGit2, Bot, X } from 'lucide-react';

/**
 * What's new (the changelog's "Faster on the canvas, clearer in the room"), said inside the app with
 * the keys that do each thing. Never opened on its own — a sheet appearing on launch could appear in
 * the middle of a meeting — but offered once, quietly, in the status bar, and always from ⌘K.
 */

export const WHATS_NEW_ID = '2026-10-22';
const SEEN_KEY = 'stemma.whatsNewSeen';

export function whatsNewSeen(): boolean {
  try { return localStorage.getItem(SEEN_KEY) === WHATS_NEW_ID; } catch { return true; }
}

export function markWhatsNewSeen(): void {
  try { localStorage.setItem(SEEN_KEY, WHATS_NEW_ID); } catch { /* private window */ }
}

const ITEMS = [
  {
    icon: Network,
    title: 'Diagrams lay themselves out',
    body: <>A view nobody arranged is laid out in layers that follow its relationships, every arrow routed around the boxes. <strong>Layout &amp; arrange → Lay out in layers</strong> keeps it and turns it.</>,
  },
  {
    icon: Server,
    title: 'C4 views from a scope',
    body: <>A <code>container</code> or <code>systemContext</code> view with a <code>Scope</code> draws the system's boundary and everything it talks to. Cards carry each container's technology and a description.</>,
  },
  {
    icon: ShieldCheck,
    title: 'Rules the architecture keeps',
    body: <>Write what must hold in <code>Rules/*.cs</code> — only, forbid, layers, require — and a break is marked on the cards and named under <strong>Validation</strong>, with its reason.</>,
  },
  {
    icon: FolderGit2,
    title: 'Checked against your code',
    body: <><code>Code.Map</code> ties a container to its .NET projects; Stemma says where the diagram and the project references disagree.</>,
  },
  {
    icon: Bot,
    title: 'Stemma for Claude Code',
    body: <><code>/plugin install stemma@stemma</code>, then ask for an architecture. Claude builds, checks and renders it; <code>stemma open</code> shows it here as it arrives.</>,
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
