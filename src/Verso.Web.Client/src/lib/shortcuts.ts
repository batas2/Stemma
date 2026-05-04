/**
 * Cross-platform keyboard shortcut bindings.
 * Auto-detects macOS (uses ⌘) vs Linux/Windows (uses Ctrl) for primary modifier.
 */

export const isMac = typeof navigator !== 'undefined' && /Mac|iPod|iPhone|iPad/.test(navigator.platform);
export const primaryKeyLabel = isMac ? '⌘' : 'Ctrl';
export const altKeyLabel = isMac ? '⌥' : 'Alt';
export const shiftKeyLabel = '⇧';

export interface Shortcut {
  /** Lowercase letter or special key name (e.g. 'z', 'k', 'enter'). */
  key: string;
  primary?: boolean;     // ⌘ on Mac / Ctrl elsewhere
  shift?: boolean;
  alt?: boolean;
  description: string;
  handler: (e: KeyboardEvent) => void;
}

export function format(s: Shortcut): string {
  const parts: string[] = [];
  if (s.primary) parts.push(primaryKeyLabel);
  if (s.alt) parts.push(altKeyLabel);
  if (s.shift) parts.push(shiftKeyLabel);
  parts.push(s.key.length === 1 ? s.key.toUpperCase() : s.key);
  return parts.join(isMac ? '' : '+');
}

function eventMatches(s: Shortcut, e: KeyboardEvent): boolean {
  if (e.key.toLowerCase() !== s.key.toLowerCase()) return false;
  const pressedPrimary = isMac ? e.metaKey : e.ctrlKey;
  if (Boolean(s.primary) !== pressedPrimary) return false;
  if (Boolean(s.shift) !== e.shiftKey) return false;
  if (Boolean(s.alt) !== e.altKey) return false;
  return true;
}

/**
 * Mounts a global key listener for the given shortcuts. Returns a teardown.
 */
export function bindShortcuts(shortcuts: Shortcut[]): () => void {
  function onKey(e: KeyboardEvent) {
    // Skip when typing in an input/textarea/contenteditable.
    const target = e.target as HTMLElement | null;
    if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) {
      // Allow undo / redo only — they're useful even in inputs sometimes — except inputs handle them natively.
      // For Spike 03, just bail out entirely from inputs.
      return;
    }
    for (const s of shortcuts) {
      if (eventMatches(s, e)) {
        e.preventDefault();
        s.handler(e);
        return;
      }
    }
  }
  window.addEventListener('keydown', onKey);
  return () => window.removeEventListener('keydown', onKey);
}
