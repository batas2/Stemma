// Reversing a relationship, or dragging one of its ends to another box, is the link removed and added
// again. A Relation once came back as a Dependency with a new id and no label, and a refused add left
// the relationship deleted. The added link is the same relationship, and a refusal puts it back.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ArchLink, OperationEnvelope, OperationResult } from './types';

const sent: OperationEnvelope[] = [];
let refuse: (op: OperationEnvelope) => boolean = () => false;
let undone = 0;

vi.mock('./signalr', () => ({
  applyOperation: async (op: OperationEnvelope): Promise<OperationResult> => {
    sent.push(op);
    if (refuse(op)) return { opId: op.opId, reason: 'InvalidLink', message: 'Not allowed between these.' };
    const { history } = await import('./history');
    history.recordOperation(op.kind);
    return { opId: op.opId, deltas: op.kind === 'AddLink' ? [{ kind: 'LinkAdded', id: 'lnk_new' }] : [] };
  },
  addedId: (r: OperationResult) => ('deltas' in r ? (r.deltas as { id?: string }[])[0]?.id ?? null : null),
  fetchUndoState: async () => ({ undoTop: 7 }),
}));

const { history, setHistoryDriver } = await import('./history');
const { useApp } = await import('./store');
const { relink } = await import('./relink');

const relation: ArchLink = { id: 'rel_1', fromId: 'a', toId: 'b', kind: 'relation', attributes: { label: 'reviews' } };

beforeEach(() => {
  sent.length = 0;
  refuse = () => false;
  undone = 0;
  history.clear();
  setHistoryDriver({
    undoLayout: () => false, redoLayout: () => false,
    undoOperation: async () => { undone++; return true; },
    redoOperation: async () => false,
    tops: async () => null,
    applyPresentation: () => {},
  });
  useApp.setState({
    arch: { filePath: 'Architecture.cs', elements: [], links: [relation], tags: [{ targetId: 'rel_1', lifecycle: { status: 'Planned', phase: null, validFrom: null, validUntil: null }, ownership: { squad: 'Payments', domain: null } }] },
  } as never);
});

describe('relink', () => {
  it('reverses a Relation as a Relation, with its label, status and owner', async () => {
    const { id, error } = await relink(relation, 'b', 'a', 'Reverse relationship');

    expect(error).toBeNull();
    expect(id).toBe('lnk_new');
    expect(sent.map((o) => o.kind)).toEqual(['RemoveLink', 'AddLink', 'SetLinkAttribute', 'SetLifecycle', 'SetOwnership']);
    expect(sent[1]).toMatchObject({ linkKind: 'relation', fromId: 'b', toId: 'a' });
    expect(sent[2]).toMatchObject({ linkId: 'lnk_new', attributeName: 'label', value: 'reviews' });
    expect(sent[3]).toMatchObject({ targetId: 'lnk_new', status: 'Planned' });
    expect(sent[4]).toMatchObject({ targetId: 'lnk_new', squad: 'Payments' });
    // One step of the undo history, not five.
    expect(history.undoDescription).toBe('Reverse relationship');
  });

  it('keeps a data flow\'s payload and direction, and a dependency\'s kind', async () => {
    await relink({ id: 'df', fromId: 'a', toId: 'b', kind: 'dataFlow', attributes: { payload: 'OrderPlaced', direction: 'push' } }, 'b', 'c', 'Reconnect relationship');
    expect(sent[1]).toMatchObject({ linkKind: 'dataFlow', payload: 'OrderPlaced', direction: 'push', dependencyKind: null });

    sent.length = 0;
    await relink({ id: 'dep', fromId: 'a', toId: 'b', kind: 'dependency', attributes: { kind: 'reads' } }, 'b', 'a', 'Reverse relationship');
    expect(sent[1]).toMatchObject({ linkKind: 'dependency', dependencyKind: 'reads', payload: null });
  });

  it('puts the relationship back when its new ends are refused', async () => {
    refuse = (op) => op.kind === 'AddLink';

    const { id, error } = await relink(relation, 'b', 'a', 'Reverse relationship');

    expect(id).toBeNull();
    expect(error).toBe('Not allowed between these.');
    expect(undone).toBe(1);
    expect(history.canUndo).toBe(false);
  });
});
