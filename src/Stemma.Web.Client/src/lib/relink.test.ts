// Reversing a relationship, or dragging one of its ends to another box, moves its ends in place
// (B-028). It used to be the link removed and added again: a new id, a new line at the end of the
// file, and a data flow's technology, its comments and the book steps that played it left behind.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ArchLink, OperationEnvelope, OperationResult } from './types';
import type { PresentationChange } from './history';

const sent: OperationEnvelope[] = [];
let refuse: (op: OperationEnvelope) => boolean = () => false;
const applied: { changes: PresentationChange[]; which: 'before' | 'after' }[] = [];

vi.mock('./signalr', () => ({
  applyOperation: async (op: OperationEnvelope): Promise<OperationResult> => {
    sent.push(op);
    if (refuse(op)) return { opId: op.opId, reason: 'ToNotFound', message: 'cnt_gone' };
    const { history } = await import('./history');
    history.recordOperation(op.kind);
    return { opId: op.opId, deltas: [] };
  },
}));

const { history, setHistoryDriver } = await import('./history');
const { useApp } = await import('./store');
const { loadEdgeHandles, loadEdgeWaypoints, setSidecarCacheForTest } = await import('./layout');
const { relink } = await import('./relink');

const root = '/ws/relink';
const flow: ArchLink = { id: 'flow_orders', fromId: 'a', toId: 'b', kind: 'dataFlow', attributes: { payload: 'Order', technology: 'AMQP' } };

beforeEach(() => {
  sent.length = 0;
  applied.length = 0;
  refuse = () => false;
  history.clear();
  setHistoryDriver({
    undoLayout: () => false, redoLayout: () => false,
    undoOperation: async () => true,
    redoOperation: async () => true,
    tops: async () => null,
    applyPresentation: (changes, which) => { applied.push({ changes, which }); },
  });
  useApp.setState({ workspace: { rootPath: root, projects: [] } } as never);
  setSidecarCacheForTest(root, {
    version: 1,
    views: {
      moduleMap: { edges: { flow_orders: { handles: { source: 'r', target: 'l' }, waypoints: [{ x: 1, y: 1 }, { x: 2, y: 2 }] } } },
      view_buy: { edges: { flow_orders: { waypoints: [{ x: 5, y: 0 }, { x: 6, y: 0 }, { x: 7, y: 0 }] }, other: { handles: { source: 't' } } } },
    },
  });
});

describe('relink', () => {
  it('reverses a relationship with one operation that keeps its id', async () => {
    const { id, error } = await relink(flow, 'b', 'a', 'Reverse relationship');

    expect(error).toBeNull();
    expect(id).toBe('flow_orders');
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ kind: 'SetLinkEnds', linkId: 'flow_orders', fromId: 'b', toId: 'a' });
    expect(history.undoDescription).toBe('Reverse relationship');
  });

  it('turns the drawing round on every view: the docked dots swap ends and the bends run backwards', async () => {
    await relink(flow, 'b', 'a', 'Reverse relationship');

    expect(loadEdgeHandles(root, 'moduleMap').flow_orders).toEqual({ source: 'l', target: 'r' });
    expect(loadEdgeWaypoints(root, 'moduleMap').flow_orders).toEqual([{ x: 2, y: 2 }, { x: 1, y: 1 }]);
    expect(loadEdgeWaypoints(root, 'view_buy').flow_orders).toEqual([{ x: 7, y: 0 }, { x: 6, y: 0 }, { x: 5, y: 0 }]);
    // Another relationship's drawing is not touched.
    expect(loadEdgeHandles(root, 'view_buy').other).toEqual({ source: 't' });
  });

  it('undoes the model edit and the drawing as one step', async () => {
    await relink(flow, 'b', 'a', 'Reverse relationship');
    await history.undo();

    expect(applied).toHaveLength(1);
    expect(applied[0].which).toBe('before');
    const sections = applied[0].changes.map((c) => `${c.section}:${c.view}`).sort();
    expect(sections).toEqual(['handles:moduleMap', 'waypoints:moduleMap', 'waypoints:view_buy']);
    expect(applied[0].changes.find((c) => c.section === 'handles')!.before).toEqual({ source: 'r', target: 'l' });
    expect(history.canUndo).toBe(false);
  });

  it('reconnects one end and docks it to the dot it was dropped on, leaving the bends alone', async () => {
    const { id } = await relink(flow, 'a', 'c', 'Reconnect relationship', { view: 'moduleMap', handles: { source: 'r', target: 't' } });

    expect(id).toBe('flow_orders');
    expect(sent[0]).toMatchObject({ kind: 'SetLinkEnds', linkId: 'flow_orders', fromId: 'a', toId: 'c' });
    expect(loadEdgeHandles(root, 'moduleMap').flow_orders).toEqual({ source: 'r', target: 't' });
    expect(loadEdgeWaypoints(root, 'moduleMap').flow_orders).toEqual([{ x: 1, y: 1 }, { x: 2, y: 2 }]);
  });

  it('changes nothing when the new ends are refused', async () => {
    refuse = () => true;

    const { id, error } = await relink(flow, 'b', 'a', 'Reverse relationship');

    expect(id).toBeNull();
    expect(error).toBeTruthy();
    expect(history.canUndo).toBe(false);
    expect(loadEdgeHandles(root, 'moduleMap').flow_orders).toEqual({ source: 'r', target: 'l' });
  });

  it('says another change is still being written rather than sending a second one into it', async () => {
    history.beginGroup('Paste');
    const { error } = await relink(flow, 'b', 'a', 'Reverse relationship');
    history.endGroup();

    expect(error).toMatch(/still being written/);
    expect(sent).toHaveLength(0);
  });

  it('sends nothing for a loop on one box, which reversed is the same relationship', async () => {
    const loop: ArchLink = { id: 'rel_self', fromId: 'a', toId: 'a', kind: 'relation', attributes: {} };
    const { id, error } = await relink(loop, 'a', 'a', 'Reverse relationship');

    expect({ id, error }).toEqual({ id: 'rel_self', error: null });
    expect(sent).toHaveLength(0);
    expect(history.canUndo).toBe(false);
  });
});
