import { describe, expect, it } from 'vitest';
import { EDGE_GROUPS, edgeColor, edgeLabel, type EdgeKind } from './discovery';

describe('edge presentation helpers', () => {
  it('groups every edge kind into exactly one category', () => {
    const allKinds: EdgeKind[] = [
      'inherits', 'implements', 'referencesType', 'instantiates', 'calls',
      'publishesInprocNotification', 'handlesInprocNotification',
      'sendsInprocRequest', 'handlesInprocRequest',
      'emitsEventAsync', 'consumesEventAsync',
      'sendsCommandAsync', 'handlesCommandAsync',
      'httpCall', 'grpcCall', 'grpcHandler', 'signalRCall', 'signalRHandler',
      'readsConfig', 'injects', 'dbContext',
    ];
    for (const k of allKinds) {
      const groups = EDGE_GROUPS.filter((g) => g.kinds.includes(k));
      expect(groups, `kind ${k} should be in exactly one group`).toHaveLength(1);
    }
  });

  it('colours each kind from its group', () => {
    expect(edgeColor('inherits')).toBe('#6366f1');
    expect(edgeColor('emitsEventAsync')).toBe('#f59e0b');
    expect(edgeColor('dbContext')).toBe('#a855f7');
  });

  it('humanises camelCase kind names', () => {
    expect(edgeLabel('emitsEventAsync')).toBe('Emits Event Async');
    expect(edgeLabel('dbContext')).toBe('Db Context');
  });
});
