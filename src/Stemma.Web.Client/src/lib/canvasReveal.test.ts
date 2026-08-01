// Epic 13 — tests for the pure id-diff used to identify a just-added element. The async
// reveal (view switch + select + center) wraps this; the diff is the testable core.

import { describe, expect, it } from 'vitest';
import { firstNewId } from './canvasReveal';

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
