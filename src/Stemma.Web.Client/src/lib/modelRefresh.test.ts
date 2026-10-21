// @vitest-environment happy-dom
// Every operation refreshed the model, and the refreshes ran side by side: a paste of ten
// operations sent ten refreshes at once, each asking for the workspace, the model, its problems and
// the views — forty requests — and whichever answer came back last was drawn, not the newest. A
// model from before the paste could replace the one after it. Refreshes now run one at a time, a
// burst is read once more after the one on its way, and an edit this window made reads the model
// and its problems only.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ArchModel } from './types';

vi.mock('./api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./api')>()),
  snapshot: vi.fn(),
  archModel: vi.fn(),
  listViolations: vi.fn(),
  listServerViews: vi.fn(),
  fetchLayout: vi.fn(),
  patchLayoutSidecar: vi.fn(async () => null),
}));

const ROOT = '/ws/refresh';
const model = (name: string, filePath = `${ROOT}/Architecture/Architecture.cs`): ArchModel =>
  ({ filePath, elements: [{ id: 'a', name, kind: 'module', attributes: {} }], links: [], tags: [] });
const later = <T>(ms: number, value: T) => new Promise<T>((resolve) => setTimeout(() => resolve(value), ms));

async function setup() {
  vi.resetModules();
  const api = vi.mocked(await import('./api'));
  vi.clearAllMocks();
  api.snapshot.mockImplementation(() => later(10, { rootPath: ROOT, projects: [] }));
  api.archModel.mockImplementation(() => later(10, model('now')));
  api.listViolations.mockImplementation(() => later(10, []));
  api.listServerViews.mockImplementation(() => later(10, []));
  api.fetchLayout.mockImplementation(() => new Promise(() => {}));
  const { useApp } = await import('./store');
  useApp.getState().setWorkspace({ rootPath: ROOT, projects: [] });
  await vi.advanceTimersByTimeAsync(100);
  vi.clearAllMocks();
  const refresh = await import('./modelRefresh');
  return { api, useApp, refresh };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('createRefresher', () => {
  it('reads one at a time: an answer that comes back late is never drawn over a newer one', async () => {
    const { createRefresher } = await import('./modelRefresh');
    const drawn: string[] = [];
    const answers = [later(50, 'before the paste'), later(10, 'after the paste')];
    let call = 0;
    const r = createRefresher(async (_scope, current) => {
      const answer = await answers[call++];
      if (current()) drawn.push(answer);
    });

    void r.refresh('model');
    void r.refresh('model');
    await vi.advanceTimersByTimeAsync(200);

    expect(drawn.at(-1)).toBe('after the paste');
  });

  it('reads a burst once more after the read on its way, not once per request', async () => {
    const { createRefresher } = await import('./modelRefresh');
    const run = vi.fn(async () => { await later(30, null); });
    const r = createRefresher(run);

    const done = Array.from({ length: 10 }, () => r.refresh('model'));
    await vi.advanceTimersByTimeAsync(200);
    await Promise.all(done);

    expect(run).toHaveBeenCalledTimes(2);
  });

  it('reads the workspace when anyone in the burst asked for it', async () => {
    const { createRefresher } = await import('./modelRefresh');
    const scopes: string[] = [];
    const r = createRefresher(async (scope) => { scopes.push(scope); await later(30, null); });

    void r.refresh('model');
    void r.refresh('model');
    void r.refresh('workspace');
    void r.refresh('model');
    await vi.advanceTimersByTimeAsync(200);

    expect(scopes).toEqual(['model', 'workspace']);
  });

  it('drops a read that something newer has claimed past', async () => {
    const { createRefresher } = await import('./modelRefresh');
    const drawn: string[] = [];
    const r = createRefresher(async (_scope, current) => {
      const answer = await later(50, 'from the last workspace');
      if (current()) drawn.push(answer);
    });

    void r.refresh('workspace');
    // Another workspace is opened, and its model read, while the read is on its way.
    r.claim();
    await vi.advanceTimersByTimeAsync(100);

    expect(drawn).toEqual([]);
  });
});

describe('refreshing after an edit', () => {
  it('this window made reads the model and its problems only', async () => {
    const { api, useApp, refresh } = await setup();
    await Promise.all([refresh.modelRefresh.refresh('model'), vi.advanceTimersByTimeAsync(100)]);

    expect(api.archModel).toHaveBeenCalledTimes(1);
    expect(api.listViolations).toHaveBeenCalledTimes(1);
    expect(api.snapshot).not.toHaveBeenCalled();
    expect(api.listServerViews).not.toHaveBeenCalled();
    expect(useApp.getState().arch?.elements[0].name).toBe('now');
  });

  it('someone else made reads the workspace and its views too', async () => {
    const { api, refresh } = await setup();
    await Promise.all([refresh.modelRefresh.refresh('workspace'), vi.advanceTimersByTimeAsync(100)]);

    expect(api.snapshot).toHaveBeenCalledTimes(1);
    expect(api.listServerViews).toHaveBeenCalledTimes(1);
  });

  it('reads the workspace after all when the model is another workspace\'s', async () => {
    const { api, useApp, refresh } = await setup();
    // Another window opened another workspace on this server.
    api.archModel.mockImplementation(() => later(10, model('elsewhere', '/ws/other/Architecture/Architecture.cs')));
    api.snapshot.mockImplementation(() => later(10, { rootPath: '/ws/other', projects: [] }));
    await Promise.all([refresh.modelRefresh.refresh('model'), vi.advanceTimersByTimeAsync(100)]);

    expect(api.snapshot).toHaveBeenCalledTimes(1);
    expect(useApp.getState().workspace?.rootPath).toBe('/ws/other');
  });

  it('a paste of ten operations is two reads of the model, not forty requests', async () => {
    const { api, useApp, refresh } = await setup();
    let n = 0;
    api.archModel.mockImplementation(() => later(10, model(`after op ${++n}`)));
    const done = Array.from({ length: 10 }, () => refresh.modelRefresh.refresh('model'));
    await Promise.all([...done, vi.advanceTimersByTimeAsync(200)]);

    const requests = [api.snapshot, api.archModel, api.listViolations, api.listServerViews]
      .reduce((sum, f) => sum + f.mock.calls.length, 0);
    expect(requests).toBe(4);
    expect(useApp.getState().arch?.elements[0].name).toBe('after op 2');
  });
});

describe('modelBelongsTo', () => {
  it('compares paths as the platforms write them', async () => {
    const { modelBelongsTo } = await import('./modelRefresh');
    expect(modelBelongsTo('/ws/a/Architecture/Architecture.cs', '/ws/a')).toBe(true);
    expect(modelBelongsTo('/ws/a/Architecture/Architecture.cs', '/ws/a/')).toBe(true);
    expect(modelBelongsTo('C:\\repo\\Architecture\\Architecture.cs', 'C:/repo')).toBe(true);
    expect(modelBelongsTo('/ws/ab/Architecture/Architecture.cs', '/ws/a')).toBe(false);
    expect(modelBelongsTo('/ws/b/Architecture/Architecture.cs', '/ws/a')).toBe(false);
  });
});
