// @vitest-environment happy-dom
// Edits made before the layout sidecar has been read are held back and sent once it has. They were
// held as the window's whole maps and laid over the file as read: rerouting one arrow while the
// file loaded sent every other arrow of the view away, a new shape replaced the committed ones, and
// a drag on a fresh clone wrote the default grid slots over every committed position. They are held
// as what each edit changed, and each change is made again on the file as it was read.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./api')>()),
  fetchLayout: vi.fn(),
  patchLayoutSidecar: vi.fn(async () => null),
}));

const ROOT = '/ws/held';

const onDisk = () => ({
  version: 1,
  views: {
    moduleMap: {
      nodes: { m1: { x: 1, y: 1 }, m2: { x: 2, y: 2 } },
      edges: { l1: { waypoints: [{ x: 5, y: 5 }] }, l2: { handles: { source: 'top' } } },
      shapes: [{ id: 's1', kind: 'rect' }],
    },
  },
  nodeStyles: { m1: { fill: 'red' } },
  notes: { m1: 'hello' },
});

/** A session whose sidecar read is still on its way; `arrive` lets it land. */
async function loading() {
  vi.resetModules();
  const api = vi.mocked(await import('./api'));
  vi.clearAllMocks();
  api.patchLayoutSidecar.mockResolvedValue(null);
  let arrive!: (file: unknown) => void;
  api.fetchLayout.mockImplementation(() => new Promise((resolve) => { arrive = resolve; }));
  const layout = await import('./layout');
  const primed = layout.primeLayoutSidecar(ROOT);
  return {
    api,
    layout,
    async land(file: unknown = onDisk()) { arrive(file); await primed; await vi.advanceTimersByTimeAsync(1000); },
  };
}

const sent = (api: Awaited<ReturnType<typeof loading>>['api']) => api.patchLayoutSidecar.mock.calls.flatMap((c) => c[0]);

beforeEach(() => {
  localStorage.clear();
  vi.useFakeTimers();
});
afterEach(() => vi.useRealTimers());

describe('an edit made before the sidecar is read', () => {
  it('rerouting one arrow and adding a shape leave the other arrows and shapes in the file', async () => {
    const s = await loading();
    s.layout.saveEdgeWaypoints(ROOT, 'moduleMap', 'l3', [{ x: 9, y: 9 }]);
    s.layout.saveEdgeHandles(ROOT, 'moduleMap', 'l1', { source: 'left' });
    s.layout.saveViewShapes(ROOT, 'moduleMap', [{ id: 'new', kind: 'label' }]);
    await s.land();

    expect(sent(s.api)).toEqual([
      { path: ['views', 'moduleMap', 'edges', 'l1', 'handles'], value: { source: 'left' } },
      { path: ['views', 'moduleMap', 'edges', 'l3'], value: { waypoints: [{ x: 9, y: 9 }] } },
      { path: ['views', 'moduleMap', 'shapes'], value: [{ id: 's1', kind: 'rect' }, { id: 'new', kind: 'label' }] },
    ]);
    expect(s.layout.loadEdgeWaypoints(ROOT, 'moduleMap')).toEqual({ l1: [{ x: 5, y: 5 }], l3: [{ x: 9, y: 9 }] });
  });

  it('a drag on a fresh clone moves nothing the file has a position for to a default slot', async () => {
    const s = await loading();
    // Nothing remembered: every card is drawn at a default slot, and the drag saves them all.
    s.layout.saveLayout(ROOT, 'moduleMap', { m1: { x: 0, y: 0 }, m2: { x: 240, y: 0 }, m3: { x: 480, y: 0 } });
    await s.land();

    expect(sent(s.api)).toEqual([{ path: ['views', 'moduleMap', 'nodes', 'm3'], value: { x: 480, y: 0 } }]);
    expect(s.layout.loadLayout(ROOT, 'moduleMap')).toEqual({ m1: { x: 1, y: 1 }, m2: { x: 2, y: 2 }, m3: { x: 480, y: 0 } });
  });

  it('a card moved from where the window drew it is moved in the file, and only that card', async () => {
    localStorage.setItem(`stemma.layout:${ROOT}:moduleMap`, JSON.stringify({ m1: { x: 1, y: 1 }, m2: { x: 70, y: 70 } }));
    localStorage.setItem(`stemma.layout.migrated:${ROOT}`, '1');
    const s = await loading();
    s.layout.saveLayout(ROOT, 'moduleMap', { m1: { x: 50, y: 1 }, m2: { x: 70, y: 70 } });
    await s.land();

    // m2 was drawn from what this browser remembered, and stays where the file has it.
    expect(sent(s.api)).toEqual([{ path: ['views', 'moduleMap', 'nodes', 'm1', 'x'], value: 50 }]);
  });

  it('a style or a note set while it loads is added to the section, not put in its place', async () => {
    const s = await loading();
    s.layout.sidecarSet(ROOT, 'nodeStyles', 'm2', { fill: 'blue' });
    s.layout.sidecarSet(ROOT, 'notes', 'm1', undefined);
    await s.land();

    expect(sent(s.api)).toEqual([
      { path: ['nodeStyles', 'm2'], value: { fill: 'blue' } },
      { path: ['notes', 'm1'], remove: true },
    ]);
  });

  it('does not change the version the file says it is', async () => {
    const s = await loading();
    s.layout.saveViewLayoutMode(ROOT, 'moduleMap', 'custom');
    await s.land({ ...onDisk(), version: 2 });

    expect(sent(s.api)).toEqual([{ path: ['views', 'moduleMap', 'layoutMode'], value: 'custom' }]);
  });

  it('clearing an arrow\'s bends keeps the dot it is docked to', async () => {
    const s = await loading();
    await s.land({ ...onDisk(), views: { moduleMap: { edges: { l1: { waypoints: [{ x: 5, y: 5 }], handles: { source: 'top' } } } } } });
    s.layout.saveEdgeWaypoints(ROOT, 'moduleMap', 'l1', []);
    await vi.advanceTimersByTimeAsync(1000);

    expect(sent(s.api)).toEqual([{ path: ['views', 'moduleMap', 'edges', 'l1', 'waypoints'], remove: true }]);
  });
});
