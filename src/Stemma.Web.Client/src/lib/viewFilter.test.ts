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
