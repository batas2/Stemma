/**
 * The cards cut out of the edge layer under the publication profile (B-023).
 *
 * A publication card is an outline with no fill, so the page shows through it — the same PNG has to
 * sit on a light page and a dark one. A line that passes beneath such a card is therefore drawn across
 * its name and reads as struck-through text. Painting the card would break transparency; instead the
 * edge layer carries a mask with each card's box cut out, so a line beneath a card is simply not drawn.
 *
 * Frames are not cut: a line crossing into a context or a system boundary is meant to be seen doing so.
 */

export interface CardBox {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  /** A context or system boundary drawn around other cards. */
  frame?: boolean;
}

/**
 * How far inside its outline a card is cut. An arrowhead ends on the outline and its tip reaches a
 * stroke's width past it; cutting the full box would blunt every arrow.
 */
export const KNOCKOUT_INSET = 3;

export const KNOCKOUT_MASK_ID = 'stemma-knockout';

export function knockoutRects(cards: CardBox[]): CardBox[] {
  return cards
    .filter((c) => !c.frame && c.w > 2 * KNOCKOUT_INSET && c.h > 2 * KNOCKOUT_INSET)
    .map((c) => ({
      id: c.id,
      x: c.x + KNOCKOUT_INSET,
      y: c.y + KNOCKOUT_INSET,
      w: c.w - 2 * KNOCKOUT_INSET,
      h: c.h - 2 * KNOCKOUT_INSET,
    }));
}
