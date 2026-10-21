// @vitest-environment happy-dom
// B-012. The browser keeps a copy of a workspace — its views, notes, styles, custom properties,
// positions and layout modes — in localStorage. That copy is a cache of what the repository
// holds: it is drawn before the repository has been read, replaced (not merged) once it has, and
// never written back over it. What a teammate removed, or a checkout went back past, stays gone.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ServerView } from './api';
import type { CustomView } from './types';

vi.mock('./api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./api')>()),
  fetchLayout: vi.fn(),
  patchLayoutSidecar: vi.fn(async () => null),
  listServerViews: vi.fn(),
  saveServerView: vi.fn(async () => null),
  deleteServerView: vi.fn(async () => null),
}));

const ROOT = '/ws/b012';
// A new object each time: priming migrates into the sidecar it is given.
const empty = () => ({ version: 1, views: {} });

const A: ServerView = { id: 'view_a', name: 'Ingest', baseView: 'all', elementIds: ['mod_1'] };
const B: ServerView = { id: 'view_b', name: 'Billing', baseView: 'all', elementIds: ['mod_2'] };
const cached = (v: ServerView): CustomView => ({ ...v, baseView: 'all', createdAt: '2026-09-01T00:00:00.000Z' });

/**
 * A fresh session — what a reload, a fresh clone or the next morning are. The modules hold the
 * session's copy of the sidecar, so each session imports them anew; localStorage carries over.
 */
async function session() {
  vi.resetModules();
  const api = vi.mocked(await import('./api'));
  // The mocked module outlives resetModules, so what one session told it is cleared here.
  vi.clearAllMocks();
  api.patchLayoutSidecar.mockResolvedValue(null);
  api.saveServerView.mockResolvedValue(null);
  api.deleteServerView.mockResolvedValue(null);
  const layout = await import('./layout');
  const { useApp } = await import('./store');
  return { api, layout, useApp };
}
type Session = Awaited<ReturnType<typeof session>>;

/** Open the workspace the way App does: snapshot, then the sidecar, then re-read from it. */
async function open(s: Session, sidecar: unknown, views: ServerView[] | Error = []) {
  s.api.fetchLayout.mockResolvedValue(structuredClone(sidecar));
  if (views instanceof Error) s.api.listServerViews.mockRejectedValue(views);
  else s.api.listServerViews.mockResolvedValue(views);
  s.useApp.getState().setWorkspace({ rootPath: ROOT, projects: [] });
  await s.layout.primeLayoutSidecar(ROOT);
  s.useApp.getState().rehydratePresentation();
  await flush();
}

// Long enough for the debounced sidecar write to go out.
const flush = () => vi.advanceTimersByTimeAsync(1000);
const seed = (key: string, value: unknown) => localStorage.setItem(key, JSON.stringify(value));
const cache = (key: string) => JSON.parse(localStorage.getItem(key) ?? 'null');
// Every change the canvas has sent to the sidecar, in order (ADR-0021).
const sent = (s: Session) => s.api.patchLayoutSidecar.mock.calls.flatMap((c) => c[0]);
/** The file the sidecar would be once what was sent has landed on it. */
const landed = (s: Session, file: unknown) => {
  const result = structuredClone(file) as Record<string, unknown>;
  s.layout.applySidecarChanges(result, sent(s));
  return result as { views?: Record<string, { layoutMode?: string }> };
};

beforeEach(() => {
  localStorage.clear();
  vi.useFakeTimers();
});
afterEach(() => vi.useRealTimers());

describe('a presentation entry the sidecar no longer has', () => {
  const sections = [
    {
      section: 'notes', cacheKey: `stemma.notes:${ROOT}`, kept: 'Owns the gate.', gone: 'Removed by a teammate.',
      read: async (id: string) => (await import('./elementNotes')).loadNote(ROOT, id) || undefined,
    },
    {
      section: 'nodeStyles', cacheKey: `stemma.nodeStyles:${ROOT}`,
      kept: { borderWidth: 1, borderStyle: 'solid' }, gone: { borderWidth: 3, borderStyle: 'dashed' },
      read: async (id: string) => (await import('./nodeStyles')).loadNodeStyles(ROOT)[id],
    },
    {
      section: 'edgeStyles', cacheKey: `stemma.edgeStyles:${ROOT}`,
      kept: { thickness: 1.5, lineStyle: 'solid' }, gone: { thickness: 4, lineStyle: 'dotted' },
      read: async (id: string) => (await import('./edgeStyles')).loadEdgeStyles(ROOT)[id],
    },
    {
      section: 'customProps', cacheKey: `stemma.customProps:${ROOT}`, kept: { owner: 'Perform' }, gone: { status: 'NEW' },
      read: async (id: string) => (await import('./customProps')).loadCustomProps(ROOT)[id],
    },
  ];

  it.each(sections)('is not brought back from the browser: $section', async ({ section, cacheKey, kept, gone, read }) => {
    seed(cacheKey, { el_1: kept, el_2: gone });
    const s = await session();
    await open(s, { ...empty(), [section]: { el_1: kept } });

    expect(await read('el_1')).toEqual(kept);
    expect(await read('el_2')).toBeUndefined();
    // And the cache is the committed copy now, so the next session does not draw it either.
    expect(cache(cacheKey)).toEqual({ el_1: kept });
  });

  it.each(sections)('is still drawn before the sidecar has been read: $section', async ({ cacheKey, gone, read }) => {
    seed(cacheKey, { el_2: gone });
    const s = await session();
    s.api.fetchLayout.mockReturnValue(new Promise(() => {}));
    void s.layout.primeLayoutSidecar(ROOT);

    expect(await read('el_2')).toEqual(gone);
  });
});

describe('positions', () => {
  it('a view the sidecar has no positions for is not laid out from the browser', async () => {
    seed(`stemma.layout:${ROOT}:moduleMap`, { mod_1: { x: 10, y: 20 } });
    // A first session moves anything the browser alone had into the sidecar, once…
    let s = await session();
    await open(s, empty());
    expect(s.layout.loadLayout(ROOT, 'moduleMap')).toEqual({ mod_1: { x: 10, y: 20 } });

    // …and after a checkout that no longer has them, the browser does not put them back.
    s = await session();
    await open(s, empty());
    expect(s.layout.loadLayout(ROOT, 'moduleMap')).toEqual({});
  });
});

describe('nothing is written to the sidecar before it has been read', () => {
  it('opening writes nothing, however many times the sidecar is asked for at once', async () => {
    // App primes from the open and from every refresh; on open the two race.
    const s = await session();
    s.api.fetchLayout.mockImplementation(async () => ({ version: 1, views: { moduleMap: { nodes: { mod_1: { x: 1, y: 2 } } } } }));
    await Promise.all([s.layout.primeLayoutSidecar(ROOT), s.layout.primeLayoutSidecar(ROOT)]);
    await flush();

    expect(s.api.patchLayoutSidecar).not.toHaveBeenCalled();
  });

  it('an edit made while it loads is written over the file, not instead of it', async () => {
    const s = await session();
    let answer!: (sidecar: unknown) => void;
    s.api.fetchLayout.mockReturnValue(new Promise((r) => { answer = r; }));
    const styles = await import('./nodeStyles');

    styles.setNodeStyle(ROOT, 'mod_1', { borderWidth: 2, borderStyle: 'dashed' });
    const priming = s.layout.primeLayoutSidecar(ROOT);
    await vi.advanceTimersByTimeAsync(2000);
    // Sent now, it could only be measured against nothing.
    expect(s.api.patchLayoutSidecar).not.toHaveBeenCalled();

    answer({ version: 1, views: { moduleMap: { nodes: { mod_2: { x: 1, y: 2 } } } }, nodeStyles: { mod_2: { borderWidth: 1, borderStyle: 'solid' } } });
    await priming;
    await vi.advanceTimersByTimeAsync(2000);

    // The edit, and only the edit: what the file already had is not sent back to it.
    expect(sent(s)).toEqual([{ path: ['nodeStyles', 'mod_1'], value: { borderWidth: 2, borderStyle: 'dashed' } }]);
  });
});

describe('layout modes', () => {
  it('a fresh clone shows the mode the sidecar commits', async () => {
    const s = await session();
    await open(s, { version: 1, views: { moduleMap: { layoutMode: 'hierarchical' } } });

    expect(s.useApp.getState().viewLayouts.moduleMap).toBe('hierarchical');
  });

  it('the committed mode wins over the browser, and is not overwritten', async () => {
    seed(`stemma.viewLayouts:${ROOT}`, { moduleMap: 'force' });
    const s = await session();
    await open(s, { version: 1, views: { moduleMap: { layoutMode: 'hierarchical' } } });

    expect(s.useApp.getState().viewLayouts.moduleMap).toBe('hierarchical');
    expect(landed(s, { version: 1, views: { moduleMap: { layoutMode: 'hierarchical' } } }).views?.moduleMap?.layoutMode).toBe('hierarchical');
  });

  it('a mode only this browser had is moved into the sidecar once, and is not brought back after', async () => {
    seed(`stemma.viewLayouts:${ROOT}`, { moduleMap: 'force' });
    let s = await session();
    await open(s, empty());
    expect(s.useApp.getState().viewLayouts.moduleMap).toBe('force');
    expect(landed(s, empty()).views?.moduleMap?.layoutMode).toBe('force');

    // A teammate sets the view back; the file no longer has the mode. This browser still does.
    s = await session();
    await open(s, empty());
    expect(s.useApp.getState().viewLayouts.moduleMap).toBeUndefined();
    expect(sent(s)).toEqual([]);
  });
});

describe('views are what Views/*.cs declares', () => {
  const ids = (s: Session) => s.useApp.getState().customViews.map((v) => v.id);

  it('a view only the browser has leaves the list once the code has been read', async () => {
    seed(`stemma.views:${ROOT}`, [cached(A), cached(B)]);
    const s = await session();
    await open(s, empty(), [A]);

    expect(ids(s)).toEqual(['view_a']);
    expect(cache(`stemma.views:${ROOT}`).map((v: CustomView) => v.id)).toEqual(['view_a']);
  });

  it('an empty Views folder is an empty list', async () => {
    seed(`stemma.views:${ROOT}`, [cached(A)]);
    const s = await session();
    await open(s, empty(), []);

    expect(ids(s)).toEqual([]);
  });

  it('a list that cannot be read leaves the cached one', async () => {
    seed(`stemma.views:${ROOT}`, [cached(A)]);
    const s = await session();
    await open(s, empty(), new Error('engine restarting'));

    expect(ids(s)).toEqual(['view_a']);
  });

  it('the tab of a view that left the list closes', async () => {
    seed(`stemma.views:${ROOT}`, [cached(A), cached(B)]);
    localStorage.setItem(`stemma.activeView:${ROOT}`, 'view_b');
    seed(`stemma.openViews:${ROOT}`, ['view_a', 'view_b']);
    const s = await session();
    await open(s, empty(), [A]);

    expect(s.useApp.getState().activeCustomViewId).toBeNull();
    expect(s.useApp.getState().openViewIds).toEqual(['view_a']);
  });

  it('a view deleted outside Stemma leaves the list on the next refresh', async () => {
    const s = await session();
    await open(s, empty(), [A, B]);
    s.api.listServerViews.mockResolvedValue([A]);
    await s.useApp.getState().syncViews();

    expect(ids(s)).toEqual(['view_a']);
  });

  it('a refresh that finds the views as they were keeps the same objects, so nothing is drawn again', async () => {
    const s = await session();
    await open(s, empty(), [A, B]);
    s.api.listServerViews.mockResolvedValue([A, B]);
    await s.useApp.getState().syncViews();
    const before = s.useApp.getState().customViews;

    s.api.listServerViews.mockResolvedValue([A, { ...B }]);
    await s.useApp.getState().syncViews();
    expect(s.useApp.getState().customViews).toBe(before);

    s.api.listServerViews.mockResolvedValue([A, { ...B, name: 'Billing and refunds' }]);
    await s.useApp.getState().syncViews();
    const after = s.useApp.getState().customViews;
    expect(after).not.toBe(before);
    expect(after[0]).toBe(before[0]);
    expect(after[1].name).toBe('Billing and refunds');
  });

  it('a refresh while a save is on its way does not take the view away', async () => {
    const s = await session();
    await open(s, empty(), [A]);
    let answer!: (r: null) => void;
    s.api.saveServerView.mockReturnValue(new Promise((r) => { answer = r; }));

    s.useApp.getState().upsertCustomView(cached(B));
    // The engine has not written it yet, so the code's list does not have it.
    await s.useApp.getState().syncViews();
    expect(ids(s)).toEqual(['view_a', 'view_b']);

    s.api.listServerViews.mockResolvedValue([A, B]);
    answer(null);
    await flush();
    expect(ids(s)).toEqual(['view_a', 'view_b']);
  });

  it('a refresh while a delete is on its way does not bring the view back', async () => {
    const s = await session();
    await open(s, empty(), [A, B]);
    s.api.deleteServerView.mockReturnValue(new Promise(() => {}));

    s.useApp.getState().removeCustomView('view_b');
    await s.useApp.getState().syncViews();

    expect(ids(s)).toEqual(['view_a']);
  });

  it('a save the engine refuses is put back as the code has it, and the refusal is shown', async () => {
    const s = await session();
    await open(s, empty(), [A]);
    s.api.saveServerView.mockResolvedValue({ opId: 'op_1', reason: 'ChangedOnDisk', message: 'Views/Ingest.cs changed on disk.' });

    s.useApp.getState().upsertCustomView({ ...cached(A), name: 'Ingest and storage' });
    await flush();

    expect(s.useApp.getState().customViews.map((v) => v.name)).toEqual(['Ingest']);
    expect(s.useApp.getState().toast).toEqual({ kind: 'error', text: expect.stringContaining('changed outside Stemma') });
  });

  it('a delete the engine refuses puts the view back, and the refusal is shown', async () => {
    const s = await session();
    await open(s, empty(), [A, B]);
    s.api.deleteServerView.mockResolvedValue({ opId: 'op_1', reason: 'WouldBreakBuild', message: 'CS0246' });

    s.useApp.getState().removeCustomView('view_b');
    await flush();

    expect(ids(s)).toEqual(['view_a', 'view_b']);
    expect(s.useApp.getState().toast?.kind).toBe('error');
  });

  it('a view whose save could not be sent is not left looking saved', async () => {
    const s = await session();
    await open(s, empty(), [A]);
    s.api.saveServerView.mockRejectedValue(new Error('network down'));

    s.useApp.getState().upsertCustomView(cached(B));
    await flush();

    expect(ids(s)).toEqual(['view_a']);
    expect(s.useApp.getState().toast?.kind).toBe('error');
  });
});
