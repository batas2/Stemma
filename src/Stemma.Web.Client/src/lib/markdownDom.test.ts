// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { mdToEditableHtml, editableHtmlToMd } from './markdownDom';

function roundTrip(md: string): string {
  const div = document.createElement('div');
  div.innerHTML = mdToEditableHtml(md);
  return editableHtmlToMd(div);
}

describe('markdown <-> editable DOM', () => {
  it('round-trips bold / italic / code', () => {
    expect(roundTrip('**bold** and *italic* and `code`')).toBe('**bold** and *italic* and `code`');
  });

  it('round-trips links', () => {
    expect(roundTrip('see [docs](https://example.com)')).toBe('see [docs](https://example.com)');
  });

  it('round-trips strikethrough', () => {
    expect(roundTrip('this is ~~wrong~~ now')).toBe('this is ~~wrong~~ now');
  });

  it('round-trips bullet lists', () => {
    expect(roundTrip('- one\n- two')).toBe('- one\n- two');
  });

  it('round-trips ordered lists with renumbering', () => {
    expect(roundTrip('1. first\n2. second\n3. third')).toBe('1. first\n2. second\n3. third');
  });

  it('serializes browser <strike>/<s> to ~~', () => {
    const div = document.createElement('div');
    div.innerHTML = '<div>a <strike>b</strike> <s>c</s></div>';
    expect(editableHtmlToMd(div)).toBe('a ~~b~~ ~~c~~');
  });

  it('round-trips multiple paragraphs', () => {
    expect(roundTrip('first line\n\nsecond line')).toBe('first line\n\nsecond line');
  });

  it('keeps #tags as literal text', () => {
    expect(roundTrip('owned by #owner: Alice')).toBe('owned by #owner: Alice');
  });

  it('serializes browser-style <b>/<i> to markdown', () => {
    const div = document.createElement('div');
    div.innerHTML = '<div>x <b>bold</b> <i>it</i></div>';
    expect(editableHtmlToMd(div)).toBe('x **bold** *it*');
  });

  it('empty stays empty', () => {
    expect(roundTrip('')).toBe('');
  });

  it('round-trips headings', () => {
    expect(roundTrip('# Title')).toBe('# Title');
    expect(roundTrip('## Sub')).toBe('## Sub');
    expect(roundTrip('### Deep')).toBe('### Deep');
  });

  it('round-trips blockquotes (incl. multi-line)', () => {
    expect(roundTrip('> a quote')).toBe('> a quote');
    expect(roundTrip('> line one\n> line two')).toBe('> line one\n> line two');
  });

  it('round-trips a fenced code block', () => {
    expect(roundTrip('```\nconst x = 1;\n```')).toBe('```\nconst x = 1;\n```');
  });

  it('round-trips a horizontal rule', () => {
    expect(roundTrip('above\n\n---\n\nbelow')).toBe('above\n\n---\n\nbelow');
  });

  it('round-trips task lists', () => {
    expect(roundTrip('- [ ] todo\n- [x] done')).toBe('- [ ] todo\n- [x] done');
  });

  it('round-trips a GFM table', () => {
    expect(roundTrip('| a | b |\n| --- | --- |\n| 1 | 2 |')).toBe('| a | b |\n| --- | --- |\n| 1 | 2 |');
  });

  it('round-trips underline / highlight / colour (inline HTML)', () => {
    expect(roundTrip('an <u>underlined</u> word')).toBe('an <u>underlined</u> word');
    expect(roundTrip('a <mark>highlighted</mark> word')).toBe('a <mark>highlighted</mark> word');
    expect(roundTrip('a <span style="color: rgb(1, 2, 3);">red</span> word')).toBe('a <span style="color: rgb(1, 2, 3);">red</span> word');
  });

  it('does not mangle plain numbers in text', () => {
    expect(roundTrip('we shipped 3 things in 2026')).toBe('we shipped 3 things in 2026');
  });
});
