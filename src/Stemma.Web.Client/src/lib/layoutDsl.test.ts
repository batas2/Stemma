import { describe, it, expect } from 'vitest';
import {
  solveConstraint, resolveLayout, offsetForDrag, bakeConstraint,
  constraintIds, danglingIds, isLayoutConstraint,
  FALLBACK_SIZE, type LayoutConstraint, type NodeSize,
} from './layoutDsl';
import { estimateNodeSize, wrappedLineCount, sizesFor, NODE_MIN_WIDTH, NODE_MAX_WIDTH } from './textMetrics';

const sizes: Record<string, NodeSize> = {
  a: { w: 100, h: 40 },
  b: { w: 200, h: 60 },
  c: { w: 150, h: 20 },
  d: { w: 120, h: 80 },
};

describe('solveConstraint — grid', () => {
  const grid: LayoutConstraint = { kind: 'grid', columns: [['a', 'b'], ['c', 'd']], gap: [10, 5] };

  it('places the first cell at the origin so the arrangement can be positioned as a whole', () => {
    expect(solveConstraint(grid, sizes).a).toEqual({ x: 0, y: 0 });
  });

  it('sizes each column to its widest member, not to the first one it saw', () => {
    // The bug this prevents: taking one node's width as the cell width puts a long label
    // underneath its neighbour.
    const s = solveConstraint(grid, sizes);
    expect(s.c.x).toBe(200 + 10);   // widest of column 0 is `b` at 200, plus the gap
  });

  it('sizes each row to its tallest member across all columns', () => {
    const s = solveConstraint(grid, sizes);
    expect(s.b.y).toBe(40 + 5);     // tallest of row 0 is `a` (40) vs `c` (20)
    expect(s.d.y).toBe(40 + 5);
  });

  it('centres cells within their track when asked, and corners them otherwise', () => {
    const centred = solveConstraint({ ...grid, align: 'center' } as LayoutConstraint, sizes);
    expect(centred.a.x).toBe((200 - 100) / 2);
    expect(solveConstraint(grid, sizes).a.x).toBe(0);
  });

  it('tolerates ragged columns rather than assuming a rectangle', () => {
    const ragged: LayoutConstraint = { kind: 'grid', columns: [['a', 'b', 'c'], ['d']], gap: [10, 5] };
    const s = solveConstraint(ragged, sizes);
    expect(Object.keys(s).sort()).toEqual(['a', 'b', 'c', 'd']);
  });

  it('falls back to a default size for a node nothing has measured', () => {
    const s = solveConstraint({ kind: 'grid', columns: [['a', 'unknown']] }, sizes);
    expect(s.unknown).toEqual({ x: 0, y: 40 + 30 });   // default gap Y
    expect(solveConstraint({ kind: 'row', ids: ['unknown'] }, {}).unknown).toEqual({ x: 0, y: 0 });
    expect(FALLBACK_SIZE.w).toBe(180);
  });
});

describe('solveConstraint — row, column, stack', () => {
  it('lays a row left to right at each node own width', () => {
    const s = solveConstraint({ kind: 'row', ids: ['a', 'b', 'c'], gap: 10 }, sizes);
    expect(s.a.x).toBe(0);
    expect(s.b.x).toBe(110);
    expect(s.c.x).toBe(320);
  });

  it('centres a row on the tallest member when asked', () => {
    const s = solveConstraint({ kind: 'row', ids: ['a', 'b'], gap: 10, align: 'center' }, sizes);
    expect(s.a.y).toBe((60 - 40) / 2);
    expect(s.b.y).toBe(0);
  });

  it('lays a column top to bottom', () => {
    const s = solveConstraint({ kind: 'column', ids: ['a', 'b'], gap: 5 }, sizes);
    expect(s.b.y).toBe(45);
  });

  it('offsets a stack by a fixed step', () => {
    const s = solveConstraint({ kind: 'stack', ids: ['a', 'b', 'c'], step: [10, 12] }, sizes);
    expect(s.c).toEqual({ x: 20, y: 24 });
  });
});

describe('resolveLayout', () => {
  const grid: LayoutConstraint = { kind: 'grid', columns: [['a'], ['b']], gap: [10, 5] };

  it('returns stored positions untouched when there is no constraint', () => {
    const stored = { a: { x: 7, y: 9 } };
    expect(resolveLayout({ stored })).toEqual(stored);
  });

  it('applies nudges on top of the solved position', () => {
    const out = resolveLayout({ constraint: grid, offsets: { a: { x: 0, y: 12 } }, sizes });
    expect(out.a).toEqual({ x: 0, y: 12 });
  });

  it('leaves nodes the constraint does not mention exactly where they were', () => {
    // A constraint is allowed to govern part of a diagram; dragging everything else to the origin
    // would be worse than not having one.
    const out = resolveLayout({ constraint: grid, stored: { z: { x: 500, y: 500 } }, sizes });
    expect(out.z).toEqual({ x: 500, y: 500 });
  });

  it('lets the constraint win over a stale stored position for a node it governs', () => {
    const out = resolveLayout({ constraint: grid, stored: { a: { x: 999, y: 999 } }, sizes });
    expect(out.a).toEqual({ x: 0, y: 0 });
  });

  it('translates the whole arrangement by the origin', () => {
    const out = resolveLayout({ constraint: grid, sizes, origin: { x: 100, y: 50 } });
    expect(out.a).toEqual({ x: 100, y: 50 });
    expect(out.b).toEqual({ x: 100 + 110, y: 50 });
  });
});

describe('offsetForDrag', () => {
  const grid: LayoutConstraint = { kind: 'grid', columns: [['a'], ['b']], gap: [10, 5] };

  it('records the delta from the solved slot, not the absolute position', () => {
    // This is what keeps the constraint alive. Storing the absolute would make the first nudge
    // dissolve the grid that aligned everything else, which is what the canvas does today for
    // auto-layouts and is the behaviour this deliberately does not copy.
    expect(offsetForDrag('b', { x: 110, y: 12 }, grid, sizes)).toEqual({ x: 0, y: 12 });
  });

  it('survives a re-solve: the nudge travels with the slot when the arrangement changes', () => {
    const nudge = offsetForDrag('b', { x: 130, y: 12 }, grid, sizes)!;
    const wider: LayoutConstraint = { kind: 'grid', columns: [['a'], ['b']], gap: [40, 5] };
    const after = resolveLayout({ constraint: wider, offsets: { b: nudge }, sizes });
    expect(after.b).toEqual({ x: 100 + 40 + 20, y: 12 });
  });

  it('returns null for a node the constraint does not place', () => {
    expect(offsetForDrag('zz', { x: 0, y: 0 }, grid, sizes)).toBeNull();
  });
});

describe('bakeConstraint', () => {
  it('freezes what is on screen, so removing a constraint moves nothing', () => {
    const grid: LayoutConstraint = { kind: 'grid', columns: [['a'], ['b']], gap: [10, 5] };
    const offsets = { b: { x: 3, y: 4 } };
    const baked = bakeConstraint(grid, offsets, sizes, { z: { x: 1, y: 2 } });
    expect(baked).toEqual(resolveLayout({ constraint: grid, offsets, sizes, stored: { z: { x: 1, y: 2 } } }));
  });
});

describe('constraint inspection', () => {
  it('lists placed ids once, in declaration order', () => {
    expect(constraintIds({ kind: 'grid', columns: [['a', 'b'], ['b', 'c']] })).toEqual(['a', 'b', 'c']);
  });

  it('reports ids that are not in the model, which is a typo nobody can see otherwise', () => {
    expect(danglingIds({ kind: 'row', ids: ['a', 'ghost'] }, ['a', 'b'])).toEqual(['ghost']);
  });

  it('recognises a constraint without trusting arbitrary sidecar JSON', () => {
    expect(isLayoutConstraint({ kind: 'grid', columns: [] })).toBe(true);
    expect(isLayoutConstraint({ kind: 'spiral' })).toBe(false);
    expect(isLayoutConstraint(null)).toBe(false);
    expect(isLayoutConstraint('grid')).toBe(false);
  });
});

describe('estimateNodeSize', () => {
  it('keeps width inside the band the canvas actually draws', () => {
    expect(estimateNodeSize({ name: 'Hi' }).w).toBe(NODE_MIN_WIDTH);
    expect(estimateNodeSize({ name: 'x'.repeat(400) }).w).toBe(NODE_MAX_WIDTH);
  });

  it('grows downwards once the title has to wrap', () => {
    const short = estimateNodeSize({ name: 'Basket' });
    const long = estimateNodeSize({ name: 'The rejected options, written down, at some length' });
    expect(long.h).toBeGreaterThan(short.h);
  });

  it('an explicit width or height wins over the estimate', () => {
    expect(estimateNodeSize({ name: 'Basket', width: 400 }).w).toBe(400);
    expect(estimateNodeSize({ name: 'Basket', height: 500 }).h).toBe(500);
  });

  it('drops the header row when the profile hides it', () => {
    const withHeader = estimateNodeSize({ name: 'Basket', header: true });
    const without = estimateNodeSize({ name: 'Basket', header: false });
    expect(without.h).toBeLessThan(withHeader.h);
  });

  it('counts metadata rows, because they are what makes a card tall in the app profile', () => {
    expect(estimateNodeSize({ name: 'Basket', metaLines: 3 }).h)
      .toBeGreaterThan(estimateNodeSize({ name: 'Basket', metaLines: 0 }).h);
  });
});

describe('wrappedLineCount', () => {
  it('is at least one line even for an empty string', () => {
    expect(wrappedLineCount('', 200)).toBe(1);
  });

  it('counts explicit newlines as their own lines', () => {
    expect(wrappedLineCount('a\nb\nc', 400)).toBe(3);
  });
});

describe('sizesFor', () => {
  it('prefers a real measurement over the estimate', () => {
    // The mixed case is what a headless render hits on first paint, and the layout must not jump
    // once the measurements land.
    const out = sizesFor(
      [{ id: 'a', name: 'Basket' }, { id: 'b', name: 'Checkout' }],
      { a: { w: 999, h: 111 } },
    );
    expect(out.a).toEqual({ w: 999, h: 111 });
    expect(out.b.w).toBe(NODE_MIN_WIDTH);
  });
});
