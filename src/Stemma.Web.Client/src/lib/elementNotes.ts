// Per-element rich-text notes, committed per workspace in the presentation sidecar (the same
// model as custom properties / layout). The `#Key: value` hashtags inside a note are
// parsed out and mirrored into custom properties so they render on the canvas.

import { cachedEntry, cachedSection, sidecarSet } from './layout';

/** One element's note ('' for none), read without copying the others. */
export function loadNote(root: string, id: string): string {
  const note = cachedEntry<unknown>(root, 'notes', id);
  return typeof note === 'string' ? note : '';
}

/** Every note, element id → text, in one read: for drawing many elements, rather than one read per element. */
export function loadNotes(root: string): Record<string, string> {
  return cachedSection<string>(root, 'notes');
}

export function saveNote(root: string, id: string, text: string): void {
  if (typeof window === 'undefined') return;
  // Committed copy → notes travel with the model in Git. The browser's copy is written with it.
  sidecarSet(root, 'notes', id, text.trim() ? text : undefined);
}
