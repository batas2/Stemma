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

const { firstNewId, revealNewElement } = await import('./canvasReveal');
const { useApp } = await import('./store');
const { loadLayout } = await import('./layout');

describe('Epic 13 — firstNewId', () => {
  it('returns the id present now but not before', () => {
    expect(firstNewId(new Set(['a', 'b']), [{ id: 'a' }, { id: 'b' }, { id: 'c' }])).toBe('c');
  });

  it('returns null when nothing is new', () => {
    expect(firstNewId(new Set(['a', 'b']), [{ id: 'a' }, { id: 'b' }])).toBeNull();
  });

  it('returns null for an empty model', () => {
    expect(firstNewId(new Set(), [])).toBeNull();
  });

  it('returns the first new id when several appeared', () => {
    expect(firstNewId(new Set(['a']), [{ id: 'a' }, { id: 'x' }, { id: 'y' }])).toBe('x');
  });
});

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

  it('reveals nothing for a result that added nothing', async () => {
    useApp.setState({ arch: arch(['mod_a', 'mod_theirs']) });
    const revealing = revealNewElement({ opId: 'op_1', reason: 'NameTaken', message: 'taken' });
    await vi.advanceTimersByTimeAsync(2000);

    expect(await revealing).toBeNull();
  });
});
