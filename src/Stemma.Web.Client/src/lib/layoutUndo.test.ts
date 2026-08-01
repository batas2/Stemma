import { describe, expect, it } from 'vitest';
import { LayoutUndoStack, diffPositions, isEmptyDiff, type LayoutUndoEntry } from './layoutUndo';

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

  it('a new push clears the redo branch', () => {
    const s = new LayoutUndoStack();
    s.push(entry({ description: 'A' }));
    s.popUndo();
    expect(s.canRedo).toBe(true);
    s.push(entry({ description: 'B' }));
    expect(s.canRedo).toBe(false);
  });

  it('caps at 50 entries (drops oldest)', () => {
    const s = new LayoutUndoStack();
    for (let i = 0; i < 60; i++) s.push(entry({ description: `op${i}` }));
    // The stack keeps the most recent 50; the oldest 10 ("op0".."op9") are dropped.
    let count = 0;
    while (s.popUndo()) count++;
    expect(count).toBe(50);
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
