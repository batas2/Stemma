/**
 * Which elements and links a view draws — the one rule the canvas, the legend and the report share.
 *
 * A view from `Views/` draws the elements it names, through its base lens's kind filter. A built-in
 * lens draws by kind: the Module Map every architecture kind (not Concept, which belongs to no
 * built-in lens — ADR-0018, B-020), the dependency lens modules, contexts and capabilities joined
 * by dependencies.
 */

import type { ArchElement, ArchLink, ArchModel, CustomView, ViewKind } from './types';

export interface FilteredView {
  elements: ArchElement[];
  links: ArchLink[];
}

export function filterByView(arch: ArchModel, view: ViewKind, customView: CustomView | null): FilteredView {
  if (customView) {
    const inView = arch.elements.filter((e) => customView.elementIds.includes(e.id));
    let elements = inView;
    if (customView.baseView !== 'all') {
      elements = applyKindFilter(inView, customView.baseView as ViewKind);
    }
    const ids = new Set(elements.map((e) => e.id));
    const links = arch.links.filter((l) => ids.has(l.fromId) && ids.has(l.toId));
    return { elements, links };
  }
  return applyBuiltIn(arch, view);
}

export function applyKindFilter(elements: ArchElement[], view: ViewKind): ArchElement[] {
  switch (view) {
    case 'dependencyGraph': return elements.filter((e) => e.kind === 'module' || e.kind === 'boundedContext' || e.kind === 'capability');
    case 'moduleMap':
    // A view that names a Concept draws it, whatever its base lens: naming it is the point.
    default: return elements;
  }
}

/**
 * The built-in lenses. The Module Map is the architecture canvas: every kind but Concept, which
 * belongs to no built-in lens and appears only in the views that name it (ADR-0018, B-020).
 */
export function applyBuiltIn(arch: ArchModel, view: ViewKind): FilteredView {
  if (view === 'dependencyGraph') {
    // Include Bounded Contexts so we can group modules under their BC backdrops, and capabilities
    // so dependency arrows targeting a capability still render. Architects expect to see context.
    const elements = arch.elements.filter((e) =>
      e.kind === 'module' || e.kind === 'boundedContext' || e.kind === 'capability');
    const ids = new Set(elements.map((e) => e.id));
    const links = arch.links.filter((l) => l.kind === 'dependency' && ids.has(l.fromId) && ids.has(l.toId));
    return { elements, links };
  }
  // Module Map (and the fallback): every architecture kind and EVERY relationship between them —
  // data flows and dependencies alike. Hiding dependency arrows here made module-to-module `uses`
  // links invisible on the default view.
  const elements = arch.elements.filter((e) => e.kind !== 'concept');
  const ids = new Set(elements.map((e) => e.id));
  const links = arch.links.filter((l) => ids.has(l.fromId) && ids.has(l.toId));
  return { elements, links };
}

