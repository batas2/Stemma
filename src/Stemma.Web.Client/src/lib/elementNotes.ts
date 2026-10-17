// Per-element rich-text notes, committed per workspace in the presentation sidecar (the same
// model as custom properties / layout). The `#Key: value` hashtags inside a note are
// parsed out and mirrored into custom properties so they render on the canvas.

import { cachedSection, sidecarSet } from './layout';

const KEY = (root: string) => `stemma.notes:${root}`;

function loadAll(root: string): Record<string, string> {
  return cachedSection<string>(root, 'notes', KEY(root));
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
