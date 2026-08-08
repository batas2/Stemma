/**
 * Predicting how big a node will be, without a DOM.
 *
 * The layout solver needs each node's size, and the canvas only knows it after React Flow has
 * measured the rendered card. That is fine on screen and useless everywhere else: a headless render
 * has to place nodes *before* it draws them, and `stemma render --layout hierarchical` would
 * otherwise produce an arrangement computed from placeholder sizes and then drawn at real ones.
 *
 * This is an estimate and says so. It models the card the canvas actually draws — bounded width,
 * wrapped title, one line per visible metadata field — closely enough that the arrangement does not
 * visibly shift when the measured sizes arrive. Where a measurement exists it always wins.
 */

/** Mirrors the canvas: `min-w-[180px] max-w-[260px]` unless an explicit width is set. */
export const NODE_MIN_WIDTH = 180;
export const NODE_MAX_WIDTH = 260;

/**
 * Card chrome around the text.
 *
 * Exported because the publication node draws with the same numbers. They were duplicated at first
 * and immediately drifted — the estimator padded a box by 16 and the renderer by 24 — which is the
 * one disagreement that matters here: the solver places boxes at the estimated size and the picture
 * draws them at the rendered one.
 */
export const PADDING_X = 24;
export const HEADER_HEIGHT = 30;
export const BODY_PADDING_Y = 16;

export const TITLE_LINE_HEIGHT = 20;
const META_LINE_HEIGHT = 14;

/**
 * Average advance per character as a fraction of font size, for the UI stack (Inter and friends) at
 * the weights the card uses.
 *
 * A real font metric would be more accurate and would mean parsing a font file in an environment
 * that may not have one. The failure mode of being slightly wrong here is a gap a few pixels off,
 * not a wrong diagram, because a measured size replaces the estimate as soon as one exists.
 */
const AVG_CHAR_RATIO = 0.52;
const TITLE_FONT_SIZE = 14;

export interface EstimateInput {
  name: string;
  /** How many metadata rows the node renders below the title. */
  metaLines?: number;
  /** Explicit width from `nodeStyles`, which overrides the min/max band. */
  width?: number;
  /** Explicit height from `nodeStyles`, which overrides the estimate entirely. */
  height?: number;
  /** Whether the kind/status header row is drawn. The publication profile hides it. */
  header?: boolean;
}

export function textWidth(text: string, fontSize = TITLE_FONT_SIZE): number {
  return text.length * fontSize * AVG_CHAR_RATIO;
}

/** How many lines `text` takes when wrapped into `width`, counting explicit newlines. */
export function wrappedLineCount(text: string, width: number, fontSize = TITLE_FONT_SIZE): number {
  const usable = Math.max(1, width - PADDING_X);
  return text.split('\n').reduce((lines, paragraph) => {
    const w = textWidth(paragraph, fontSize);
    return lines + Math.max(1, Math.ceil(w / usable));
  }, 0);
}

/**
 * Estimated rendered size of one node.
 *
 * Width settles into the same band the canvas uses, so a short label gives a narrow card and a
 * sentence gives the widest one and then grows downwards — which is what makes wrapped titles
 * predictable enough to lay out ahead of drawing.
 */
export function estimateNodeSize(input: EstimateInput): { w: number; h: number } {
  const { name, metaLines = 0, width, height, header = true } = input;

  const natural = textWidth(name) + PADDING_X;
  const w = width ?? Math.min(NODE_MAX_WIDTH, Math.max(NODE_MIN_WIDTH, Math.ceil(natural)));
  if (height !== undefined) return { w, h: height };

  const titleLines = wrappedLineCount(name, w);
  const h =
    (header ? HEADER_HEIGHT : 0) +
    BODY_PADDING_Y +
    titleLines * TITLE_LINE_HEIGHT +
    metaLines * META_LINE_HEIGHT;

  return { w, h: Math.ceil(h) };
}

/**
 * Sizes for a set of nodes: measured where available, estimated otherwise.
 *
 * The precedence is the point. Mixing the two — estimating some nodes while measuring others — is
 * exactly the case a headless render hits on first paint, and it must not produce a layout that
 * jumps once the measurements land.
 */
export function sizesFor(
  nodes: ReadonlyArray<EstimateInput & { id: string }>,
  measured: Record<string, { w: number; h: number }> = {}
): Record<string, { w: number; h: number }> {
  const out: Record<string, { w: number; h: number }> = {};
  for (const n of nodes) out[n.id] = measured[n.id] ?? estimateNodeSize(n);
  return out;
}
