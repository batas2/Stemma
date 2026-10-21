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

/** Keys a focused control uses itself: Tab moves focus, arrows move within it, Enter and Space press it. */
const CONTROL_KEYS = new Set(['tab', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright', 'enter', ' ', 'home', 'end']);
const CONTROLS = 'button, a[href], select, summary, [role="button"], [role="tab"], [role="tablist"], [role="menu"], [role="menuitem"], [role="option"], [role="listbox"], [role="slider"], [role="switch"], [role="checkbox"], [role="radio"]';

/**
 * Whether a key belongs to what has focus rather than to the app. A field takes every key (⌘Z undoes
 * typing, ⌘C copies text); an open dialog takes every key, so nothing changes behind it; a button, a
 * tab or a menu takes the keys it is operated with. Before this, Tab changed the selected box wherever
 * focus was — focus never moved, and the dialog's Cancel could not be reached — and the arrows nudged a
 * box while a list's value was being picked.
 */
export function keyBelongsToFocus(e: Pick<KeyboardEvent, 'key' | 'target'>): boolean {
  const target = e.target as HTMLElement | null;
  if (!target || typeof target.closest !== 'function') return false;
  if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable) return true;
  if (typeof document !== 'undefined' && document.querySelector('[aria-modal="true"]')) return true;
  if (target.closest('[role="dialog"], [role="alertdialog"]')) return true;
  // The canvas is where the app's own keys are meant: a focused box still nudges and Tab still walks.
  if (target.closest('.react-flow')) return false;
  return CONTROL_KEYS.has(e.key.toLowerCase()) && !!target.closest(CONTROLS);
}

/**
 * Whether focus is on the canvas (a box, an arrow, the canvas itself, or nothing in particular). Tab walks
 * the boxes only then; anywhere else it moves focus, as it does on every other page.
 */
export function focusIsOnCanvas(): boolean {
  if (typeof document === 'undefined') return false;
  const active = document.activeElement as HTMLElement | null;
  if (!active || active === document.body) return false;
  return active.id === 'stemma-canvas' || !!active.closest?.('.react-flow');
}

/**
 * Mounts a global key listener for the given shortcuts. Returns a teardown.
 */
export function bindShortcuts(shortcuts: Shortcut[]): () => void {
  function onKey(e: KeyboardEvent) {
    if (keyBelongsToFocus(e)) return;
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
  palette: hint({ key: 'k', primary: true }),
  undo: hint({ key: 'z', primary: true }),
  copy: hint({ key: 'c', primary: true }),
  paste: hint({ key: 'v', primary: true }),
  duplicate: hint({ key: 'd', primary: true }),
  copyStyle: hint({ key: 'c', primary: true, alt: true }),
  pasteStyle: hint({ key: 'v', primary: true, alt: true }),
  find: hint({ key: 'f', primary: true }),
  back: hint({ key: '[', primary: true }),
  forward: hint({ key: ']', primary: true }),
};
