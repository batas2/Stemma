// F-013 AC4/AC5 — what a book page keeps lit, and how fast the camera gets there.

import { describe, expect, it } from 'vitest';
import { FRAME_MS, frameDuration, pageLighting } from './bookFrame';
import type { BookPage } from './books';
import type { ArchElement } from './types';

const el = (id: string, contextId: string | null = null, kind: ArchElement['kind'] = 'module'): ArchElement =>
  ({ id, name: id, kind, attributes: { contextId } });

const page = (focus: string[]): BookPage =>
  ({ id: 'p', title: 'P', view: 'moduleMap', narrative: '', focus, frame: focus.length ? 'focus' : 'view', others: 'dim', steps: [] });

describe('pageLighting', () => {
  const elements = [el('bc_sales', null, 'boundedContext'), el('mod_quote', 'bc_sales'), el('mod_basket', 'bc_sales'), el('mod_fares')];

  it('lights everything on a page with no focus', () => {
    expect(pageLighting(page([]), elements)).toBeNull();
  });

  it('keeps the focus lit, and the bounded context it sits in', () => {
    expect(pageLighting(page(['mod_quote']), elements)).toEqual(new Set(['mod_quote', 'bc_sales']));
  });

  it('keeps a focus id lit even when the element is gone, so nothing else lights up in its place', () => {
    expect(pageLighting(page(['mod_gone']), elements)).toEqual(new Set(['mod_gone']));
  });
});

describe('frameDuration', () => {
  it('animates, except under reduced motion or while capturing', () => {
    expect(frameDuration(false, false)).toBe(FRAME_MS);
    expect(frameDuration(true, false)).toBe(0);
    expect(frameDuration(false, true)).toBe(0);
  });
});
