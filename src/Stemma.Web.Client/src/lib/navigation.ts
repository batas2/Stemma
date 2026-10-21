/**
 * Going anywhere (F-016): which views draw an element, which one to open for it, and the way back.
 *
 * Pure, so the rules are tested without a canvas. Which elements a view draws is `viewFilter.ts`'s
 * rule, read here rather than restated, so "Appears in" can never list a view that does not draw it.
 */

import { applyBuiltIn, applyKindFilter } from './viewFilter';
import type { ArchElement, ArchModel, CustomView, ViewKind } from './types';

/** Where the canvas is: a built-in lens, or a view from `Views/` drawn over its base lens. */
export interface Place {
  view: ViewKind;
  customViewId: string | null;
}

export interface ViewRef {
  /** `moduleMap`, `dependencyGraph`, `concerns`, or a view id from `Views/`. */
  id: string;
  name: string;
  custom: boolean;
}

export const BUILTIN_NAMES: Record<ViewKind, string> = {
  moduleMap: 'Module Map',
  dependencyGraph: 'Dependencies',
  concerns: 'Concerns',
};

const CONCERN_KINDS = new Set(['risk', 'question', 'assumption']);

function drawnByCustomView(el: ArchElement, view: CustomView): boolean {
  if (!view.elementIds.includes(el.id)) return false;
  return view.baseView === 'all' || applyKindFilter([el], view.baseView as ViewKind).length > 0;
}

/** Every view that shows this element: the built-in lenses by kind, and each view from `Views/` that names it. */
export function viewsShowing(el: ArchElement, customViews: CustomView[]): ViewRef[] {
  const one: ArchModel = { filePath: '', elements: [el], links: [], tags: [] };
  const out: ViewRef[] = [];
  for (const view of ['moduleMap', 'dependencyGraph'] as const) {
    if (applyBuiltIn(one, view).elements.length > 0) out.push({ id: view, name: BUILTIN_NAMES[view], custom: false });
  }
  if (CONCERN_KINDS.has(el.kind)) out.push({ id: 'concerns', name: BUILTIN_NAMES.concerns, custom: false });
  for (const v of customViews) if (drawnByCustomView(el, v)) out.push({ id: v.id, name: v.name, custom: true });
  return out;
}

export function placeOf(viewId: string): Place {
  return viewId === 'moduleMap' || viewId === 'dependencyGraph' || viewId === 'concerns'
    ? { view: viewId, customViewId: null }
    : { view: 'moduleMap', customViewId: viewId };
}

export function placeId(p: Place): string {
  return p.customViewId ?? p.view;
}

export function samePlace(a: Place, b: Place): boolean {
  return placeId(a) === placeId(b);
}

/**
 * Where to go to see an element on a canvas: here when here draws it, otherwise the Module Map, which
 * draws every kind but a Concept, otherwise the first view from `Views/` that names it. Null when no
 * canvas draws it at all — a Concept no view names yet. Concerns is a list, not a canvas, so it is
 * never where an element is revealed.
 */
export function placeFor(el: ArchElement, customViews: CustomView[], here: Place): Place | null {
  const showing = viewsShowing(el, customViews).filter((v) => v.id !== 'concerns');
  if (showing.some((v) => v.id === placeId(here))) return here;
  const map = showing.find((v) => v.id === 'moduleMap');
  if (map) return placeOf(map.id);
  return showing[0] ? placeOf(showing[0].id) : null;
}

/** The views someone went through, and the ones they came back from. */
export interface Trail {
  back: Place[];
  forward: Place[];
}

const TRAIL_CAP = 50;

/** Moving from `from` somewhere else: `from` is where Back leads now, and Forward is forgotten. */
export function leave(trail: Trail, from: Place, to: Place): Trail {
  if (samePlace(from, to)) return trail;
  const last = trail.back[trail.back.length - 1];
  const back = last && samePlace(last, from) ? trail.back : [...trail.back, from].slice(-TRAIL_CAP);
  return { back, forward: [] };
}

/**
 * One step back (or forward, with the stacks swapped), skipping places that no longer exist — a view
 * deleted or pulled away since. Null when there is nowhere to go.
 */
export function step(trail: Trail, here: Place, exists: (p: Place) => boolean, direction: 'back' | 'forward'): { to: Place; trail: Trail } | null {
  const from = direction === 'back' ? [...trail.back] : [...trail.forward];
  let to: Place | undefined;
  while ((to = from.pop()) !== undefined) {
    if (exists(to) && !samePlace(to, here)) break;
  }
  if (!to) return null;
  const other = direction === 'back' ? trail.forward : trail.back;
  const next = [...other, here].slice(-TRAIL_CAP);
  return direction === 'back'
    ? { to, trail: { back: from, forward: next } }
    : { to, trail: { back: next, forward: from } };
}

/** The address of a place and a selection: `#view=…&select=…` (AC6). */
export function hashFor(p: Place, selected: string | null): string {
  const params = new URLSearchParams({ view: placeId(p) });
  if (selected) params.set('select', selected);
  return `#${params.toString()}`;
}

export function readHash(hash: string): { view: string | null; select: string | null } {
  const params = new URLSearchParams(hash.replace(/^#/, ''));
  return { view: params.get('view'), select: params.get('select') };
}
