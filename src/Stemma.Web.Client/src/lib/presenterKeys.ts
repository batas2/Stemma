/**
 * The keys that run a presentation (F-013 AC7).
 *
 * The usual presenter's keys, so that hands that know PowerPoint or Keynote know these: arrows,
 * Space and Enter forward, Backspace back, Home and End, Esc to stop, B to blank the screen. A
 * presentation clicker sends PageUp and PageDown, which is why those are here and why a clicker
 * works with no setup.
 */

export type PresenterAction = 'next' | 'prev' | 'first' | 'last' | 'exit' | 'narrative' | 'blank' | 'fullscreen';

export interface PresenterKey {
  key: string;
  shiftKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  /** The event came from somewhere text is typed, where every key belongs to the text. */
  fromInput: boolean;
}

export function presenterAction(e: PresenterKey): PresenterAction | null {
  // A chord is the browser's or the system's (reload, zoom, switch window), never a page turn.
  if (e.fromInput || e.ctrlKey || e.metaKey || e.altKey) return null;
  switch (e.key) {
    case 'ArrowRight': case 'ArrowDown': case 'PageDown': case 'Enter':
      return 'next';
    case ' ': case 'Spacebar':
      return e.shiftKey ? 'prev' : 'next';
    case 'ArrowLeft': case 'ArrowUp': case 'PageUp': case 'Backspace':
      return 'prev';
    case 'Home': return 'first';
    case 'End': return 'last';
    case 'Escape': return 'exit';
    case 'n': case 'N': return 'narrative';
    // `.` is what most clickers send for their "black screen" button.
    case 'b': case 'B': case '.': return 'blank';
    case 'f': case 'F': return 'fullscreen';
    default: return null;
  }
}

/** Whether a key event's target takes typed text. */
export function isTextTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el || typeof el.tagName !== 'string') return false;
  return el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable;
}
