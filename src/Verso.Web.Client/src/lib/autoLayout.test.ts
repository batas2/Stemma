import { describe, it, expect } from 'vitest';
import {
  alignSelected, distributeSelected, layoutC4HubAndSpoke,
  layoutHierarchical, layoutForceDirected, layoutFocused, layoutByType,
  type NodeBounds,
} from './autoLayout';
import type { ArchElement, ArchLink } from './types';

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

describe('layoutC4HubAndSpoke', () => {
  function el(id: string, kind: ArchElement['kind'], attrs: Record<string, string | null> = {}): ArchElement {
    return { id, name: id, kind, attributes: attrs };
  }

  it('places persons above the centre line', () => {
    const out = layoutC4HubAndSpoke([
      el('per_a', 'person'),
      el('sys_main', 'softwareSystem'),
    ], []);
    expect(out.per_a.y).toBeLessThan(out.sys_main.y);
  });

  it('separates external systems from internal ones horizontally', () => {
    const out = layoutC4HubAndSpoke([
      el('sys_main', 'softwareSystem'),
      el('sys_ext1', 'softwareSystem', { external: 'true' }),
      el('sys_ext2', 'softwareSystem', { external: 'true' }),
    ], []);
    // Internal stays near centre; externals push outward.
    expect(Math.abs(out.sys_main.x)).toBeLessThan(Math.abs(out.sys_ext1.x));
  });

  it('stacks containers under their parent system when systemId is set', () => {
    const out = layoutC4HubAndSpoke([
      el('sys_main', 'softwareSystem'),
      el('cnt_a', 'container', { systemId: 'sys_main' }),
      el('cnt_b', 'container', { systemId: 'sys_main' }),
    ], []);
    expect(out.cnt_a.x).toBe(out.sys_main.x);
    expect(out.cnt_b.x).toBe(out.sys_main.x);
    expect(out.cnt_a.y).toBeGreaterThan(out.sys_main.y);
    expect(out.cnt_b.y).toBeGreaterThan(out.cnt_a.y);
  });

  it('is deterministic — same input → same output', () => {
    const input: ArchElement[] = [
      el('per_a', 'person'),
      el('sys_main', 'softwareSystem'),
      el('sys_ext1', 'softwareSystem', { external: 'true' }),
    ];
    const a = layoutC4HubAndSpoke(input, []);
    const b = layoutC4HubAndSpoke(input, []);
    expect(a).toEqual(b);
  });
});

// ---------- Hierarchical (Sugiyama) ----------

function el(id: string, kind: ArchElement['kind'], attrs: Record<string, string | null> = {}): ArchElement {
  return { id, name: id, kind, attributes: attrs };
}

function link(id: string, fromId: string, toId: string, kind: 'dataFlow' | 'dependency' = 'dependency'): ArchLink {
  return { id, fromId, toId, kind, attributes: {} };
}

describe('layoutHierarchical', () => {
  it('places persons above systems above bounded contexts above modules', () => {
    const out = layoutHierarchical([
      el('per_a', 'person'),
      el('sys_a', 'softwareSystem'),
      el('bc_a', 'boundedContext'),
      el('mod_a', 'module', { contextId: 'bc_a' }),
    ], []);
    expect(out.per_a.y).toBeLessThan(out.sys_a.y);
    expect(out.sys_a.y).toBeLessThan(out.bc_a.y);
    expect(out.bc_a.y).toBeLessThan(out.mod_a.y);
  });

  it('reduces crossings — modules ordered to follow their dependencies', () => {
    // Two modules pointing into two capabilities. Without ordering, m1→c2 and m2→c1 cross.
    // After Sugiyama, the order should align so they don't cross.
    const elements = [
      el('m1', 'module'),
      el('m2', 'module'),
      el('c1', 'capability'),
      el('c2', 'capability'),
    ];
    const links = [link('l1', 'm1', 'c1'), link('l2', 'm2', 'c2')];
    const out = layoutHierarchical(elements, links);
    // m1 should sit on the same side as c1; m2 on the same side as c2.
    const sameSide = (out.m1.x < out.m2.x) === (out.c1.x < out.c2.x);
    expect(sameSide).toBe(true);
  });

  it('groups modules of the same Bounded Context near each other on their layer', () => {
    const elements = [
      el('bc_a', 'boundedContext'),
      el('bc_b', 'boundedContext'),
      el('m_a1', 'module', { contextId: 'bc_a' }),
      el('m_a2', 'module', { contextId: 'bc_a' }),
      el('m_b1', 'module', { contextId: 'bc_b' }),
    ];
    const out = layoutHierarchical(elements, []);
    // Module ordering on the module layer: BC-A's two modules adjacent (no BC-B between them).
    const moduleX = [
      ['m_a1', out.m_a1.x],
      ['m_a2', out.m_a2.x],
      ['m_b1', out.m_b1.x],
    ].sort((a, b) => (a[1] as number) - (b[1] as number)).map(([id]) => id);
    const aIdx1 = moduleX.indexOf('m_a1');
    const aIdx2 = moduleX.indexOf('m_a2');
    expect(Math.abs(aIdx1 - aIdx2)).toBe(1);
  });

  it('returns empty for empty input', () => {
    expect(layoutHierarchical([], [])).toEqual({});
  });
});

// ---------- Force-directed (Fruchterman–Reingold) ----------

describe('layoutForceDirected', () => {
  it('positions every input element', () => {
    const out = layoutForceDirected([
      el('a', 'module'), el('b', 'module'), el('c', 'module'),
    ], [link('l', 'a', 'b')], {}, { iterations: 50 });
    expect(Object.keys(out).sort()).toEqual(['a', 'b', 'c']);
    for (const v of Object.values(out)) {
      expect(Number.isFinite(v.x) && Number.isFinite(v.y)).toBe(true);
    }
  });

  it('connected nodes end closer than disconnected ones', () => {
    // A linked pair (a—b) and an isolated node c. After simulation, |a-b| < |a-c|.
    const elements = [el('a', 'module'), el('b', 'module'), el('c', 'module')];
    const links = [link('l', 'a', 'b')];
    const out = layoutForceDirected(elements, links);
    const dist = (p: { x: number; y: number }, q: { x: number; y: number }) =>
      Math.hypot(p.x - q.x, p.y - q.y);
    expect(dist(out.a, out.b)).toBeLessThan(dist(out.a, out.c));
  });

  it('clusters elements that share a BoundedContext', () => {
    const elements = [
      el('a1', 'module', { contextId: 'bc_a' }),
      el('a2', 'module', { contextId: 'bc_a' }),
      el('b1', 'module', { contextId: 'bc_b' }),
      el('b2', 'module', { contextId: 'bc_b' }),
    ];
    const out = layoutForceDirected(elements, []);
    const dist = (p: { x: number; y: number }, q: { x: number; y: number }) =>
      Math.hypot(p.x - q.x, p.y - q.y);
    // Same-context pair should be closer than cross-context pairs on average.
    const intra = (dist(out.a1, out.a2) + dist(out.b1, out.b2)) / 2;
    const inter = (dist(out.a1, out.b1) + dist(out.a2, out.b2)) / 2;
    expect(intra).toBeLessThan(inter);
  });

  it('produces no overlapping boxes — final AABB sweep guarantees it', () => {
    // Dense clique: every pair connected. Without AABB-aware repulsion + collision
    // resolution, the symmetric pulls collapse the centres and boxes overlap.
    const elements = ['a', 'b', 'c', 'd', 'e'].map((id) => el(id, 'module'));
    const links: ArchLink[] = [];
    let i = 0;
    for (let p = 0; p < elements.length; p++) {
      for (let q = p + 1; q < elements.length; q++) {
        links.push(link(`l${i++}`, elements[p].id, elements[q].id));
      }
    }
    const out = layoutForceDirected(elements, links, {}, {
      sizes: Object.fromEntries(elements.map((e) => [e.id, { w: 220, h: 100 }])),
      padding: 30,
    });
    for (let p = 0; p < elements.length; p++) {
      for (let q = p + 1; q < elements.length; q++) {
        const a = out[elements[p].id], b = out[elements[q].id];
        const overlapX = 220 - Math.abs(a.x - b.x);
        const overlapY = 100 - Math.abs(a.y - b.y);
        // Boxes don't overlap if they're separated on at least one axis.
        expect(overlapX <= 0 || overlapY <= 0).toBe(true);
      }
    }
  });

  it('keeps disconnected nodes near the rest of the graph (no infinite drift)', () => {
    // Three disconnected nodes with no links and no shared context. With pure FR
    // repulsion they fly outward; gravity is what keeps the layout finite.
    const elements = [el('a', 'module'), el('b', 'module'), el('c', 'module')];
    const out = layoutForceDirected(elements, []);
    // Compute centroid; every node should be within a sane radius of it. The bound
    // is generous because we mainly want to assert "not at infinity", not a precise
    // distance — k for n=3 ≈ 540, so 5×k ≈ 2700 is the practical drift cap.
    const cx = (out.a.x + out.b.x + out.c.x) / 3;
    const cy = (out.a.y + out.b.y + out.c.y) / 3;
    for (const id of ['a', 'b', 'c'] as const) {
      const r = Math.hypot(out[id].x - cx, out[id].y - cy);
      expect(r).toBeLessThan(2000);
    }
  });

  it('respects per-node sizes — larger boxes end up further apart', () => {
    // Two pairs, both fully connected within. Pair A has small boxes, pair B large ones.
    // After layout, the centre-to-centre distance of pair B should exceed pair A's.
    const small = [el('s1', 'module'), el('s2', 'module')];
    const big = [el('b1', 'module'), el('b2', 'module')];
    const sizes = {
      s1: { w: 80, h: 40 }, s2: { w: 80, h: 40 },
      b1: { w: 320, h: 160 }, b2: { w: 320, h: 160 },
    };
    const outSmall = layoutForceDirected(small, [link('ls', 's1', 's2')], {}, { sizes });
    const outBig = layoutForceDirected(big, [link('lb', 'b1', 'b2')], {}, { sizes });
    const dist = (p: { x: number; y: number }, q: { x: number; y: number }) =>
      Math.hypot(p.x - q.x, p.y - q.y);
    expect(dist(outBig.b1, outBig.b2)).toBeGreaterThan(dist(outSmall.s1, outSmall.s2));
  });
});

// ---------- Focus-around-entity ----------

describe('layoutFocused', () => {
  it('places the focused element at the origin', () => {
    const out = layoutFocused('focus', [
      el('focus', 'module'),
      el('a', 'module'),
    ], [link('l', 'focus', 'a')]);
    expect(out.focus).toEqual({ x: 0, y: 0 });
  });

  it('puts direct neighbours closer than two-hop neighbours', () => {
    const elements = [
      el('focus', 'module'),
      el('near', 'module'),
      el('far', 'module'),
    ];
    const links = [link('l1', 'focus', 'near'), link('l2', 'near', 'far')];
    const out = layoutFocused('focus', elements, links);
    const dist = (p: { x: number; y: number }) => Math.hypot(p.x, p.y);
    expect(dist(out.near)).toBeLessThan(dist(out.far));
  });

  it('parks unreachable elements far below the focus rings', () => {
    const elements = [
      el('focus', 'module'),
      el('connected', 'module'),
      el('orphan', 'module'),
    ];
    const links = [link('l1', 'focus', 'connected')];
    const out = layoutFocused('focus', elements, links, 2);
    expect(out.orphan.y).toBeGreaterThan(out.connected.y);
    expect(out.orphan.y).toBeGreaterThan(0);
  });

  it('returns empty when the focus id is not in the element list', () => {
    expect(layoutFocused('missing', [el('a', 'module')], [])).toEqual({});
  });

  it('does not place ring members on top of the focus', () => {
    const elements = [
      el('focus', 'module'),
      ...Array.from({ length: 6 }, (_, i) => el(`n${i}`, 'module')),
    ];
    const links = elements.slice(1).map((n, i) => link(`l${i}`, 'focus', n.id));
    const out = layoutFocused('focus', elements, links);
    for (const n of elements.slice(1)) {
      expect(Math.hypot(out[n.id].x, out[n.id].y)).toBeGreaterThan(100);
    }
  });
});

// ---------- By-Type (view-aware) ----------

describe('layoutByType', () => {
  describe('c4Context view', () => {
    it('places persons above internal systems above containers', () => {
      const out = layoutByType([
        el('per_a', 'person'),
        el('sys_main', 'softwareSystem'),
        el('cnt_a', 'container', { systemId: 'sys_main' }),
      ], [], { view: 'c4Context' });
      expect(out.per_a.y).toBeLessThan(out.sys_main.y);
      expect(out.sys_main.y).toBeLessThan(out.cnt_a.y);
    });

    it('parks external systems on the flanks of internal ones', () => {
      const out = layoutByType([
        el('sys_main', 'softwareSystem'),
        el('sys_ext1', 'softwareSystem', { external: 'true' }),
        el('sys_ext2', 'softwareSystem', { external: 'true' }),
      ], [], { view: 'c4Context' });
      expect(Math.abs(out.sys_main.x)).toBeLessThan(Math.abs(out.sys_ext1.x));
      expect(Math.abs(out.sys_main.x)).toBeLessThan(Math.abs(out.sys_ext2.x));
      // Externals straddle the internal — one to each side.
      expect(Math.sign(out.sys_ext1.x) * Math.sign(out.sys_ext2.x)).toBeLessThanOrEqual(0);
    });

    it('stacks containers under their parent system', () => {
      const out = layoutByType([
        el('sys_main', 'softwareSystem'),
        el('cnt_a', 'container', { systemId: 'sys_main' }),
        el('cnt_b', 'container', { systemId: 'sys_main' }),
      ], [], { view: 'c4Context' });
      // Both containers below the system.
      expect(out.cnt_a.y).toBeGreaterThan(out.sys_main.y);
      expect(out.cnt_b.y).toBeGreaterThan(out.sys_main.y);
      // Roughly centred under the system: container row spans across system centre.
      const sysCentre = out.sys_main.x + 220 / 2;
      const cntMin = Math.min(out.cnt_a.x, out.cnt_b.x);
      const cntMax = Math.max(out.cnt_a.x, out.cnt_b.x) + 220;
      expect(sysCentre).toBeGreaterThanOrEqual(cntMin);
      expect(sysCentre).toBeLessThanOrEqual(cntMax);
    });
  });

  describe('moduleMap view', () => {
    it('lays each Bounded Context as a vertical column with modules underneath', () => {
      const out = layoutByType([
        el('bc_a', 'boundedContext'),
        el('bc_b', 'boundedContext'),
        el('m_a1', 'module', { contextId: 'bc_a' }),
        el('m_a2', 'module', { contextId: 'bc_a' }),
        el('m_b1', 'module', { contextId: 'bc_b' }),
      ], [], { view: 'moduleMap' });
      // Modules of bc_a roughly under bc_a's column (x close), and below it (y greater).
      expect(out.m_a1.y).toBeGreaterThan(out.bc_a.y);
      expect(out.m_a2.y).toBeGreaterThan(out.bc_a.y);
      expect(Math.abs(out.m_a1.x - out.bc_a.x)).toBeLessThan(50);
      // bc_b's module is on a different column.
      expect(Math.abs(out.m_b1.x - out.bc_b.x)).toBeLessThan(50);
      expect(Math.sign(out.bc_b.x - out.bc_a.x)).not.toBe(0);
    });

    it('orders BC columns to put heavy talkers adjacent', () => {
      // Three BCs: A talks to C heavily, A talks to B not at all. Expect column order
      // …A, C, B… or …B, C, A… so A and C are adjacent.
      const elements = [
        el('bc_a', 'boundedContext'),
        el('bc_b', 'boundedContext'),
        el('bc_c', 'boundedContext'),
        el('m_a', 'module', { contextId: 'bc_a' }),
        el('m_b', 'module', { contextId: 'bc_b' }),
        el('m_c', 'module', { contextId: 'bc_c' }),
      ];
      const links: ArchLink[] = [
        link('l1', 'm_a', 'm_c'),
        link('l2', 'm_a', 'm_c'),  // weighted: A↔C is the heavy edge
      ];
      const out = layoutByType(elements, links, { view: 'moduleMap' });
      const xs = [
        ['bc_a', out.bc_a.x],
        ['bc_b', out.bc_b.x],
        ['bc_c', out.bc_c.x],
      ].sort((a, b) => (a[1] as number) - (b[1] as number)).map(([id]) => id);
      const aIdx = xs.indexOf('bc_a');
      const cIdx = xs.indexOf('bc_c');
      expect(Math.abs(aIdx - cIdx)).toBe(1);
    });
  });

  describe('dependencyGraph view', () => {
    it('places nodes with no out-edges (infrastructure) at the bottom', () => {
      const elements = [
        el('app', 'module'),
        el('domain', 'module'),
        el('infra', 'module'),
      ];
      const links = [
        link('l1', 'app', 'domain', 'dependency'),
        link('l2', 'domain', 'infra', 'dependency'),
      ];
      const out = layoutByType(elements, links, { view: 'dependencyGraph' });
      expect(out.app.y).toBeLessThan(out.domain.y);
      expect(out.domain.y).toBeLessThan(out.infra.y);
    });

    it('groups same-context modules together within a layer', () => {
      // Four modules at the same depth, two BCs. Same-BC pairs should end up adjacent.
      const elements = [
        el('a1', 'module', { contextId: 'bc_a' }),
        el('a2', 'module', { contextId: 'bc_a' }),
        el('b1', 'module', { contextId: 'bc_b' }),
        el('b2', 'module', { contextId: 'bc_b' }),
      ];
      const out = layoutByType(elements, [], { view: 'dependencyGraph' });
      const sortedByX = ['a1', 'a2', 'b1', 'b2']
        .map((id) => [id, out[id].x] as const)
        .sort((p, q) => p[1] - q[1])
        .map(([id]) => id);
      const aIdx = sortedByX.findIndex((id) => id.startsWith('a'));
      const lastAIdx = sortedByX.length - 1 - [...sortedByX].reverse().findIndex((id) => id.startsWith('a'));
      // All a* nodes occupy a contiguous slice — no b* between them.
      expect(lastAIdx - aIdx).toBe(1);
    });

    it('handles cyclic dependencies without infinite recursion', () => {
      // a → b → c → a. The depth computation must terminate.
      const elements = [el('a', 'module'), el('b', 'module'), el('c', 'module')];
      const links = [
        link('l1', 'a', 'b', 'dependency'),
        link('l2', 'b', 'c', 'dependency'),
        link('l3', 'c', 'a', 'dependency'),
      ];
      const out = layoutByType(elements, links, { view: 'dependencyGraph' });
      expect(Object.keys(out).sort()).toEqual(['a', 'b', 'c']);
    });

    it('reduces crossings — two modules each pointing at a separate target', () => {
      // m1→t1, m2→t2 should NOT cross. Sugiyama on the dependency layout should pick
      // an ordering that aligns m1 with t1 (or m2 with t2).
      const elements = [
        el('m1', 'module'),
        el('m2', 'module'),
        el('t1', 'module'),
        el('t2', 'module'),
      ];
      const links = [
        link('l1', 'm1', 't1', 'dependency'),
        link('l2', 'm2', 't2', 'dependency'),
      ];
      const out = layoutByType(elements, links, { view: 'dependencyGraph' });
      const sameSide = (out.m1.x < out.m2.x) === (out.t1.x < out.t2.x);
      expect(sameSide).toBe(true);
    });
  });

  it('returns empty for empty input', () => {
    expect(layoutByType([], [], { view: 'moduleMap' })).toEqual({});
  });
});
