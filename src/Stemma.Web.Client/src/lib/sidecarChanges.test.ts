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

  // The read used to go out while a save was still on its way: the server answered with the file
  // from before the save, the save landed, and the window then showed the old note while the file
  // held the new one — and wrote the old one back with its next edit to it.
  it('is read only once the save on its way has landed', async () => {
    const s = await session();
    const disk = onDisk() as Record<string, unknown>;
    // Served as the file is when the request arrives, answered a moment later.
    s.api.fetchLayout.mockImplementation(() => {
      const served = structuredClone(disk);
      return new Promise((resolve) => setTimeout(() => resolve(served), 50));
    });
    let land!: () => void;
    s.api.patchLayoutSidecar.mockImplementationOnce((changes) => new Promise((resolve) => {
      land = () => { s.layout.applySidecarChanges(disk, changes); resolve(null); };
    }));
    s.layout.saveLayout(ROOT, 'moduleMap', { mod_1: { x: 15, y: 20 }, mod_2: { x: 300, y: 20 } });
    s.layout.sidecarSet(ROOT, 'notes', 'mod_1', 'Sent, not yet landed.');
    await vi.advanceTimersByTimeAsync(500);
    expect(s.api.patchLayoutSidecar).toHaveBeenCalledTimes(1);

    const reread = s.layout.rereadLayoutSidecar(ROOT);
    await vi.advanceTimersByTimeAsync(0);
    land();
    await vi.advanceTimersByTimeAsync(100);
    await reread;

    const { loadNote } = await import('./elementNotes');
    expect(loadNote(ROOT, 'mod_1')).toBe('Sent, not yet landed.');
    expect(s.layout.loadLayout(ROOT, 'moduleMap').mod_1).toEqual({ x: 15, y: 20 });
    await flush();
    expect(s.api.patchLayoutSidecar).toHaveBeenCalledTimes(1);
  });

  it('keeps an edit made while it is being read', async () => {
    const s = await session();
    let answer!: (file: unknown) => void;
    s.api.fetchLayout.mockImplementationOnce(() => new Promise((resolve) => { answer = resolve; }));
    const reread = s.layout.rereadLayoutSidecar(ROOT);
    await vi.advanceTimersByTimeAsync(0);
    s.layout.sidecarSet(ROOT, 'notes', 'mod_1', 'Typed during the read.');
    answer({ ...onDisk(), notes: { mod_1: 'Changed by a pull.' } });
    await reread;

    const { loadNote } = await import('./elementNotes');
    expect(loadNote(ROOT, 'mod_1')).toBe('Typed during the read.');
    await flush();
    expect(sent(s)).toEqual([{ path: ['notes', 'mod_1'], value: 'Typed during the read.' }]);
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

describe('another workspace', () => {
  const OTHER = '/ws/other';

  it('does not inherit this one\'s copy: its first save waits for its own file, and removes nothing', async () => {
    const s = await session();
    s.layout.forgetLayoutSidecar();
    s.api.fetchLayout.mockImplementation(async () => ({ version: 1, views: { moduleMap: { nodes: { ctx_x: { x: 1, y: 2 }, ctx_y: { x: 3, y: 4 } } } } }));

    // Saved before its file was read: nothing is sent until it has been.
    s.layout.saveLayout(OTHER, 'moduleMap', { ctx_x: { x: 1, y: 2 }, ctx_y: { x: 3, y: 4 }, ctx_new: { x: 9, y: 9 } });
    await flush();
    expect(s.api.patchLayoutSidecar).not.toHaveBeenCalled();
    expect(s.layout.isSidecarPrimed(OTHER)).toBe(false);

    await s.layout.primeLayoutSidecar(OTHER);
    await flush();
    expect(sent(s)).toEqual([{ path: ['views', 'moduleMap', 'nodes', 'ctx_new'], value: { x: 9, y: 9 } }]);
    expect(s.api.patchLayoutSidecar.mock.calls[0][1]).toBe(OTHER);
  });

  it('opened again is read again, not drawn from a copy that may have been emptied', async () => {
    const s = await session();
    // A save under another root replaces the copy; this workspace is then no longer read.
    s.layout.saveLayout(OTHER, 'moduleMap', {});
    expect(s.layout.isSidecarPrimed(ROOT)).toBe(false);

    await s.layout.primeLayoutSidecar(ROOT);
    expect(s.layout.loadLayout(ROOT, 'moduleMap').mod_2).toEqual({ x: 300, y: 20 });
    s.layout.saveLayout(ROOT, 'moduleMap', { mod_1: { x: 15, y: 20 }, mod_2: { x: 300, y: 20 } });
    await flush();
    expect(sent(s)).toEqual([{ path: ['views', 'moduleMap', 'nodes', 'mod_1', 'x'], value: 15 }]);
  });

  it('is opened only once what waited to be sent has been', async () => {
    const s = await session();
    s.layout.saveLayout(ROOT, 'moduleMap', { mod_1: { x: 15, y: 20 }, mod_2: { x: 300, y: 20 } });

    // Before the pause is over: settling sends it now, naming the workspace it was made in.
    await s.layout.settleLayoutSidecar();
    expect(sent(s)).toEqual([{ path: ['views', 'moduleMap', 'nodes', 'mod_1', 'x'], value: 15 }]);
    expect(s.api.patchLayoutSidecar.mock.calls[0][1]).toBe(ROOT);

    s.layout.forgetLayoutSidecar();
    await flush();
    expect(s.api.patchLayoutSidecar).toHaveBeenCalledTimes(1);
  });
});

describe('a change the server will not take', () => {
  it('is sent on its own, dropped from the copy, and said — the others are saved', async () => {
    const s = await session();
    const said: string[] = [];
    const listen = (e: Event) => said.push((e as CustomEvent<{ message: string }>).detail.message);
    window.addEventListener('stemma:layout-change-refused', listen);
    try {
      s.api.patchLayoutSidecar.mockImplementation(async (changes: { path: string[] }[]) =>
        changes.some((c) => c.path[0] === 'notes')
          ? { opId: '', reason: 'InvalidText', message: 'The note holds half an emoji.' }
          : null);
      const { saveNote } = await import('./elementNotes');
      s.layout.saveLayout(ROOT, 'moduleMap', { mod_1: { x: 15, y: 20 }, mod_2: { x: 300, y: 20 } });
      saveNote(ROOT, 'mod_2', 'Ship it \ud83d');
      await flush();

      expect(said).toEqual(['The note holds half an emoji.']);
      // The position landed; the note is out of the copy, so the next save does not carry it.
      s.api.patchLayoutSidecar.mockClear();
      s.layout.saveLayout(ROOT, 'moduleMap', { mod_1: { x: 15, y: 30 }, mod_2: { x: 300, y: 20 } });
      await flush();
      expect(sent(s)).toEqual([{ path: ['views', 'moduleMap', 'nodes', 'mod_1', 'y'], value: 30 }]);
    } finally {
      window.removeEventListener('stemma:layout-change-refused', listen);
    }
  });
});
