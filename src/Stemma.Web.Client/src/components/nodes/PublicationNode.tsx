import { useMemo } from 'react';
import {
  wrappedLineCount, NODE_MAX_WIDTH, NODE_MIN_WIDTH,
  PADDING_X, BODY_PADDING_Y, TITLE_LINE_HEIGHT,
} from '@/lib/textMetrics';

/**
 * The publication node body, drawn as SVG primitives rather than as a styled `<div>`.
 *
 * This exists so `--format svg` can produce a real vector drawing. React Flow already draws edges as
 * SVG; nodes were the HTML half, and serialising HTML into a `<foreignObject>` produces a file that
 * renders in a browser and essentially nowhere else.
 *
 * It is a *mode of the same component*, not a second renderer. The alternative — a standalone
 * server-side SVG renderer — fails on text measurement: a line break landing one word differently
 * adds a line, changes the box height, and shifts everything below it in a grid, which is a
 * structurally different picture rather than a slightly different one (ADR context in F-009 §9).
 * Here the browser still measures and breaks the text, and the result is emitted as `<tspan>`s, so
 * the product contains exactly one line-breaking implementation and it is the one on screen.
 */

// Shared with the estimator rather than restated, so a box cannot be laid out at one size and
// drawn at another. `PADDING_X` is the card's *total* horizontal padding; half of it per side.
export const PUB_FONT_SIZE = 14;
export const PUB_LINE_HEIGHT = TITLE_LINE_HEIGHT;
export const PUB_PADDING_X = PADDING_X / 2;
export const PUB_PADDING_Y = BODY_PADDING_Y / 2;
export const PUB_RADIUS = 8;
export const PUB_STROKE_WIDTH = 1.6;

/**
 * Break `text` into the lines the box will draw.
 *
 * Greedy word wrapping against an average advance, matching `textMetrics` — the estimator and the
 * renderer must agree or the layout solver places boxes at one size and the picture draws them at
 * another. A single word longer than the line is left over-long rather than broken mid-word: an
 * identifier split across two lines is harder to read than one that overhangs.
 */
export function wrapIntoLines(text: string, width: number, fontSize = PUB_FONT_SIZE): string[] {
  const usable = Math.max(1, width - PUB_PADDING_X * 2);
  const perChar = fontSize * 0.52;
  const out: string[] = [];

  for (const paragraph of text.split('\n')) {
    let line = '';
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      const candidate = line ? `${line} ${word}` : word;
      if (line && candidate.length * perChar > usable) {
        out.push(line);
        line = word;
      } else {
        line = candidate;
      }
    }
    out.push(line);
  }
  return out.length > 0 ? out : [''];
}

export interface PublicationNodeProps {
  name: string;
  /** Explicit width from `nodeStyles`; otherwise the same band the app card uses. */
  width?: number;
  height?: number;
  /** Dashed for something that is absent, proposed, or otherwise not load-bearing. */
  dashed?: boolean;
  /** The one element the diagram is about takes the accent; everything else takes the stroke. */
  accent?: boolean;
}

/** Width the box settles at, mirroring the estimator so a solved layout matches what is drawn. */
export function publicationWidth(name: string, explicit?: number): number {
  if (explicit) return explicit;
  const natural = name.length * PUB_FONT_SIZE * 0.52 + PUB_PADDING_X * 2;
  return Math.min(NODE_MAX_WIDTH, Math.max(NODE_MIN_WIDTH, Math.ceil(natural)));
}

/** Height for a given number of drawn lines. The box is padding plus the text block, nothing else. */
export function heightForLines(lineCount: number, explicit?: number): number {
  return explicit ?? Math.ceil(PUB_PADDING_Y * 2 + lineCount * PUB_LINE_HEIGHT);
}

/**
 * Height the box settles at. Goes through the same `heightForLines` the component draws with, so
 * there is one calculation rather than two that a test has to keep in agreement.
 */
export function publicationHeight(name: string, width: number, explicit?: number): number {
  return heightForLines(wrappedLineCount(name, width, PUB_FONT_SIZE), explicit);
}

/**
 * One box, as `<rect>` + `<text>`.
 *
 * `vectorEffect="non-scaling-stroke"` keeps the hairline a hairline when the drawing is resized,
 * which is most of the reason to want vector output at all.
 */
export function PublicationNode({ name, width, height, dashed, accent }: PublicationNodeProps) {
  const w = publicationWidth(name, width);
  const lines = useMemo(() => wrapIntoLines(name, w), [name, w]);
  const h = heightForLines(lines.length, height);

  const ink = accent ? 'var(--pub-accent)' : 'var(--pub-stroke)';
  const text = accent ? 'var(--pub-accent)' : 'var(--pub-text)';

  // Centred as a block: the first baseline sits so the whole run is vertically centred, which is
  // what the HTML card does and what a reader expects of a label in a box.
  const firstBaseline = h / 2 - ((lines.length - 1) * PUB_LINE_HEIGHT) / 2 + PUB_FONT_SIZE / 3;

  return (
    <svg
      className="stemma-pub-node"
      width={w}
      height={h}
      viewBox={`0 0 ${w} ${h}`}
      xmlns="http://www.w3.org/2000/svg"
      style={{ display: 'block', overflow: 'visible' }}
    >
      <rect
        x={PUB_STROKE_WIDTH / 2}
        y={PUB_STROKE_WIDTH / 2}
        width={w - PUB_STROKE_WIDTH}
        height={h - PUB_STROKE_WIDTH}
        rx={PUB_RADIUS}
        fill="none"
        stroke={ink}
        strokeWidth={PUB_STROKE_WIDTH}
        strokeDasharray={dashed ? '6 4' : undefined}
        vectorEffect="non-scaling-stroke"
      />
      <text
        x={PUB_PADDING_X}
        y={firstBaseline}
        fontFamily="Inter, ui-sans-serif, system-ui, sans-serif"
        fontSize={PUB_FONT_SIZE}
        fill={text}
      >
        {lines.map((line, i) => (
          <tspan key={i} x={PUB_PADDING_X} dy={i === 0 ? 0 : PUB_LINE_HEIGHT}>{line}</tspan>
        ))}
      </text>
    </svg>
  );
}
