import { describe, it, expect } from 'vitest';
import { knockoutRects, KNOCKOUT_INSET } from './edgeKnockout';

describe('knockoutRects', () => {
  it('cuts each card, a little inside its outline so arrowheads keep their tips', () => {
    const [r] = knockoutRects([{ id: 'a', x: 10, y: 20, w: 200, h: 80 }]);
    expect(r).toEqual({ id: 'a', x: 10 + KNOCKOUT_INSET, y: 20 + KNOCKOUT_INSET, w: 200 - 2 * KNOCKOUT_INSET, h: 80 - 2 * KNOCKOUT_INSET });
  });

  it('leaves frames alone: a line crossing into a boundary is meant to be seen', () => {
    expect(knockoutRects([{ id: 'ctx', x: 0, y: 0, w: 600, h: 400, frame: true }])).toEqual([]);
  });

  it('skips a card too small to cut', () => {
    expect(knockoutRects([{ id: 'tiny', x: 0, y: 0, w: 4, h: 4 }])).toEqual([]);
  });
});
