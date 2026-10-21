// F-013 AC7 — the presenter's keys, including what a presentation clicker sends.

import { describe, expect, it } from 'vitest';
import { presenterAction, type PresenterKey } from './presenterKeys';

const press = (key: string, extra: Partial<PresenterKey> = {}) =>
  presenterAction({ key, shiftKey: false, ctrlKey: false, metaKey: false, altKey: false, fromInput: false, ...extra });

describe('presenterAction', () => {
  it('goes forward on the arrows, Space, Enter and a clicker’s PageDown', () => {
    for (const key of ['ArrowRight', 'ArrowDown', 'PageDown', 'Enter', ' ']) expect(press(key)).toBe('next');
  });

  it('goes back on the arrows, Backspace, Shift+Space and a clicker’s PageUp', () => {
    for (const key of ['ArrowLeft', 'ArrowUp', 'PageUp', 'Backspace']) expect(press(key)).toBe('prev');
    expect(press(' ', { shiftKey: true })).toBe('prev');
  });

  it('jumps to either end, stops, and toggles the narrative, the black screen and full screen', () => {
    expect(press('Home')).toBe('first');
    expect(press('End')).toBe('last');
    expect(press('Escape')).toBe('exit');
    expect(press('n')).toBe('narrative');
    expect(press('N')).toBe('narrative');
    expect(press('b')).toBe('blank');
    expect(press('.')).toBe('blank');
    expect(press('f')).toBe('fullscreen');
    expect(press('p')).toBe('console');
  });

  it('leaves chords to the browser and the system', () => {
    expect(press('ArrowRight', { ctrlKey: true })).toBeNull();
    expect(press('r', { metaKey: true })).toBeNull();
    expect(press('ArrowLeft', { altKey: true })).toBeNull();
  });

  it('never turns a page on a key typed into text', () => {
    expect(press('ArrowRight', { fromInput: true })).toBeNull();
    expect(press(' ', { fromInput: true })).toBeNull();
  });

  it('ignores keys it has no use for', () => {
    expect(press('x')).toBeNull();
    expect(press('Delete')).toBeNull();
  });
});
