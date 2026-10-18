// Add-element routing: every element kind must land in a view that renders it.

import { describe, expect, it } from 'vitest';
import type { ArchElementKind } from './types';
import { lensForKind, viewRendersKind } from './lenses';

const KINDS: ArchElementKind[] = [
  'module', 'boundedContext', 'softwareSystem', 'container', 'person', 'useCase', 'capability',
];

describe('add-element routing is bulletproof', () => {
  it('every element kind maps to a view that renders it (no add-into-the-void)', () => {
    for (const k of KINDS) {
      const t = lensForKind(k);
      expect(viewRendersKind(t.view, k), `${k} → ${t.view}`).toBe(true);
    }
  });

  it('Module Map is the architecture canvas — renders every architecture kind', () => {
    for (const k of KINDS) expect(viewRendersKind('moduleMap', k)).toBe(true);
  });

  // B-020: ADR-0018 gives a Concept no membership in any built-in lens; it appears only in the
  // views that name it. The Module Map drew every one of them.
  it('no built-in lens renders a Concept', () => {
    expect(viewRendersKind('moduleMap', 'concept')).toBe(false);
    expect(viewRendersKind('dependencyGraph', 'concept')).toBe(false);
  });

  it('Dependencies renders only the structural kinds', () => {
    expect(viewRendersKind('dependencyGraph', 'module')).toBe(true);
    expect(viewRendersKind('dependencyGraph', 'boundedContext')).toBe(true);
    expect(viewRendersKind('dependencyGraph', 'capability')).toBe(true);
    expect(viewRendersKind('dependencyGraph', 'person')).toBe(false);
    expect(viewRendersKind('dependencyGraph', 'softwareSystem')).toBe(false);
  });
});
