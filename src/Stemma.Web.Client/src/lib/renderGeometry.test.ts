import { describe, it, expect } from 'vitest';
import { simplify } from './renderGeometry';

describe('simplify', () => {
  it('collapses a sampled straight run to its two ends', () => {
    const run = Array.from({ length: 20 }, (_, i) => ({ x: i * 6, y: 40 }));
    expect(simplify(run)).toEqual([{ x: 0, y: 40 }, { x: 114, y: 40 }]);
  });

  it('keeps the corner of an orthogonal route', () => {
    const route = [{ x: 0, y: 0 }, { x: 0, y: 6 }, { x: 0, y: 12 }, { x: 6, y: 12 }, { x: 12, y: 12 }];
    expect(simplify(route)).toEqual([{ x: 0, y: 0 }, { x: 0, y: 12 }, { x: 12, y: 12 }]);
  });

  it('leaves a two-point line alone', () => {
    expect(simplify([{ x: 0, y: 0 }, { x: 5, y: 5 }])).toEqual([{ x: 0, y: 0 }, { x: 5, y: 5 }]);
  });
});
