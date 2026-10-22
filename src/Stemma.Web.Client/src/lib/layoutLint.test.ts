import { describe, it, expect } from 'vitest';
import { lintLayout, segmentHitsBox, type RenderGeometry, type GeoNode } from './layoutLint';

const card = (id: string, x: number, y: number, w = 100, h = 50): GeoNode => ({ id, x, y, w, h });
const geo = (g: Partial<RenderGeometry>): RenderGeometry => ({
  nodes: [], edges: [], labels: [], bounds: { x: 0, y: 0, w: 1000, h: 1000 }, ...g,
});
const rules = (g: RenderGeometry) => lintLayout(g).map((f) => f.rule);

describe('segmentHitsBox', () => {
  const box = { x: 10, y: 10, w: 20, h: 20 };
  it('sees a line through the box, and not one beside it', () => {
    expect(segmentHitsBox({ x: 0, y: 20 }, { x: 40, y: 20 }, box)).toBe(true);
    expect(segmentHitsBox({ x: 0, y: 40 }, { x: 40, y: 40 }, box)).toBe(false);
  });
  it('sees a line that ends inside the box', () => {
    expect(segmentHitsBox({ x: 0, y: 20 }, { x: 15, y: 20 }, box)).toBe(true);
  });
});

describe('lintLayout', () => {
  it('finds nothing wrong with a clean chain', () => {
    const g = geo({
      nodes: [card('a', 0, 0), card('b', 200, 0)],
      edges: [{ id: 'ab', source: 'a', target: 'b', points: [{ x: 100, y: 25 }, { x: 200, y: 25 }] }],
      labels: [{ edgeId: 'ab', x: 130, y: 5, w: 40, h: 14 }],
    });
    expect(lintLayout(g)).toEqual([]);
  });

  it('reports two cards on top of each other', () => {
    const g = geo({ nodes: [card('a', 0, 0), card('b', 50, 20)] });
    expect(lintLayout(g)).toEqual([expect.objectContaining({ rule: 'layout/node-overlap', ids: ['a', 'b'], severity: 'warning' })]);
  });

  it('does not count a card inside its frame as an overlap', () => {
    const g = geo({ nodes: [{ ...card('sys', 0, 0, 500, 300), frame: true }, card('a', 50, 60)] });
    expect(lintLayout(g)).toEqual([]);
  });

  it('reports an edge through a card that is not one of its ends', () => {
    const g = geo({
      nodes: [card('a', 0, 0), card('b', 200, 0), card('c', 400, 0)],
      edges: [{ id: 'ac', source: 'a', target: 'c', points: [{ x: 100, y: 25 }, { x: 400, y: 25 }] }],
    });
    expect(lintLayout(g)).toEqual([expect.objectContaining({ rule: 'layout/edge-through-node', ids: ['ac', 'b'] })]);
  });

  it('lets an edge end on its own card', () => {
    const g = geo({
      nodes: [card('a', 0, 0), card('b', 200, 0)],
      edges: [{ id: 'ab', source: 'a', target: 'b', points: [{ x: 50, y: 25 }, { x: 250, y: 25 }] }],
    });
    expect(rules(g)).not.toContain('layout/edge-through-node');
  });

  it('reports labels on top of each other, and a label over a card', () => {
    const g = geo({
      nodes: [card('a', 0, 0), card('b', 300, 0)],
      labels: [
        { edgeId: 'e1', x: 150, y: 100, w: 60, h: 14 },
        { edgeId: 'e2', x: 170, y: 104, w: 60, h: 14 },
        { edgeId: 'e3', x: 80, y: 10, w: 60, h: 14 },
      ],
    });
    const found = lintLayout(g).filter((f) => f.rule === 'layout/label-overlap').map((f) => f.ids);
    expect(found).toEqual([['e1', 'e2'], ['e3', 'a']]);
  });

  it('reports the back edge that vanished along the forward ones (A5)', () => {
    // a → b → c in a row; c → a drawn straight back along the same line.
    const g = geo({
      nodes: [card('a', 0, 0), card('b', 200, 0), card('c', 400, 0)],
      edges: [
        { id: 'ab', source: 'a', target: 'b', points: [{ x: 100, y: 25 }, { x: 200, y: 25 }] },
        { id: 'bc', source: 'b', target: 'c', points: [{ x: 300, y: 25 }, { x: 400, y: 25 }] },
        { id: 'ca', source: 'c', target: 'a', points: [{ x: 400, y: 25 }, { x: 100, y: 25 }] },
      ],
    });
    const found = lintLayout(g);
    expect(found).toContainEqual(expect.objectContaining({ rule: 'layout/edge-through-node', ids: ['ca', 'b'] }));
    expect(found.some((f) => f.rule === 'layout/edge-hidden' && f.ids[0] === 'ca')).toBe(false);
    // The forward edges are short and lie entirely under the long back edge: they are the hidden ones.
    expect(found).toContainEqual(expect.objectContaining({ rule: 'layout/edge-hidden', ids: ['ab', 'ca'] }));
  });

  it('counts crossings, as information until there are more than edges', () => {
    const x = (id: string, a: [number, number], b: [number, number]) => ({ id, source: `${id}s`, target: `${id}t`, points: [{ x: a[0], y: a[1] }, { x: b[0], y: b[1] }] });
    const one = lintLayout(geo({ edges: [x('h', [0, 50], [100, 50]), x('v', [50, 0], [50, 100])] }));
    expect(one).toEqual([expect.objectContaining({ rule: 'layout/crossings', severity: 'info', ids: ['h', 'v'] })]);
    // Three across and three down: nine crossings among six edges.
    const many = lintLayout(geo({ edges: [
      x('h1', [0, 20], [100, 20]), x('h2', [0, 50], [100, 50]), x('h3', [0, 80], [100, 80]),
      x('v1', [20, 0], [20, 100]), x('v2', [50, 0], [50, 100]), x('v3', [80, 0], [80, 100]),
    ] }));
    expect(many.find((f) => f.rule === 'layout/crossings')).toEqual(expect.objectContaining({ severity: 'warning' }));
  });

  it('does not call edges that meet at a shared card a crossing', () => {
    const g = geo({
      edges: [
        { id: 'p', source: 'a', target: 'hub', points: [{ x: 0, y: 0 }, { x: 50, y: 50 }] },
        { id: 'q', source: 'b', target: 'hub', points: [{ x: 100, y: 0 }, { x: 50, y: 50 }] },
      ],
    });
    expect(rules(g)).not.toContain('layout/crossings');
  });
});
