// @vitest-environment happy-dom
// Epic 13 — tests for the pure id-diff used to identify a just-added element. The async
// reveal (view switch + select + center) wraps this; the diff is the testable core.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ArchModel, OperationResult } from './types';

vi.mock('./api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./api')>()),
  fetchLayout: vi.fn(() => new Promise(() => {})),
  patchLayoutSidecar: vi.fn(async () => null),
}));

const { revealNewElement } = await import('./canvasReveal');
const { useApp } = await import('./store');
const { loadLayout, setSidecarCacheForTest } = await import('./layout');

// The element just added was found as the first id the model had not had before. When another
// window added one at the same moment, that could be theirs: it was the one placed where this
// window's drop was, selected, and put into the open view. The engine says which id it made.
describe('revealNewElement', () => {
  const ROOT = '/ws/reveal';
  const arch = (ids: string[]): ArchModel => ({
    filePath: `${ROOT}/Architecture/Architecture.cs`,
    elements: ids.map((id) => ({ id, name: id, kind: 'module' as const, attributes: {} })),
    links: [],
    tags: [],
  });
  const added = (id: string): OperationResult => ({ opId: 'op_1', deltas: [{ kind: 'ElementAdded', id }] });

  beforeEach(() => {
    vi.useFakeTimers();
    localStorage.clear();
    useApp.setState({ workspace: { rootPath: ROOT, projects: [] }, view: 'moduleMap', activeCustomViewId: null, arch: arch(['mod_a']) });
  });
  afterEach(() => vi.useRealTimers());

  it('reveals the element the engine says it added, not the first new one', async () => {
    // Another window's element arrives first in the model, beside this window's.
    useApp.setState({ arch: arch(['mod_a', 'mod_theirs', 'mod_mine']) });
    const revealing = revealNewElement(added('mod_mine'), { dropPos: { x: 40, y: 60 } });
    await vi.advanceTimersByTimeAsync(2000);

    expect((await revealing)?.id).toBe('mod_mine');
    expect(useApp.getState().selectedElementId).toBe('mod_mine');
    const positions = loadLayout(ROOT, 'moduleMap');
    expect(positions.mod_mine).toEqual({ x: 40, y: 60 });
    expect(positions.mod_theirs).toBeUndefined();
  });

  it('waits for that element to arrive in the model', async () => {
    const revealing = revealNewElement(added('mod_mine'));
    await vi.advanceTimersByTimeAsync(200);
    useApp.setState({ arch: arch(['mod_a', 'mod_theirs', 'mod_mine']) });
    await vi.advanceTimersByTimeAsync(2000);

    expect((await revealing)?.id).toBe('mod_mine');
  });

  // F-021: a view laid out in layers places the new card with the others. A position written for it
  // into a view laid out by default took every card off the layout, and the next reload moved them all.
  it('writes no position into a view laid out in layers, and leaves placing the card to the layout', async () => {
    const root = '/ws/reveal-layered';
    setSidecarCacheForTest(root, { version: 1, views: {} });
    useApp.setState({ workspace: { rootPath: root, projects: [] }, arch: arch(['mod_a', 'mod_mine']) });
    const placed: unknown[] = [];
    const onPlace = (e: Event) => placed.push((e as CustomEvent).detail);
    window.addEventListener('stemma:place-node', onPlace);
    try {
      const revealing = revealNewElement(added('mod_mine'), { dropPos: { x: 40, y: 60 } });
      await vi.advanceTimersByTimeAsync(2000);

      expect((await revealing)?.id).toBe('mod_mine');
      expect(useApp.getState().selectedElementId).toBe('mod_mine');
      expect(loadLayout(root, 'moduleMap')).toEqual({});
      expect(placed).toEqual([]);
    } finally {
      window.removeEventListener('stemma:place-node', onPlace);
    }
  });

  it('places the card where it was dropped in a view someone arranged', async () => {
    const root = '/ws/reveal-arranged';
    setSidecarCacheForTest(root, { version: 1, views: { moduleMap: { nodes: { mod_a: { x: 0, y: 0 } } } } });
    useApp.setState({ workspace: { rootPath: root, projects: [] }, arch: arch(['mod_a', 'mod_mine']) });
    const revealing = revealNewElement(added('mod_mine'), { dropPos: { x: 40, y: 60 } });
    await vi.advanceTimersByTimeAsync(2000);

    expect((await revealing)?.id).toBe('mod_mine');
    expect(loadLayout(root, 'moduleMap').mod_mine).toEqual({ x: 40, y: 60 });
  });

  it('reveals nothing for a result that added nothing', async () => {
    useApp.setState({ arch: arch(['mod_a', 'mod_theirs']) });
    const revealing = revealNewElement({ opId: 'op_1', reason: 'NameTaken', message: 'taken' });
    await vi.advanceTimersByTimeAsync(2000);

    expect(await revealing).toBeNull();
  });
});
