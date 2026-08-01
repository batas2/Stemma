// Add-element routing.
//
// The element palette offers seven kinds, but each built-in view renders only a subset.
// These two helpers make every kind land somewhere visible: `viewRendersKind` says whether
// a view switch is even needed, and `lensForKind` says where to switch to. With the two
// built-in lenses (Module Map + Dependencies), Module Map is the universal architecture
// canvas that renders every kind, so it is the default home.

import type { ViewKind, ArchElementKind } from './types';

/** Does this view render a freshly-added element of `kind`?
 *  Mirrors `ArchCanvas.applyBuiltIn`'s filters — keep the two in sync. */
export function viewRendersKind(view: ViewKind, kind: ArchElementKind): boolean {
  switch (view) {
    case 'moduleMap':
      return true; // the universal architecture canvas renders every kind
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
