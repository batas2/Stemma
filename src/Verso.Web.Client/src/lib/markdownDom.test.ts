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
});
