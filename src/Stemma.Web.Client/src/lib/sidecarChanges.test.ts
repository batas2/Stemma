// @vitest-environment happy-dom
// B-014 / ADR-0021. The canvas writes the sidecar as changes — the smallest values that differ from
// the copy it last read or wrote — and the server applies them to the file as it is. When the file
// changes outside, the canvas reads it again and lays its own unsent changes over what it now says.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./api')>()),
  fetchLayout: vi.fn(),
  patchLayoutSidecar: vi.fn(async () => null),
}));

const ROOT = '/ws/b014';

const onDisk = () => ({
  version: 1,
  views: { moduleMap: { nodes: { mod_1: { x: 10, y: 20 }, mod_2: { x: 300, y: 20 } }, gap: [90, 70] } },
  notes: { mod_1: 'Owns the gate.' },
  nodeStyles: {},
});

async function session() {
  vi.resetModules();
  const api = vi.mocked(await import('./api'));
  vi.clearAllMocks();
  api.patchLayoutSidecar.mockResolvedValue(null);
  api.fetchLayout.mockImplementation(async () => onDisk());
  const layout = await import('./layout');
  await layout.primeLayoutSidecar(ROOT);
  return { api, layout };
}
type Session = Awaited<ReturnType<typeof session>>;

const flush = () => vi.advanceTimersByTimeAsync(1000);
const sent = (s: Session) => s.api.patchLayoutSidecar.mock.calls.flatMap((c) => c[0]);

beforeEach(() => {
  localStorage.clear();
  vi.useFakeTimers();
});
afterEach(() => vi.useRealTimers());

describe('what changed, as changes', () => {
  it('is the smallest values that differ', async () => {
    const { sidecarChanges } = await import('./layout');
    const before = onDisk();
    const after = onDisk();
    after.views.moduleMap.nodes.mod_1.x = 15;
    delete (after.notes as Record<string, string>).mod_1;
    (after.views as Record<string, unknown>)['custom:view_new'] = { nodes: { mod_1: { x: 1, y: 1 } } };

    expect(sidecarChanges(before, after)).toEqual([
      { path: ['views', 'moduleMap', 'nodes', 'mod_1', 'x'], value: 15 },
      { path: ['views', 'custom:view_new'], value: { nodes: { mod_1: { x: 1, y: 1 } } } },
      { path: ['notes', 'mod_1'], remove: true },
    ]);
  });

  it('treats an array as one value, and an empty object nobody wrote as nothing', async () => {
    const { sidecarChanges } = await import('./layout');
    const after = { ...onDisk(), edgeStyles: {} } as Record<string, unknown>;
    (after.views as { moduleMap: { gap: number[] } }).moduleMap.gap = [90, 80];

    expect(sidecarChanges(onDisk(), after)).toEqual([
      { path: ['views', 'moduleMap', 'gap'], value: [90, 80] },
    ]);
  });
});

describe('a write', () => {
  it('sends only what the edit changed', async () => {
    const s = await session();
    s.layout.saveLayout(ROOT, 'moduleMap', { mod_1: { x: 15, y: 20 }, mod_2: { x: 300, y: 20 } });
    await flush();

    expect(sent(s)).toEqual([{ path: ['views', 'moduleMap', 'nodes', 'mod_1', 'x'], value: 15 }]);
  });

  it('is not sent again once it has landed', async () => {
    const s = await session();
    s.layout.saveLayout(ROOT, 'moduleMap', { mod_1: { x: 15, y: 20 }, mod_2: { x: 300, y: 20 } });
    await flush();
    const { setNodeStyle } = await import('./nodeStyles');
    setNodeStyle(ROOT, 'mod_2', { borderWidth: 2, borderStyle: 'dashed' });
    await flush();

    expect(s.api.patchLayoutSidecar).toHaveBeenCalledTimes(2);
    expect(s.api.patchLayoutSidecar.mock.calls[1][0]).toEqual([
      { path: ['nodeStyles', 'mod_2'], value: { borderWidth: 2, borderStyle: 'dashed' } },
    ]);
  });

  it('that is refused is sent again with the next one', async () => {
    const s = await session();
    s.api.patchLayoutSidecar.mockResolvedValueOnce({ opId: '', reason: 'UnreadableSidecar', message: 'conflict markers' });
    s.layout.saveLayout(ROOT, 'moduleMap', { mod_1: { x: 15, y: 20 }, mod_2: { x: 300, y: 20 } });
    await flush();
    s.layout.saveLayout(ROOT, 'moduleMap', { mod_1: { x: 15, y: 25 }, mod_2: { x: 300, y: 20 } });
    await flush();

    expect(s.api.patchLayoutSidecar.mock.calls[1][0]).toEqual([
      { path: ['views', 'moduleMap', 'nodes', 'mod_1', 'x'], value: 15 },
      { path: ['views', 'moduleMap', 'nodes', 'mod_1', 'y'], value: 25 },
    ]);
  });
});

describe('a change made outside', () => {
  it('is shown, and the next edit does not write over it', async () => {
    const s = await session();
    s.api.fetchLayout.mockImplementation(async () => ({ ...onDisk(), notes: { mod_1: 'Changed by a pull.' } }));
    await s.layout.rereadLayoutSidecar(ROOT);
    const { loadNote } = await import('./elementNotes');
    expect(loadNote(ROOT, 'mod_1')).toBe('Changed by a pull.');

    s.layout.saveLayout(ROOT, 'moduleMap', { mod_1: { x: 15, y: 20 }, mod_2: { x: 300, y: 20 } });
    await flush();
    expect(sent(s)).toEqual([{ path: ['views', 'moduleMap', 'nodes', 'mod_1', 'x'], value: 15 }]);
  });

  it('does not take away an edit that has not been sent yet', async () => {
    const s = await session();
    s.layout.saveLayout(ROOT, 'moduleMap', { mod_1: { x: 15, y: 20 }, mod_2: { x: 300, y: 20 } });
    // Before the debounce: the edit is in this session only.
    s.api.fetchLayout.mockImplementation(async () => ({ ...onDisk(), notes: { mod_1: 'Changed by a pull.' } }));
    await s.layout.rereadLayoutSidecar(ROOT);

    expect(s.layout.loadLayout(ROOT, 'moduleMap').mod_1).toEqual({ x: 15, y: 20 });
    await flush();
    expect(sent(s)).toEqual([{ path: ['views', 'moduleMap', 'nodes', 'mod_1', 'x'], value: 15 }]);
  });

  it('that arrives before the sidecar was first read waits for that read', async () => {
    vi.resetModules();
    const api = vi.mocked(await import('./api'));
    vi.clearAllMocks();
    const layout = await import('./layout');
    await layout.rereadLayoutSidecar(ROOT);
    expect(api.fetchLayout).not.toHaveBeenCalled();
  });
});
