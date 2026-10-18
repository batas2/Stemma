// Add-element routing.
//
// The element palette offers every kind, but each built-in view renders only a subset.
// These two helpers make every architecture kind land somewhere visible: `viewRendersKind` says
// whether a view switch is even needed, and `lensForKind` says where to switch to. The Module Map
// is the architecture canvas and renders every kind but Concept, so it is the default home; a
// Concept has no built-in home and appears only in the views that name it.

import type { ViewKind, ArchElementKind } from './types';

/** Does this view render a freshly-added element of `kind`?
 *  Mirrors `ArchCanvas.applyBuiltIn`'s filters — keep the two in sync. */
export function viewRendersKind(view: ViewKind, kind: ArchElementKind): boolean {
  switch (view) {
    case 'moduleMap':
      // The architecture canvas renders every kind but Concept, which appears only in the views
      // that name it (ADR-0018, B-020).
      return kind !== 'concept';
    case 'dependencyGraph':
      return kind === 'module' || kind === 'boundedContext' || kind === 'capability';
    default:
      return false;
  }
}

/** The lens that reliably renders a newly-added element of `kind`. */
export function lensForKind(_kind: ArchElementKind): { view: ViewKind } {
  return { view: 'moduleMap' };
}
