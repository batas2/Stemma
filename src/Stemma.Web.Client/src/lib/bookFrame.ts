/**
 * How a book page lights and frames the canvas (F-013 AC4, AC5).
 *
 * Pure, so the rules are testable without React Flow: which elements stay lit, and how long the
 * camera takes to get there. The canvas applies them.
 */

import type { ArchElement } from './types';
import type { BookPage } from './books';

/** Long enough to read as a zoom from context into detail, short enough not to wait for. */
export const FRAME_MS = 700;

/**
 * The elements a page keeps lit, or null when it lights everything. A bounded context holding a
 * focused element stays lit with it, so the box the element sits in does not fade around it.
 */
export function pageLighting(page: BookPage, elements: ArchElement[]): Set<string> | null {
  if (page.focus.length === 0) return null;
  const lit = new Set(page.focus);
  const byId = new Map(elements.map((e) => [e.id, e]));
  for (const id of page.focus) {
    const context = byId.get(id)?.attributes.contextId;
    if (context) lit.add(context);
  }
  return lit;
}

/** Immediate under reduced motion, and while the PDF export captures pages one after another. */
export function frameDuration(reducedMotion: boolean, capturing: boolean): number {
  return reducedMotion || capturing ? 0 : FRAME_MS;
}

export function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
}
