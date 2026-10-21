import { describe, expect, it } from 'vitest';
import { LayoutUndoStack, diffPositions, isEmptyDiff, type LayoutUndoEntry } from './layoutUndo';
import { history } from './history';

function entry(over: Partial<LayoutUndoEntry> = {}): LayoutUndoEntry {
  return {
    workspaceRoot: '/ws',
    viewKey: 'moduleMap',
    before: {},
    after: {},
    description: 'test',
    ts: Date.now(),
    ...over,
  };
}

describe('diffPositions', () => {
  it('returns empty diff for identical maps', () => {
    const a = { n1: { x: 10, y: 20 } };
    const d = diffPositions(a, a);
    expect(isEmptyDiff(d)).toBe(true);
  });

  it('captures only the moved entries', () => {
    const before = { n1: { x: 10, y: 20 }, n2: { x: 30, y: 30 } };
    const after = { n1: { x: 10, y: 20 }, n2: { x: 50, y: 50 } };
    const d = diffPositions(before, after);
    expect(d.before).toEqual({ n2: { x: 30, y: 30 } });
    expect(d.after).toEqual({ n2: { x: 50, y: 50 } });
  });

  it('treats add and remove as one-sided diffs', () => {
    const before = { n1: { x: 10, y: 20 } };
    const after = { n2: { x: 100, y: 100 } };
    const d = diffPositions(before, after);
    expect(d.before).toEqual({ n1: { x: 10, y: 20 } });
    expect(d.after).toEqual({ n2: { x: 100, y: 100 } });
  });
});

describe('LayoutUndoStack', () => {
  it('starts empty', () => {
    const s = new LayoutUndoStack();
    expect(s.canUndo).toBe(false);
    expect(s.canRedo).toBe(false);
  });

  it('push then undo moves entry into redo', () => {
    const s = new LayoutUndoStack();
    s.push(entry({ description: 'Move node' }));
    expect(s.canUndo).toBe(true);
    expect(s.undoDescription).toBe('Move node');
    const popped = s.popUndo();
    expect(popped?.description).toBe('Move node');
    expect(s.canUndo).toBe(false);
    expect(s.canRedo).toBe(true);
  });

  it('redo replays the entry back onto the undo stack', () => {
    const s = new LayoutUndoStack();
    s.push(entry({ description: 'A' }));
    s.popUndo();
    const replayed = s.popRedo();
    expect(replayed?.description).toBe('A');
    expect(s.canUndo).toBe(true);
    expect(s.canRedo).toBe(false);
  });

  it('folds a run of nudges to the same boxes into one step, and a pause starts the next', () => {
    history.clear();
    const s = new LayoutUndoStack();
    s.push(entry({ description: 'Nudge', key: 'nudge:n1', ts: 1000, before: { n1: { x: 0, y: 0 } }, after: { n1: { x: 10, y: 0 } } }));
    s.push(entry({ description: 'Nudge', key: 'nudge:n1', ts: 1300, before: { n1: { x: 10, y: 0 } }, after: { n1: { x: 20, y: 0 } } }));

    expect(history.undoDescription).toBe('Nudge');
    const folded = s.popUndo();
    expect(folded?.before).toEqual({ n1: { x: 0, y: 0 } });
    expect(folded?.after).toEqual({ n1: { x: 20, y: 0 } });
    expect(s.canUndo).toBe(false);

    s.popRedo();
    s.push(entry({ description: 'Nudge', key: 'nudge:n1', ts: 5000, before: { n1: { x: 20, y: 0 } }, after: { n1: { x: 30, y: 0 } } }));
    s.popUndo();
    expect(s.canUndo).toBe(true);
  });

  it('a new push clears the redo branch', () => {
    const s = new LayoutUndoStack();
    s.push(entry({ description: 'A' }));
    s.popUndo();
    expect(s.canRedo).toBe(true);
    s.push(entry({ description: 'B' }));
    expect(s.canRedo).toBe(false);
  });

  it('caps at 100 entries (drops oldest), as the undo journal does', () => {
    const s = new LayoutUndoStack();
    for (let i = 0; i < 110; i++) s.push(entry({ description: `op${i}` }));
    // The stack keeps the most recent 100 — every move the journal (history.ts) can still name.
    let count = 0;
    while (s.popUndo()) count++;
    expect(count).toBe(100);
  });

  it('forgets every move when another workspace opens', () => {
    const s = new LayoutUndoStack();
    s.push(entry({}));
    s.popUndo();
    s.push(entry({}));
    s.clear();
    expect(s.canUndo).toBe(false);
    expect(s.canRedo).toBe(false);
  });

  it('subscribers are notified on push and pop', () => {
    const s = new LayoutUndoStack();
    let calls = 0;
    const off = s.subscribe(() => { calls++; });
    s.push(entry());
    s.popUndo();
    s.popRedo();
    off();
    s.push(entry());
    expect(calls).toBe(3);
  });
});
