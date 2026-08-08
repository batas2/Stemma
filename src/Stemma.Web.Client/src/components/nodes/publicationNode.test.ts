import { describe, it, expect } from 'vitest';
import {
  wrapIntoLines, publicationWidth, publicationHeight,
  PUB_FONT_SIZE, PUB_LINE_HEIGHT, PUB_PADDING_Y,
} from './PublicationNode';
import { estimateNodeSize, wrappedLineCount, NODE_MIN_WIDTH, NODE_MAX_WIDTH } from '@/lib/textMetrics';

/**
 * The publication node is what `--format svg` serialises, so its text handling is the one place a
 * disagreement between "how big the solver thought this box was" and "how big it drew" turns into a
 * visibly wrong layout rather than a slightly wrong one.
 */
describe('wrapIntoLines', () => {
  it('keeps a short label on one line', () => {
    expect(wrapIntoLines('Basket', 260)).toEqual(['Basket']);
  });

  it('breaks between words, never inside one', () => {
    const lines = wrapIntoLines('tests, contracts, decision records', 200);
    expect(lines.length).toBeGreaterThan(1);
    for (const line of lines) expect(line).not.toMatch(/^\s|\s$/);
    expect(lines.join(' ')).toBe('tests, contracts, decision records');
  });

  it('never loses or reorders a word', () => {
    const text = 'why this and not something rather a lot simpler than it currently is';
    for (const width of [120, 200, 260, 600]) {
      expect(wrapIntoLines(text, width).join(' ').split(/\s+/)).toEqual(text.split(/\s+/));
    }
  });

  it('lets a single over-long word overhang rather than splitting it mid-word', () => {
    // An identifier broken across two lines is harder to read than one that hangs over the edge.
    const lines = wrapIntoLines('supercalifragilisticexpialidocious', 80);
    expect(lines).toEqual(['supercalifragilisticexpialidocious']);
  });

  it('honours explicit newlines as line breaks', () => {
    expect(wrapIntoLines('one\ntwo', 400)).toEqual(['one', 'two']);
  });

  it('returns one empty line for an empty label, so the box still draws', () => {
    expect(wrapIntoLines('', 200)).toEqual(['']);
  });

  it('collapses runs of whitespace instead of emitting empty words', () => {
    expect(wrapIntoLines('a    b', 400)).toEqual(['a b']);
  });
});

describe('publicationWidth', () => {
  it('settles into the same band as the app card, so a mixed view is not ragged', () => {
    expect(publicationWidth('Hi')).toBe(NODE_MIN_WIDTH);
    expect(publicationWidth('x'.repeat(400))).toBe(NODE_MAX_WIDTH);
  });

  it('an explicit width wins', () => {
    expect(publicationWidth('Hi', 420)).toBe(420);
  });
});

describe('publicationHeight', () => {
  it('grows by exactly one line height per wrapped line', () => {
    const w = 200;
    const one = publicationHeight('Basket', w);
    const two = publicationHeight('tests, contracts, decision records', w);
    const lines = wrappedLineCount('tests, contracts, decision records', w, PUB_FONT_SIZE);
    expect(two - one).toBe((lines - 1) * PUB_LINE_HEIGHT);
  });

  it('is padding plus the text block, with nothing else in it', () => {
    expect(publicationHeight('Basket', 200)).toBe(PUB_PADDING_Y * 2 + PUB_LINE_HEIGHT);
  });

  it('an explicit height wins', () => {
    expect(publicationHeight('Basket', 200, 300)).toBe(300);
  });
});

describe('agreement with the layout estimator', () => {
  const labels = [
    'Basket',
    'Booking API',
    'tests, contracts, decision records',
    'Why this and not something simpler?',
    'a colleague’s diff',
  ];

  it('the renderer and the estimator choose the same width', () => {
    // The solver places boxes using the estimate and the renderer draws them at its own width. If
    // these drift, a grid is laid out for one size and painted at another.
    for (const label of labels) {
      expect(publicationWidth(label)).toBe(estimateNodeSize({ name: label }).w);
    }
  });

  it('the renderer and the estimator agree on how many lines a label takes', () => {
    for (const label of labels) {
      const w = publicationWidth(label);
      expect(wrapIntoLines(label, w).length).toBe(wrappedLineCount(label, w, PUB_FONT_SIZE));
    }
  });

  it('a header-less estimate matches the publication height, since the profile draws no header', () => {
    for (const label of labels) {
      const w = publicationWidth(label);
      expect(publicationHeight(label, w)).toBe(estimateNodeSize({ name: label, header: false }).h);
    }
  });
});
