import { describe, expect, it } from 'vitest';
import { COALESCE_MS, History, type HistoryDriver, type PresentationChange } from './history';

/** A driver that records what it was asked to do, against an engine stack it keeps the depth of. */
function fakeDriver() {
  const calls: string[] = [];
  const engine = { undo: 0, redo: 0 };
  const applied: { which: 'before' | 'after'; changes: PresentationChange[] }[] = [];
  const driver: HistoryDriver = {
    undoLayout: () => { calls.push('undoLayout'); return true; },
    redoLayout: () => { calls.push('redoLayout'); return true; },
    undoOperation: async () => { calls.push('undoOp'); engine.undo--; engine.redo++; return true; },
    redoOperation: async () => { calls.push('redoOp'); engine.redo--; engine.undo++; return true; },
    depths: async () => ({ ...engine }),
    applyPresentation: (changes, which) => { calls.push(`present:${which}`); applied.push({ which, changes }); },
  };
  return { driver, calls, engine, applied };
}

/** An operation this window applied: on the engine's stack, and in the journal. */
function op(h: History, engine: { undo: number; redo: number }, description = 'op') {
  engine.undo++;
  engine.redo = 0;
  h.recordOperation(description);
}

describe('History', () => {
  it('undoes the last thing done, whichever stack it went to', async () => {
    // The order that used to be wrong: a move, then an edit. ⌘Z must take back the edit first.
    const { driver, calls, engine } = fakeDriver();
    const h = new History(driver);
    h.recordLayout('Move node');
    op(h, engine, 'Rename');

    expect(await h.undo()).toBe('Rename');
    expect(await h.undo()).toBe('Move node');
    expect(calls).toEqual(['undoOp', 'undoLayout']);
  });

  it('undoes a group of operations in one step, and redoes it in one', async () => {
    const { driver, calls, engine } = fakeDriver();
    const h = new History(driver);
    h.beginGroup('Paste 2 elements');
    op(h, engine); op(h, engine); op(h, engine);
    h.recordPresentation([{ section: 'nodeStyles', id: 'mod_2', before: undefined, after: { borderWidth: 2 } }], 'style');
    h.endGroup(engine.undo);

    expect(h.undoDescription).toBe('Paste 2 elements');
    expect(await h.undo()).toBe('Paste 2 elements');
    // Its looks first — they were set after the elements existed — then every operation.
    expect(calls).toEqual(['present:before', 'undoOp', 'undoOp', 'undoOp']);
    expect(engine).toEqual({ undo: 0, redo: 3 });

    calls.length = 0;
    expect(await h.redo()).toBe('Paste 2 elements');
    expect(calls).toEqual(['redoOp', 'redoOp', 'redoOp', 'present:after']);
    expect(engine).toEqual({ undo: 3, redo: 0 });

    // And again, now that the depths it checks against were taken after the redo.
    calls.length = 0;
    await h.undo();
    expect(calls).toEqual(['present:before', 'undoOp', 'undoOp', 'undoOp']);
  });

  it('undoes one operation of a group when someone else edited since', async () => {
    const { driver, calls, engine } = fakeDriver();
    const h = new History(driver);
    h.beginGroup('Paste 2 elements');
    op(h, engine); op(h, engine);
    h.endGroup(engine.undo);
    engine.undo++; // another window's edit, which this journal never saw

    await h.undo();
    expect(calls).toEqual(['undoOp']);
    // What is left of the step cannot be told apart from theirs, so it is not offered again.
    expect(h.canRedo).toBe(false);
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
    expect(h.undoDescription).toBe('x');
    // Two steps, not one.
    void h.undo();
    expect(h.canUndo).toBe(true);
  });

  it('keeps what an undo does out of the journal', async () => {
    const { driver, engine } = fakeDriver();
    const h = new History({
      ...driver,
      // Undoing a look sets it back through the same setter that records looks.
      applyPresentation: () => h.recordPresentation([{ section: 'nodeStyles', id: 'a', before: 1, after: 2 }], 'echo'),
    });
    h.recordPresentation([{ section: 'nodeStyles', id: 'a', before: undefined, after: {} }], 'Change appearance');
    op(h, engine);
    await h.undo();
    await h.undo();
    expect(h.canUndo).toBe(false);
    expect(h.redoDescription).toBe('Change appearance');
  });

  it('a new step drops what could have been redone', async () => {
    const { driver, engine } = fakeDriver();
    const h = new History(driver);
    op(h, engine, 'first');
    await h.undo();
    expect(h.canRedo).toBe(true);
    op(h, engine, 'second');
    expect(h.canRedo).toBe(false);
  });

  it('an empty group is no step at all', () => {
    const { driver } = fakeDriver();
    const h = new History(driver);
    h.beginGroup('Paste');
    h.endGroup(0);
    expect(h.canUndo).toBe(false);
  });

  it('returns null with nothing to undo, so the caller can fall back', async () => {
    const { driver } = fakeDriver();
    expect(await new History(driver).undo()).toBeNull();
  });
});
