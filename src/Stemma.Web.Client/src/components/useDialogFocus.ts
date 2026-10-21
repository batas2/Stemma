import { useEffect, type RefObject } from 'react';

const FOCUSABLE = 'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [contenteditable="true"], [tabindex]:not([tabindex="-1"])';

/**
 * Keep keyboard focus inside a modal while it is open, and give it back to where it was when it
 * closes. Done on `focusin` rather than by catching Tab, because an editor inside the window keeps its
 * keys to itself: whatever moves focus out, it comes back in — to the last control when going backwards,
 * the first otherwise.
 */
export function useDialogFocus(ref: RefObject<HTMLElement | null>, open: boolean): void {
  useEffect(() => {
    if (!open) return;
    const returnTo = document.activeElement as HTMLElement | null;
    let backwards = false;
    function onKey(e: KeyboardEvent) { if (e.key === 'Tab') backwards = e.shiftKey; }
    function onFocusIn(e: FocusEvent) {
      const box = ref.current;
      if (!box || box.contains(e.target as Node)) return;
      const items = [...box.querySelectorAll<HTMLElement>(FOCUSABLE)];
      (backwards ? items[items.length - 1] : items[0])?.focus() ?? box.focus();
    }
    document.addEventListener('keydown', onKey, true);
    document.addEventListener('focusin', onFocusIn);
    return () => {
      document.removeEventListener('keydown', onKey, true);
      document.removeEventListener('focusin', onFocusIn);
      if (returnTo && returnTo.isConnected) returnTo.focus({ preventScroll: true });
    };
  }, [open, ref]);
}
