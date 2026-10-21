// @vitest-environment happy-dom
// A stemma.layout.json that does not parse — merge conflict markers, a half-saved hand edit — is
// refused by the server, rightly. The window used to swallow that refusal: every layout edit of the
// session stayed in memory, was never sent, nothing on screen said so, and a reload lost them all.
// The refusal is now kept where the canvas can show it, until a read of the file succeeds.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LayoutRefused } from './api';

vi.mock('./api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./api')>()),
  fetchLayout: vi.fn(),
  patchLayoutSidecar: vi.fn(async () => null),
}));

const ROOT = '/ws/conflicted';
const CONFLICT = 'stemma.layout.json cannot be read at line 3: \'<\' is an invalid start of a value.';
const onDisk = () => ({ version: 1, views: { moduleMap: { nodes: { m1: { x: 1, y: 1 } } } }, notes: { m1: 'hello' } });

async function session() {
  vi.resetModules();
  const api = vi.mocked(await import('./api'));
  vi.clearAllMocks();
  api.patchLayoutSidecar.mockResolvedValue(null);
  const layout = await import('./layout');
  return { api, layout };
}

const flush = () => vi.advanceTimersByTimeAsync(1000);

beforeEach(() => {
  localStorage.clear();
  vi.useFakeTimers();
});
afterEach(() => vi.useRealTimers());

describe('a layout file that cannot be read', () => {
  it('is said, with the server\'s reason, to whoever listens', async () => {
    const { api, layout } = await session();
    api.fetchLayout.mockRejectedValue(new LayoutRefused('UnreadableSidecar', CONFLICT));
    const heard: unknown[] = [];
    layout.onSidecarProblem((p) => heard.push(p));

    await layout.primeLayoutSidecar(ROOT);

    const problem = { rootPath: ROOT, reason: 'UnreadableSidecar', message: CONFLICT };
    expect(layout.sidecarProblem()).toEqual(problem);
    expect(heard).toEqual([problem]);
  });

  it('keeps the edits made meanwhile, and sends them once it reads again', async () => {
    const { api, layout } = await session();
    api.fetchLayout.mockRejectedValue(new LayoutRefused('UnreadableSidecar', CONFLICT));
    await layout.primeLayoutSidecar(ROOT);
    layout.sidecarSet(ROOT, 'notes', 'm1', 'Kept while the file was broken.');
    await flush();
    expect(api.patchLayoutSidecar).not.toHaveBeenCalled();

    api.fetchLayout.mockResolvedValue(onDisk());
    await layout.retryLayoutSidecar(ROOT);
    await flush();

    expect(layout.sidecarProblem()).toBeNull();
    expect(api.patchLayoutSidecar.mock.calls.flatMap((c) => c[0])).toEqual([
      { path: ['notes', 'm1'], value: 'Kept while the file was broken.' },
    ]);
  });

  it('that breaks during the session is said when a save is refused, and cleared once it reads', async () => {
    const { api, layout } = await session();
    api.fetchLayout.mockResolvedValue(onDisk());
    await layout.primeLayoutSidecar(ROOT);
    api.patchLayoutSidecar.mockResolvedValueOnce({ opId: '', reason: 'UnreadableSidecar', message: CONFLICT });
    layout.sidecarSet(ROOT, 'notes', 'm1', 'edited');
    await flush();
    expect(layout.sidecarProblem()?.message).toBe(CONFLICT);

    // Fixed by hand: the engine says the file changed, and the read succeeds.
    await layout.rereadLayoutSidecar(ROOT);
    await flush();
    expect(layout.sidecarProblem()).toBeNull();
    expect(api.patchLayoutSidecar).toHaveBeenLastCalledWith([{ path: ['notes', 'm1'], value: 'edited' }], ROOT);
  });

  it('is read again when the engine says it changed, though it was never read', async () => {
    const { api, layout } = await session();
    api.fetchLayout.mockRejectedValue(new LayoutRefused('UnreadableSidecar', CONFLICT));
    await layout.primeLayoutSidecar(ROOT);

    api.fetchLayout.mockResolvedValue(onDisk());
    await layout.rereadLayoutSidecar(ROOT);

    expect(layout.isSidecarPrimed(ROOT)).toBe(true);
    expect(layout.sidecarProblem()).toBeNull();
  });

  it('is not confused with a server that is not ready yet', async () => {
    const { api, layout } = await session();
    api.fetchLayout.mockRejectedValue(new TypeError('Failed to fetch'));
    await layout.primeLayoutSidecar(ROOT);

    expect(layout.sidecarProblem()).toBeNull();
  });

  it('is forgotten with the workspace', async () => {
    const { api, layout } = await session();
    api.fetchLayout.mockRejectedValue(new LayoutRefused('UnreadableSidecar', CONFLICT));
    await layout.primeLayoutSidecar(ROOT);
    layout.forgetLayoutSidecar();

    expect(layout.sidecarProblem()).toBeNull();
  });
});
