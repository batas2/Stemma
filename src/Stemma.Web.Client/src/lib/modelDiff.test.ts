import { describe, expect, it } from 'vitest';
import { describeCounts, diffModels } from './modelDiff';
import type { ArchModel } from './types';

const base: ArchModel = {
  filePath: 'Architecture/Architecture.cs',
  elements: [
    { id: 'ctx_pay', name: 'Payments', kind: 'boundedContext', attributes: {} },
    { id: 'ctx_risk', name: 'Risk', kind: 'boundedContext', attributes: {} },
    { id: 'mod_auth', name: 'Authorise', kind: 'module', attributes: { contextId: 'ctx_pay' } },
    { id: 'mod_settle', name: 'Settle', kind: 'module', attributes: { contextId: 'ctx_pay' } },
    { id: 'cnt_gw', name: 'Gateway', kind: 'container', attributes: { systemId: 'sys', kind: 'service' } },
  ],
  links: [
    { id: 'df_1', fromId: 'mod_auth', toId: 'mod_settle', kind: 'dataFlow', attributes: { payload: 'Authorised' } },
    { id: 'dep_1', fromId: 'mod_settle', toId: 'cnt_gw', kind: 'dependency', attributes: { kind: 'uses' } },
  ],
  tags: [{ targetId: 'mod_auth', lifecycle: { status: 'target', phase: null, validFrom: null, validUntil: null }, ownership: null }],
};

function edit(fn: (m: ArchModel) => void): ArchModel {
  const m = structuredClone(base);
  fn(m);
  return m;
}

describe('diffModels', () => {
  it('finds nothing between a model and itself', () => {
    const d = diffModels(base, base);
    expect(d.counts.total).toBe(0);
    expect(describeCounts(d.counts)).toBe('No changes');
  });

  it('tells a rename from a removal: same id, new name, one change', () => {
    const d = diffModels(base, edit((m) => { m.elements[2].name = 'Authorise card'; }));
    expect(d.elements).toEqual([expect.objectContaining({ id: 'mod_auth', change: 'changed', details: ['Renamed from “Authorise”'] })]);
  });

  it('says where an element moved, by the names of the places', () => {
    const d = diffModels(base, edit((m) => { m.elements[3].attributes.contextId = 'ctx_risk'; }));
    expect(d.elements[0].details).toEqual(['Moved to “Risk” (was “Payments”)']);
  });

  it('reports a changed status and a new owner', () => {
    const d = diffModels(base, edit((m) => {
      m.tags = [{ targetId: 'mod_auth', lifecycle: { status: 'current', phase: null, validFrom: null, validUntil: null }, ownership: { squad: 'Pay', domain: null } }];
    }));
    expect(d.elements[0].details).toEqual(['Status target → current', 'Squad none → Pay']);
  });

  it('marks additions and removals, of elements and of the links that went with them', () => {
    const d = diffModels(base, edit((m) => {
      m.elements = m.elements.filter((e) => e.id !== 'mod_settle');
      m.links = [];
      m.elements.push({ id: 'mod_new', name: 'Refund', kind: 'module', attributes: {} });
    }));
    expect(d.elementChange.get('mod_settle')).toBe('removed');
    expect(d.elementChange.get('mod_new')).toBe('added');
    expect(d.linkChange.get('df_1')).toBe('removed');
    expect(d.counts).toEqual({ added: 1, removed: 3, changed: 0, total: 4 });
    expect(describeCounts(d.counts)).toBe('1 added · 3 removed');
  });

  it('says what changed about a link', () => {
    const d = diffModels(base, edit((m) => {
      m.links[0].attributes.payload = 'Captured';
      m.links[1].attributes.kind = 'calls';
    }));
    expect(d.links.map((l) => l.details)).toEqual([['Payload “Authorised” → “Captured”'], ['Kind “uses” → “calls”']]);
  });

  it('notices a container moved to another kind', () => {
    const d = diffModels(base, edit((m) => { m.elements[4].attributes.kind = 'worker'; }));
    expect(d.elements[0].details).toEqual(['Container kind service → worker']);
  });

  it('counts everything as new against a model that did not exist', () => {
    const d = diffModels(null, base);
    expect(d.counts.added).toBe(base.elements.length + base.links.length);
    expect(d.counts.removed).toBe(0);
  });
});
