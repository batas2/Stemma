/**
 * Which elements and links a view draws — the one rule the canvas, the legend and the report share.
 *
 * A view from `Views/` draws its members — what the engine resolved from its lens, its ids and its
 * rules (ADR-0026) — through its base lens's kind filter, and the implied relationships a C4 lens
 * draws to a system in place of its containers. A built-in
 * lens draws by kind: the Module Map every architecture kind (not Concept, which belongs to no
 * built-in lens — ADR-0018, B-020), the dependency lens modules, contexts and capabilities joined
 * by dependencies.
 */

import type { ArchElement, ArchLink, ArchModel, CustomView, ImpliedLink, ViewKind } from './types';

export interface FilteredView {
  elements: ArchElement[];
  links: ArchLink[];
  /** Relationships drawn to a system in place of the container at their end (ADR-0026). */
  implied: ImpliedLink[];
}

/**
 * What a view draws: the members the engine resolved from its lens, ids and rules (ADR-0026), or —
 * from a server that predates them — the ids it lists.
 */
export function membersOf(view: CustomView): string[] {
  return view.members ?? view.elementIds;
}

/** Whether removing an element from this view has to be said as an exclusion, because a rule brings it in. */
export function viewHasRules(view: CustomView): boolean {
  return !!view.scope || (view.include?.length ?? 0) > 0 || view.baseView === 'systemContext' || view.baseView === 'container';
}

export function filterByView(arch: ArchModel, view: ViewKind, customView: CustomView | null): FilteredView {
  if (customView) {
    const members = new Set(membersOf(customView));
    const inView = arch.elements.filter((e) => members.has(e.id));
    // Only the two built-in lenses filter by kind; the C4 lenses already chose their members by kind.
    const elements = customView.baseView === 'moduleMap' || customView.baseView === 'dependencyGraph'
      ? applyKindFilter(inView, customView.baseView)
      : inView;
    const ids = new Set(elements.map((e) => e.id));
    const links = arch.links.filter((l) => ids.has(l.fromId) && ids.has(l.toId));
    const implied = (customView.implied ?? []).filter((i) => ids.has(i.fromId) && ids.has(i.toId));
    return { elements, links, implied };
  }
  return applyBuiltIn(arch, view);
}

export function applyKindFilter(elements: ArchElement[], view: ViewKind): ArchElement[] {
  switch (view) {
    case 'dependencyGraph': return elements.filter((e) => e.kind === 'module' || e.kind === 'boundedContext' || e.kind === 'capability');
    case 'moduleMap':
    // A view that names a Concept draws it on the Module Map lens or none: naming it is the point.
    // The dependency lens above keeps to modules, contexts and capabilities whatever a view names.
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
    return { elements, links, implied: [] };
  }
  // Module Map (and the fallback): every architecture kind and EVERY relationship between them —
  // data flows and dependencies alike. Hiding dependency arrows here made module-to-module `uses`
  // links invisible on the default view.
  const elements = arch.elements.filter((e) => e.kind !== 'concept');
  const ids = new Set(elements.map((e) => e.id));
  const links = arch.links.filter((l) => ids.has(l.fromId) && ids.has(l.toId));
  return { elements, links, implied: [] };
}

