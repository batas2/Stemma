// Which elements a view draws. B-020: the Module Map drew every Concept, though a Concept belongs to
// no built-in lens and appears only in the views that name it (ADR-0018, F-010 AC2).

import { describe, expect, it } from 'vitest';
import type { ArchModel } from './types';
import { filterByView } from './viewFilter';

const model: ArchModel = {
  filePath: '/ws/Architecture/Architecture.cs',
  elements: [
    { id: 'mod_a', name: 'A', kind: 'module', attributes: {} },
    { id: 'per_b', name: 'B', kind: 'person', attributes: {} },
    { id: 'con_c', name: 'C', kind: 'concept', attributes: {} },
  ],
  links: [
    { id: 'rel_ca', fromId: 'con_c', toId: 'mod_a', kind: 'relation', attributes: {} },
    { id: 'dep_ba', fromId: 'per_b', toId: 'mod_a', kind: 'dependency', attributes: {} },
  ],
  tags: [],
};

describe('which elements a view draws', () => {
  it('the Module Map draws every architecture kind and no Concept, nor a link to one', () => {
    const v = filterByView(model, 'moduleMap', null);
    expect(v.elements.map((e) => e.id)).toEqual(['mod_a', 'per_b']);
    expect(v.links.map((l) => l.id)).toEqual(['dep_ba']);
  });

  it('a view that names a Concept draws it, whatever its base lens', () => {
    const v = filterByView(model, 'moduleMap', { id: 'v', name: 'V', baseView: 'moduleMap', elementIds: ['con_c', 'mod_a'], createdAt: '' });
    expect(v.elements.map((e) => e.id)).toEqual(['mod_a', 'con_c']);
    expect(v.links.map((l) => l.id)).toEqual(['rel_ca']);
  });
});

describe('a view by rule (F-023, ADR-0026)', () => {
  const c4: ArchModel = {
    filePath: '/ws/Architecture/Architecture.cs',
    elements: [
      { id: 'per_x', name: 'Customer', kind: 'person', attributes: {} },
      { id: 'sys_p', name: 'Platform', kind: 'softwareSystem', attributes: {} },
      { id: 'cnt_app', name: 'App', kind: 'container', attributes: { systemId: 'sys_p' } },
      { id: 'cnt_api', name: 'API', kind: 'container', attributes: { systemId: 'sys_p' } },
      { id: 'sys_pay', name: 'Payments', kind: 'softwareSystem', attributes: {} },
      { id: 'mod_m', name: 'M', kind: 'module', attributes: {} },
    ],
    links: [
      { id: 'flow_use', fromId: 'per_x', toId: 'cnt_app', kind: 'dataFlow', attributes: { payload: 'uses' } },
      { id: 'flow_call', fromId: 'cnt_app', toId: 'cnt_api', kind: 'dataFlow', attributes: { payload: 'calls' } },
      { id: 'flow_pay', fromId: 'cnt_api', toId: 'sys_pay', kind: 'dataFlow', attributes: { payload: 'charges' } },
    ],
    tags: [],
  };

  it('draws what the engine resolved, not only what the view lists', () => {
    const v = filterByView(c4, 'moduleMap', {
      id: 'v', name: 'Containers', baseView: 'container', scope: 'sys_p', elementIds: [], createdAt: '',
      members: ['sys_p', 'cnt_app', 'cnt_api', 'per_x', 'sys_pay'],
    });
    expect(v.elements.map((e) => e.id)).toEqual(['per_x', 'sys_p', 'cnt_app', 'cnt_api', 'sys_pay']);
    expect(v.links.map((l) => l.id)).toEqual(['flow_use', 'flow_call', 'flow_pay']);
  });

  it('does not filter a C4 lens by kind, as the module map lens is filtered', () => {
    const v = filterByView(c4, 'moduleMap', {
      id: 'v', name: 'Context', baseView: 'systemContext', scope: 'sys_p', elementIds: [], createdAt: '',
      members: ['per_x', 'sys_p', 'sys_pay'],
      implied: [
        { id: '__implied__per_x__sys_p', fromId: 'per_x', toId: 'sys_p', linkIds: ['flow_use'] },
        { id: '__implied__sys_p__sys_pay', fromId: 'sys_p', toId: 'sys_pay', linkIds: ['flow_pay'] },
      ],
    });
    expect(v.elements.map((e) => e.id)).toEqual(['per_x', 'sys_p', 'sys_pay']);
    expect(v.links).toEqual([]);
    expect(v.implied.map((i) => i.id)).toEqual(['__implied__per_x__sys_p', '__implied__sys_p__sys_pay']);
  });

  it('drops an implied relationship whose end the view does not draw', () => {
    const v = filterByView(c4, 'moduleMap', {
      id: 'v', name: 'Context', baseView: 'systemContext', scope: 'sys_p', elementIds: [], createdAt: '',
      members: ['per_x', 'sys_p'],
      implied: [{ id: '__implied__sys_p__sys_pay', fromId: 'sys_p', toId: 'sys_pay', linkIds: ['flow_pay'] }],
    });
    expect(v.implied).toEqual([]);
  });

  it('falls back to the listed ids from a server that does not resolve views', () => {
    const v = filterByView(c4, 'moduleMap', { id: 'v', name: 'Old', baseView: 'all', elementIds: ['cnt_app', 'cnt_api'], createdAt: '' });
    expect(v.elements.map((e) => e.id)).toEqual(['cnt_app', 'cnt_api']);
    expect(v.implied).toEqual([]);
  });
});
