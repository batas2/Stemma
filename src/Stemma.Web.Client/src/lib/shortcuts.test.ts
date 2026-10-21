import { describe, expect, it } from 'vitest';
import { eventMatches, isMac, type Shortcut } from './shortcuts';

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
