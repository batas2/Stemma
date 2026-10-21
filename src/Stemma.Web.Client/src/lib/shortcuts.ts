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
  /**
   * The physical key (`KeyC`), matched instead of `key` when given. ⌥ changes the character a key
   * types — ⌥C is "ç" on a Mac keyboard — so a binding with ⌥ in it has to name the key, not the letter.
   */
  code?: string;
  primary?: boolean;     // ⌘ on Mac / Ctrl elsewhere
  shift?: boolean;
  alt?: boolean;
  /** Bound only while this holds; otherwise the key does what it would have done (e.g. copy selected text). */
  when?: () => boolean;
  description: string;
  handler: (e: KeyboardEvent) => void;
}

export function format(s: Shortcut): string {
  const parts: string[] = [];
  // Each platform's own order: ⌥⇧⌘C on a Mac, Ctrl+Alt+Shift+C elsewhere.
  if (isMac) {
    if (s.alt) parts.push(altKeyLabel);
    if (s.shift) parts.push(shiftKeyLabel);
    if (s.primary) parts.push(primaryKeyLabel);
  } else {
    if (s.primary) parts.push(primaryKeyLabel);
    if (s.alt) parts.push(altKeyLabel);
    if (s.shift) parts.push(shiftKeyLabel);
  }
  parts.push(s.key.length === 1 ? s.key.toUpperCase() : s.key);
  return parts.join(isMac ? '' : '+');
}

export function eventMatches(s: Shortcut, e: Pick<KeyboardEvent, 'key' | 'code' | 'metaKey' | 'ctrlKey' | 'shiftKey' | 'altKey'>): boolean {
  if (s.code ? e.code !== s.code : e.key.toLowerCase() !== s.key.toLowerCase()) return false;
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
      // A field handles its own keys: ⌘Z undoes typing, ⌘C copies text.
      return;
    }
    for (const s of shortcuts) {
      if (eventMatches(s, e) && (!s.when || s.when())) {
        e.preventDefault();
        s.handler(e);
        return;
      }
    }
  }
  window.addEventListener('keydown', onKey);
  return () => window.removeEventListener('keydown', onKey);
}

/** True while text is selected on the page — then ⌘C copies that text, as it does everywhere else. */
export function hasTextSelection(): boolean {
  if (typeof window === 'undefined') return false;
  const sel = window.getSelection?.();
  return !!sel && !sel.isCollapsed && sel.toString().trim().length > 0;
}

const hint = (s: Pick<Shortcut, 'key' | 'primary' | 'shift' | 'alt'>) => format({ ...s, description: '', handler: () => {} });

/** The shortcuts menus print beside their items, written once so a menu and the sheet cannot disagree. */
export const SHORTCUT_HINTS = {
  copy: hint({ key: 'c', primary: true }),
  paste: hint({ key: 'v', primary: true }),
  duplicate: hint({ key: 'd', primary: true }),
  copyStyle: hint({ key: 'c', primary: true, alt: true }),
  pasteStyle: hint({ key: 'v', primary: true, alt: true }),
  find: hint({ key: 'f', primary: true }),
  back: hint({ key: '[', primary: true }),
  forward: hint({ key: ']', primary: true }),
};
