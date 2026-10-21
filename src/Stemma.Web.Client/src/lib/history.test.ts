import { describe, expect, it } from 'vitest';
import { COALESCE_MS, History, type HistoryDriver, type PresentationChange } from './history';

/** A driver that records what it was asked to do, against an engine stack whose entries are numbered. */
function fakeDriver() {
  const calls: string[] = [];
  const engine = { undo: [] as number[], redo: [] as number[], pushed: 0, fail: false };
  const applied: { which: 'before' | 'after'; changes: PresentationChange[] }[] = [];
  const driver: HistoryDriver = {
    undoLayout: () => { calls.push('undoLayout'); return true; },
    redoLayout: () => { calls.push('redoLayout'); return true; },
    undoOperation: async () => {
      calls.push('undoOp');
      if (engine.fail || engine.undo.length === 0) return false;
      engine.redo.push(engine.undo.pop()!);
      return true;
    },
    redoOperation: async () => {
      calls.push('redoOp');
      if (engine.fail || engine.redo.length === 0) return false;
      engine.undo.push(engine.redo.pop()!);
      return true;
    },
    tops: async () => ({ undo: engine.undo.at(-1) ?? 0, redo: engine.redo.at(-1) ?? 0 }),
    applyPresentation: (changes, which) => { calls.push(`present:${which}`); applied.push({ which, changes }); },
  };
  /** An edit made somewhere: on the engine's stack, and nothing more. */
  const edit = () => { engine.undo.push(++engine.pushed); engine.redo = []; };
  return { driver, calls, engine, applied, edit };
}

/** An operation this window applied: on the engine's stack, and in the journal. */
function op(h: History, edit: () => void, description = 'op') {
  edit();
  h.recordOperation(description);
}

const top = (engine: { undo: number[] }) => engine.undo.at(-1) ?? 0;

describe('History', () => {
  it('undoes the last thing done, whichever stack it went to', async () => {
    // The order that used to be wrong: a move, then an edit. ⌘Z must take back the edit first.
    const { driver, calls, edit } = fakeDriver();
    const h = new History(driver);
    h.recordLayout('Move node');
    op(h, edit, 'Rename');

    expect(await h.undo()).toBe('Rename');
    expect(await h.undo()).toBe('Move node');
    expect(calls).toEqual(['undoOp', 'undoLayout']);
  });

  it('undoes a group of operations in one step, and redoes it in one', async () => {
    const { driver, calls, engine, edit } = fakeDriver();
    const h = new History(driver);
    expect(h.beginGroup('Paste 2 elements')).toBe(true);
    op(h, edit); op(h, edit); op(h, edit);
    h.recordPresentation([{ section: 'nodeStyles', id: 'mod_2', before: undefined, after: { borderWidth: 2 } }], 'style');
    h.endGroup(top(engine));

    expect(h.undoDescription).toBe('Paste 2 elements');
    expect(await h.undo()).toBe('Paste 2 elements');
    // Every operation, then its looks.
    expect(calls).toEqual(['undoOp', 'undoOp', 'undoOp', 'present:before']);
    expect(engine.undo).toEqual([]);

    calls.length = 0;
    expect(await h.redo()).toBe('Paste 2 elements');
    expect(calls).toEqual(['redoOp', 'redoOp', 'redoOp', 'present:after']);
    expect(engine.undo).toEqual([1, 2, 3]);

    // And again, now that the entry it checks against was read after the redo.
    calls.length = 0;
    await h.undo();
    expect(calls).toEqual(['undoOp', 'undoOp', 'undoOp', 'present:before']);
  });

  it('undoes one operation of a group when someone else edited since, even on a full stack', async () => {
    const { driver, calls, engine, edit } = fakeDriver();
    const h = new History(driver);
    h.beginGroup('Paste 2 elements');
    op(h, edit); op(h, edit);
    h.endGroup(top(engine));
    edit(); // another window's edit, which this journal never saw

    await h.undo();
    expect(calls).toEqual(['undoOp']);
    // What is left of the step cannot be told apart from theirs, so it is not offered again.
    expect(h.canRedo).toBe(false);
  });

  it('drops a step the engine could not take back, rather than offering it again', async () => {
    const { driver, engine, edit } = fakeDriver();
    const h = new History(driver);
    op(h, edit, 'Rename');
    await h.undo();
    engine.fail = true; // another window edited, and the engine's redo branch went with it
    expect(await h.redo()).toBeNull();
    expect(h.lastFailed).toBe(true);
    expect(h.canUndo).toBe(false);
    expect(h.canRedo).toBe(false);
  });

  it('runs undos one after another, however fast they are asked for', async () => {
    const { driver, calls, engine, edit } = fakeDriver();
    const h = new History(driver);
    h.beginGroup('Paste');
    op(h, edit); op(h, edit);
    h.endGroup(top(engine));
    op(h, edit, 'Rename');

    const [first, second] = await Promise.all([h.undo(), h.undo()]);
    expect([first, second]).toEqual(['Rename', 'Paste']);
    expect(calls).toEqual(['undoOp', 'undoOp', 'undoOp']);
    expect(engine.undo).toEqual([]);
  });

  it('undoes nothing while a group is still being recorded, and starts no second group', async () => {
    const { driver, calls, edit } = fakeDriver();
    const h = new History(driver);
    op(h, edit, 'Rename');
    h.beginGroup('Paste');
    op(h, edit);
    expect(h.beginGroup('Paste style')).toBe(false);
    expect(await h.undo()).toBeNull();
    expect(calls).toEqual([]);
  });

  it('folds a run of changes to one thing into one step, and a pause starts the next', async () => {
    let t = 0;
    const { driver, applied } = fakeDriver();
    const h = new History(driver, () => t);
    const change = (from: number, to: number): PresentationChange => ({ section: 'nodeStyles', id: 'm', before: { borderWidth: from }, after: { borderWidth: to } });

    h.recordPresentation([change(1, 2)], 'Change appearance', 'nodeStyles:m');
    t += 100; h.recordPresentation([change(2, 3)], 'Change appearance', 'nodeStyles:m');
    t += 100; h.recordPresentation([change(3, 4)], 'Change appearance', 'nodeStyles:m');
    t += COALESCE_MS + 1; h.recordPresentation([change(4, 5)], 'Change appearance', 'nodeStyles:m');

    await h.undo();
    expect(applied.at(-1)?.changes[0]).toMatchObject({ before: { borderWidth: 4 } });
    await h.undo();
    // The slider's whole run, put back to where it started.
    expect(applied.at(-1)?.changes[0]).toMatchObject({ before: { borderWidth: 1 }, after: { borderWidth: 4 } });
    expect(h.canUndo).toBe(false);
  });

  it('does not fold changes to different things', () => {
    const { driver } = fakeDriver();
    const h = new History(driver, () => 0);
    h.recordPresentation([{ section: 'nodeStyles', id: 'a', before: undefined, after: {} }], 'x', 'nodeStyles:a');
    h.recordPresentation([{ section: 'nodeStyles', id: 'b', before: undefined, after: {} }], 'x', 'nodeStyles:b');
    void h.undo();
    expect(h.canUndo).toBe(true);
  });

  it('keeps what an undo does out of the journal', async () => {
    const { driver, edit } = fakeDriver();
    const h = new History({
      ...driver,
      // Undoing a look sets it back through the same setter that records looks.
      applyPresentation: () => h.recordPresentation([{ section: 'nodeStyles', id: 'a', before: 1, after: 2 }], 'echo'),
    });
    h.recordPresentation([{ section: 'nodeStyles', id: 'a', before: undefined, after: {} }], 'Change appearance');
    op(h, edit);
    await h.undo();
    await h.undo();
    expect(h.canUndo).toBe(false);
    expect(h.redoDescription).toBe('Change appearance');
  });

  it('a new step drops what could have been redone', async () => {
    const { driver, edit } = fakeDriver();
    const h = new History(driver);
    op(h, edit, 'first');
    await h.undo();
    expect(h.canRedo).toBe(true);
    op(h, edit, 'second');
    expect(h.canRedo).toBe(false);
  });

  it('forgets everything when another workspace opens', () => {
    const { driver, edit } = fakeDriver();
    const h = new History(driver);
    op(h, edit);
    h.beginGroup('Paste');
    h.clear();
    expect(h.canUndo).toBe(false);
    expect(h.groupOpen).toBe(false);
  });

  it('an empty group is no step at all', () => {
    const { driver } = fakeDriver();
    const h = new History(driver);
    h.beginGroup('Paste');
    h.endGroup(0);
    expect(h.canUndo).toBe(false);
  });

  it('a group that takes back its own operation leaves no step that would undo someone else\'s', async () => {
    const { driver, engine, edit } = fakeDriver();
    const h = new History(driver);
    op(h, edit, 'earlier');
    await h.undo();
    op(h, edit, 'before');
    h.beginGroup('Reverse relationship');
    op(h, edit, 'remove');
    expect(await h.takeBackInGroup()).toBe(true);
    h.endGroup(top(engine));

    // One step to undo, and it is "before" — not the removal, which the engine no longer holds as ours.
    expect(h.undoDescription).toBe('before');
    expect(h.canRedo).toBe(false);
    expect(await h.takeBackInGroup()).toBe(false);
  });

  it('returns null with nothing to undo, so the caller can fall back', async () => {
    const { driver } = fakeDriver();
    expect(await new History(driver).undo()).toBeNull();
  });
});
