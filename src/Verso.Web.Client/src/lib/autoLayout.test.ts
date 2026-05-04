import { describe, it, expect } from 'vitest';
import { alignSelected, distributeSelected, type NodeBounds } from './autoLayout';

// Three boxes of different widths to make the difference between top-left
// alignment (the old buggy behaviour) and edge alignment visible.
//   a: x=0,   w=100   → left=0,    right=100,  centerX=50
//   b: x=50,  w=200   → left=50,   right=250,  centerX=150
//   c: x=120, w=80    → left=120,  right=200,  centerX=160
const sample: Record<string, NodeBounds> = {
  a: { x: 0,   y: 10, w: 100, h: 40 },
  b: { x: 50,  y: 60, w: 200, h: 60 },
  c: { x: 120, y: 30, w: 80,  h: 40 },
};

describe('alignSelected', () => {
  it('left-aligns to the leftmost left edge', () => {
    const out = alignSelected(sample, ['a', 'b', 'c'], 'left');
    expect(out.a.x).toBe(0);
    expect(out.b.x).toBe(0);
    expect(out.c.x).toBe(0);
    // y untouched
    expect(out.a.y).toBe(10);
    expect(out.b.y).toBe(60);
    expect(out.c.y).toBe(30);
  });

  it('right-aligns to the rightmost right edge — uses width', () => {
    const out = alignSelected(sample, ['a', 'b', 'c'], 'right');
    // rightmost right edge is b at x=50+200=250.
    // Each node's new x = 250 - its width.
    expect(out.a.x).toBe(250 - 100); // 150
    expect(out.b.x).toBe(250 - 200); // 50
    expect(out.c.x).toBe(250 - 80);  // 170
  });

  it('centerX averages centres and re-anchors top-left', () => {
    const out = alignSelected(sample, ['a', 'b', 'c'], 'centerX');
    // centres: 50, 150, 160 → average = 120
    expect(out.a.x).toBe(120 - 50);   // 70
    expect(out.b.x).toBe(120 - 100);  // 20
    expect(out.c.x).toBe(120 - 40);   // 80
    // After alignment each centre equals 120.
    expect(out.a.x + sample.a.w / 2).toBe(120);
    expect(out.b.x + sample.b.w / 2).toBe(120);
    expect(out.c.x + sample.c.w / 2).toBe(120);
  });

  it('top / bottom / centerY behave the same on the y axis', () => {
    const top = alignSelected(sample, ['a', 'b', 'c'], 'top');
    expect(top.a.y).toBe(10);
    expect(top.b.y).toBe(10);
    expect(top.c.y).toBe(10);

    const bottom = alignSelected(sample, ['a', 'b', 'c'], 'bottom');
    // bottoms: a=50, b=120, c=70 → 120 max. New y = 120 - h.
    expect(bottom.a.y).toBe(120 - 40); // 80
    expect(bottom.b.y).toBe(120 - 60); // 60
    expect(bottom.c.y).toBe(120 - 40); // 80

    const cy = alignSelected(sample, ['a', 'b', 'c'], 'centerY');
    // centres: a=30, b=90, c=50 → avg = 56.6…
    const target = (30 + 90 + 50) / 3;
    expect(cy.a.y).toBeCloseTo(target - 20);
    expect(cy.b.y).toBeCloseTo(target - 30);
    expect(cy.c.y).toBeCloseTo(target - 20);
  });

  it('leaves non-selected nodes alone', () => {
    const out = alignSelected(sample, ['a', 'c'], 'left');
    expect(out.b.x).toBe(50);
    expect(out.b.y).toBe(60);
  });

  it('is a no-op when fewer than 2 selected', () => {
    const out = alignSelected(sample, ['a'], 'right');
    expect(out.a.x).toBe(0);
  });
});

describe('distributeSelected', () => {
  it('distributes centres evenly between outermost selected centres', () => {
    // Three boxes with centres 50, 150, 160 along x. After distribute:
    // - first centre stays at 50
    // - last centre stays at 160
    // - middle centre moves to (50 + 160) / 2 = 105
    const out = distributeSelected(sample, ['a', 'b', 'c'], 'horizontal');
    // a is leftmost (centre 50), c is rightmost (centre 160), b is the middle.
    expect(out.a.x + sample.a.w / 2).toBeCloseTo(50);
    expect(out.c.x + sample.c.w / 2).toBeCloseTo(160);
    expect(out.b.x + sample.b.w / 2).toBeCloseTo(105);
  });

  it('returns positions unchanged for fewer than 3 nodes', () => {
    const out = distributeSelected(sample, ['a', 'b'], 'horizontal');
    expect(out.a.x).toBe(0);
    expect(out.b.x).toBe(50);
  });
});
