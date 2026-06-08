import { describe, it, expect } from 'vitest';
import { autoDock, dotFacing, type DockRect } from './edgeDock';

const box = (x: number, y: number, w = 200, h = 100): DockRect => ({ x, y, w, h });

describe('dotFacing', () => {
  const b = box(0, 0, 200, 100);
  it('picks the right dot when the target is to the right', () => {
    expect(dotFacing(b, { x: 1000, y: 50 })).toBe('r');
  });
  it('picks the left dot when the target is to the left', () => {
    expect(dotFacing(b, { x: -1000, y: 50 })).toBe('l');
  });
  it('picks a bottom dot when the target is below, side chosen by horizontal lean', () => {
    expect(dotFacing(b, { x: 30, y: 1000 })).toBe('b1');   // leans left
    expect(dotFacing(b, { x: 180, y: 1000 })).toBe('b2');  // leans right
  });
  it('picks a top dot when the target is above', () => {
    expect(dotFacing(b, { x: 30, y: -1000 })).toBe('t1');
    expect(dotFacing(b, { x: 180, y: -1000 })).toBe('t2');
  });
});

describe('autoDock', () => {
  it('two side-by-side boxes dock right→left', () => {
    const { source, target } = autoDock(box(0, 0), box(600, 0));
    expect(source).toBe('r');
    expect(target).toBe('l');
  });
  it('a box above another docks bottom→top', () => {
    const { source, target } = autoDock(box(0, 0), box(0, 600));
    expect(source.startsWith('b')).toBe(true);
    expect(target.startsWith('t')).toBe(true);
  });
});
