// Per-element rich-text notes, stored per workspace in localStorage (the same client-side
// sidecar model as custom properties / layout). The `#Key: value` hashtags inside a note are
// parsed out and mirrored into custom properties so they render on the canvas.

import { sidecarMap, sidecarSet } from './layout';

const KEY = (root: string) => `verso.notes:${root}`;

function loadAll(root: string): Record<string, string> {
  if (typeof window === 'undefined') return {};
  let local: Record<string, string> = {};
  try { local = JSON.parse(localStorage.getItem(KEY(root)) ?? '{}') as Record<string, string>; } catch { /* ignore */ }
  const committed = sidecarMap<string>(root, 'notes');
  return committed ? { ...local, ...committed } : local;
}

export function loadNote(root: string, id: string): string {
  return loadAll(root)[id] ?? '';
}

export function saveNote(root: string, id: string, text: string): void {
  if (typeof window === 'undefined') return;
  const all = loadAll(root);
  if (text.trim()) all[id] = text;
  else delete all[id];
  try { localStorage.setItem(KEY(root), JSON.stringify(all)); } catch { /* ignore quota errors */ }
  // Committed copy → notes travel with the model in Git.
  sidecarSet(root, 'notes', id, text.trim() ? text : undefined);
}
