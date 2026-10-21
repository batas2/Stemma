// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { eventMatches, focusIsOnCanvas, isMac, keyBelongsToFocus, type Shortcut } from './shortcuts';

const press = (over: Partial<KeyboardEvent>) => ({
  key: '', code: '', metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, ...over,
} as Pick<KeyboardEvent, 'key' | 'code' | 'metaKey' | 'ctrlKey' | 'shiftKey' | 'altKey'>);
const primary = isMac ? { metaKey: true } : { ctrlKey: true };
const shortcut = (s: Partial<Shortcut>): Shortcut => ({ key: '', description: '', handler: () => {}, ...s });

describe('eventMatches', () => {
  it('matches a letter with the primary modifier', () => {
    expect(eventMatches(shortcut({ key: 'c', primary: true }), press({ key: 'c', code: 'KeyC', ...primary }))).toBe(true);
    expect(eventMatches(shortcut({ key: 'c', primary: true }), press({ key: 'c', code: 'KeyC' }))).toBe(false);
  });

  it('matches ⌥ bindings by the physical key, whatever character ⌥ makes it type', () => {
    const copyStyle = shortcut({ key: 'c', code: 'KeyC', primary: true, alt: true });
    // ⌥⌘C on a Mac keyboard reports "ç".
    expect(eventMatches(copyStyle, press({ key: 'ç', code: 'KeyC', altKey: true, ...primary }))).toBe(true);
    // Plain ⌘C is not ⌥⌘C.
    expect(eventMatches(copyStyle, press({ key: 'c', code: 'KeyC', ...primary }))).toBe(false);
  });

  it('keeps ⌘C and ⌥⌘C apart', () => {
    const copy = shortcut({ key: 'c', primary: true });
    expect(eventMatches(copy, press({ key: 'ç', code: 'KeyC', altKey: true, ...primary }))).toBe(false);
  });
});

describe('keys that belong to what has focus', () => {
  const on = (html: string, selector: string) => {
    document.body.innerHTML = html;
    return document.querySelector(selector) as HTMLElement;
  };

  it('a field, a list and a dialog keep every key', () => {
    expect(keyBelongsToFocus({ key: 'z', target: on('<input>', 'input') })).toBe(true);
    expect(keyBelongsToFocus({ key: 'ArrowDown', target: on('<select><option>a</option></select>', 'select') })).toBe(true);
    expect(keyBelongsToFocus({ key: 'Tab', target: on('<div role="dialog" aria-modal="true"><button>Cancel</button></div>', 'button') })).toBe(true);
  });

  it('a button keeps Tab and the arrows, but not the app\'s letters', () => {
    const button = on('<header><button>Theme</button></header>', 'button');
    expect(keyBelongsToFocus({ key: 'Tab', target: button })).toBe(true);
    expect(keyBelongsToFocus({ key: 'ArrowLeft', target: button })).toBe(true);
    expect(keyBelongsToFocus({ key: '2', target: button })).toBe(false);
  });

  it('on the canvas the app\'s keys apply, even on a button inside a box', () => {
    const inBox = on('<div class="react-flow"><div class="react-flow__node"><button>collapse</button></div></div>', 'button');
    expect(keyBelongsToFocus({ key: 'Tab', target: inBox })).toBe(false);
    expect(keyBelongsToFocus({ key: 'ArrowUp', target: inBox })).toBe(false);
  });

  it('Tab walks the boxes only while focus is on the canvas', () => {
    const box = on('<div class="react-flow"><div class="react-flow__node" tabindex="0"></div></div><button>Theme</button>', '.react-flow__node');
    box.focus();
    expect(focusIsOnCanvas()).toBe(true);
    (document.querySelector('button') as HTMLElement).focus();
    expect(focusIsOnCanvas()).toBe(false);
    (document.activeElement as HTMLElement).blur();
    expect(focusIsOnCanvas()).toBe(false);
  });
});
