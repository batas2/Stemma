import { describe, it, expect } from 'vitest';
import {
  buildElkGraph, solveLayered, isLayeredConstraint, layeredOffsetForDrag, labelBox,
  FRAME_PAD, FRAME_HEADER,
  type LayeredInput, type LayeredResult, type Box,
} from './layeredLayout';

// The audit's food-delivery container view (agent-architecture-workflow.md §1): three people, a
// platform of eleven containers, three external systems, seventeen flows. Declared in reading order,
// as an agent writes it.
const card = (id: string, parent?: string) => ({ id, w: 200, h: 76, parent: parent ?? null });
const food: LayeredInput = {
  constraint: { kind: 'layered' },
  nodes: [
    card('per_customer'), card('per_courier'), card('per_restaurant'),
    card('cnt_customer_app'), card('cnt_courier_app'), card('cnt_portal'), card('cnt_gateway'),
    card('cnt_orders'), card('cnt_dispatch'), card('cnt_payments'), card('cnt_notify'), card('cnt_bus'),
    card('cnt_orders_db'), card('cnt_dispatch_db'),
    card('sys_stripe'), card('sys_maps'), card('sys_push'),
  ],
  edges: [
    ['flow_order', 'per_customer', 'cnt_customer_app', 'places order'],
    ['flow_app_gw', 'cnt_customer_app', 'cnt_gateway', 'REST/JSON'],
    ['flow_courier_gw', 'cnt_courier_app', 'cnt_gateway', 'location, status'],
    ['flow_portal_gw', 'cnt_portal', 'cnt_gateway', 'accept/ready'],
    ['flow_gw_orders', 'cnt_gateway', 'cnt_orders', 'order commands'],
    ['flow_gw_dispatch', 'cnt_gateway', 'cnt_dispatch', 'courier updates'],
    ['flow_orders_db', 'cnt_orders', 'cnt_orders_db', 'orders'],
    ['flow_orders_pay', 'cnt_orders', 'cnt_payments', 'charge request'],
    ['flow_pay_stripe', 'cnt_payments', 'sys_stripe', 'payment intent'],
    ['flow_orders_bus', 'cnt_orders', 'cnt_bus', 'OrderPlaced'],
    ['flow_bus_dispatch', 'cnt_bus', 'cnt_dispatch', 'OrderPlaced'],
    ['flow_dispatch_db', 'cnt_dispatch', 'cnt_dispatch_db', 'assignments'],
    ['flow_dispatch_maps', 'cnt_dispatch', 'sys_maps', 'ETA query'],
    ['flow_bus_notify', 'cnt_bus', 'cnt_notify', 'status events'],
    ['flow_notify_push', 'cnt_notify', 'sys_push', 'push'],
    ['flow_courier', 'per_courier', 'cnt_courier_app', 'accepts job'],
    ['flow_rest', 'per_restaurant', 'cnt_portal', 'manages orders'],
  ].map(([id, source, target, label]) => ({ id, source, target, label })),
};

const sizeOf = (input: LayeredInput, id: string) => input.nodes.find((n) => n.id === id)!;
const boxOf = (input: LayeredInput, r: LayeredResult, id: string): Box => {
  const n = sizeOf(input, id);
  return { x: r.positions[id].x, y: r.positions[id].y, w: n.w, h: n.h };
};
const overlap = (a: Box, b: Box) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
/** Shrink a box by a margin: a segment that only touches a card's edge is not through it. */
const inset = (b: Box, m: number): Box => ({ x: b.x + m, y: b.y + m, w: b.w - 2 * m, h: b.h - 2 * m });

/** Whether an axis-aligned segment passes through the interior of a box. */
function segmentCrosses(a: { x: number; y: number }, b: { x: number; y: number }, box: Box): boolean {
  const minX = Math.min(a.x, b.x), maxX = Math.max(a.x, b.x);
  const minY = Math.min(a.y, b.y), maxY = Math.max(a.y, b.y);
  return minX < box.x + box.w && maxX > box.x && minY < box.y + box.h && maxY > box.y;
}

describe('isLayeredConstraint', () => {
  it('accepts the kind and nothing else', () => {
    expect(isLayeredConstraint({ kind: 'layered' })).toBe(true);
    expect(isLayeredConstraint({ kind: 'layered', direction: 'right', spacing: [40, 80] })).toBe(true);
    expect(isLayeredConstraint({ kind: 'grid', columns: [] })).toBe(false);
    expect(isLayeredConstraint(null)).toBe(false);
    expect(isLayeredConstraint('layered')).toBe(false);
  });
});

describe('buildElkGraph', () => {
  it('gives ELK the nodes and edges in the order the model declares them', () => {
    const g = buildElkGraph(food);
    expect(g.children!.map((c) => c.id)).toEqual(food.nodes.map((n) => n.id));
    expect(g.edges!.map((e) => e.id)).toEqual(food.edges.map((e) => e.id));
    expect(g.layoutOptions!['elk.layered.considerModelOrder.strategy']).toBe('NODES_AND_EDGES');
  });

  it('drops an edge whose end is not in the view, and an edge between a node and its own group', () => {
    const g = buildElkGraph({
      constraint: { kind: 'layered' },
      nodes: [card('sys_a'), card('cnt_a', 'sys_a'), card('cnt_b', 'sys_a')],
      edges: [
        { id: 'in_view', source: 'cnt_a', target: 'cnt_b' },
        { id: 'half', source: 'cnt_a', target: 'cnt_missing' },
        { id: 'to_parent', source: 'cnt_a', target: 'sys_a' },
      ],
    });
    expect(g.edges!.map((e) => e.id)).toEqual(['in_view']);
  });

  it('nests children in their group, padded as the canvas pads a frame', () => {
    const g = buildElkGraph({
      constraint: { kind: 'layered' },
      nodes: [card('sys_a'), card('cnt_a', 'sys_a'), card('per_x')],
      edges: [],
    });
    const sys = g.children!.find((c) => c.id === 'sys_a')!;
    expect(sys.children!.map((c) => c.id)).toEqual(['cnt_a']);
    expect(sys.layoutOptions!['elk.padding']).toBe(`[top=${FRAME_PAD + FRAME_HEADER},left=${FRAME_PAD},bottom=${FRAME_PAD},right=${FRAME_PAD}]`);
  });

  it('flattens the groups when asked not to draw them', () => {
    const g = buildElkGraph({
      constraint: { kind: 'layered', groups: false },
      nodes: [card('sys_a'), card('cnt_a', 'sys_a')],
      edges: [],
    });
    expect(g.children!.map((c) => c.id)).toEqual(['sys_a', 'cnt_a']);
  });

  it('maps direction, routing and spacing onto ELK options', () => {
    const g = buildElkGraph({ ...food, constraint: { kind: 'layered', direction: 'right', routing: 'spline', spacing: [30, 90] } });
    expect(g.layoutOptions!['elk.direction']).toBe('RIGHT');
    expect(g.layoutOptions!['elk.edgeRouting']).toBe('SPLINES');
    expect(g.layoutOptions!['elk.spacing.nodeNode']).toBe('30');
    expect(g.layoutOptions!['elk.layered.spacing.nodeNodeBetweenLayers']).toBe('90');
  });

  it('reads a single spacing number as both gaps, and ignores a malformed one', () => {
    const one = buildElkGraph({ ...food, constraint: { kind: 'layered', spacing: 40 } });
    expect(one.layoutOptions!['elk.spacing.nodeNode']).toBe('40');
    expect(one.layoutOptions!['elk.layered.spacing.nodeNodeBetweenLayers']).toBe('40');
    const bad = buildElkGraph({ ...food, constraint: { kind: 'layered', spacing: 'wide' as unknown as number } });
    expect(Number(bad.layoutOptions!['elk.spacing.nodeNode'])).toBeGreaterThan(0);
  });
});

describe('solveLayered', () => {
  it('places every card with no two overlapping', async () => {
    const r = await solveLayered(food);
    const ids = food.nodes.map((n) => n.id);
    for (const id of ids) expect(r.positions[id]).toBeDefined();
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        expect(overlap(boxOf(food, r, ids[i]), boxOf(food, r, ids[j])), `${ids[i]} / ${ids[j]}`).toBe(false);
      }
    }
  });

  it('routes every edge orthogonally and never through a card that is not one of its ends', async () => {
    const r = await solveLayered(food);
    for (const e of food.edges) {
      const route = r.routes[e.id];
      expect(route, e.id).toBeDefined();
      expect(route.points.length).toBeGreaterThanOrEqual(2);
      for (let i = 0; i < route.points.length - 1; i++) {
        const a = route.points[i], b = route.points[i + 1];
        expect(Math.abs(a.x - b.x) < 0.01 || Math.abs(a.y - b.y) < 0.01, `${e.id} segment ${i}`).toBe(true);
        for (const n of food.nodes) {
          if (n.id === e.source || n.id === e.target) continue;
          expect(segmentCrosses(a, b, inset(boxOf(food, r, n.id), 1)), `${e.id} through ${n.id}`).toBe(false);
        }
      }
    }
  });

  it('places each label clear of every card', async () => {
    const r = await solveLayered(food);
    for (const e of food.edges) {
      const label = r.routes[e.id].label;
      expect(label, e.id).toBeDefined();
      for (const n of food.nodes) expect(overlap(inset(label!, 1), boxOf(food, r, n.id)), `${e.id} label over ${n.id}`).toBe(false);
    }
  });

  it('gives the same picture twice', async () => {
    const a = await solveLayered(food);
    const b = await solveLayered(food);
    expect(b).toEqual(a);
  });

  it('follows the flow: an edge goes down a layer', async () => {
    const r = await solveLayered(food);
    expect(r.positions.cnt_gateway.y).toBeGreaterThan(r.positions.cnt_customer_app.y);
    expect(r.positions.cnt_orders.y).toBeGreaterThan(r.positions.cnt_gateway.y);
  });

  it('runs left to right when asked', async () => {
    const r = await solveLayered({ ...food, constraint: { kind: 'layered', direction: 'right' } });
    expect(r.positions.cnt_gateway.x).toBeGreaterThan(r.positions.cnt_customer_app.x);
  });

  it('pins `first` and `last` to the outer layers', async () => {
    const r = await solveLayered({ ...food, constraint: { kind: 'layered', last: ['sys_stripe', 'sys_maps', 'sys_push'] } });
    const deepest = Math.max(...food.nodes.map((n) => r.positions[n.id].y));
    for (const id of ['sys_stripe', 'sys_maps', 'sys_push']) expect(r.positions[id].y).toBe(deepest);
  });

  it('keeps a group around its children, with room for the frame header', async () => {
    const input: LayeredInput = {
      constraint: { kind: 'layered' },
      nodes: [card('per_x'), card('sys_a'), card('cnt_a', 'sys_a'), card('cnt_b', 'sys_a'), card('sys_ext')],
      edges: [
        { id: 'e1', source: 'per_x', target: 'cnt_a' },
        { id: 'e2', source: 'cnt_a', target: 'cnt_b' },
        { id: 'e3', source: 'cnt_b', target: 'sys_ext' },
      ],
    };
    const r = await solveLayered(input);
    const frame = r.frames.sys_a;
    expect(frame).toBeDefined();
    for (const id of ['cnt_a', 'cnt_b']) {
      const b = boxOf(input, r, id);
      expect(b.x).toBeGreaterThanOrEqual(frame.x + FRAME_PAD - 0.5);
      expect(b.y).toBeGreaterThanOrEqual(frame.y + FRAME_PAD + FRAME_HEADER - 0.5);
      expect(b.x + b.w).toBeLessThanOrEqual(frame.x + frame.w - FRAME_PAD + 0.5);
      expect(b.y + b.h).toBeLessThanOrEqual(frame.y + frame.h - FRAME_PAD + 0.5);
    }
    expect(overlap(boxOf(input, r, 'per_x'), frame)).toBe(false);
    expect(overlap(boxOf(input, r, 'sys_ext'), frame)).toBe(false);
  });

  it('draws a back edge where it can be seen, not along the forward ones', async () => {
    // The audit's A5: c → a in a chain a → b → c vanished under b.
    const input: LayeredInput = {
      constraint: { kind: 'layered' },
      nodes: [card('a'), card('b'), card('c')],
      edges: [
        { id: 'ab', source: 'a', target: 'b' }, { id: 'bc', source: 'b', target: 'c' },
        { id: 'ca', source: 'c', target: 'a', label: 'c uses a' },
      ],
    };
    const r = await solveLayered(input);
    for (const p of r.routes.ca.points.slice(1, -1)) {
      expect(segmentCrosses(p, p, inset(boxOf(input, r, 'b'), 1))).toBe(false);
    }
    expect(overlap(r.routes.ca.label!, boxOf(input, r, 'b'))).toBe(false);
  });
});

describe('layeredOffsetForDrag', () => {
  it('records where a card was dropped relative to where the layout put it', () => {
    const solved: LayeredResult = { positions: { a: { x: 100, y: 40 } }, frames: {}, routes: {} };
    expect(layeredOffsetForDrag('a', { x: 112, y: 30 }, solved)).toEqual({ x: 12, y: -10 });
    expect(layeredOffsetForDrag('missing', { x: 0, y: 0 }, solved)).toBeNull();
  });
});

describe('labelBox', () => {
  it('grows with the text and the type size', () => {
    expect(labelBox('a longer label', 10).w).toBeGreaterThan(labelBox('short', 10).w);
    expect(labelBox('short', 13).h).toBeGreaterThan(labelBox('short', 10).h);
  });
});
