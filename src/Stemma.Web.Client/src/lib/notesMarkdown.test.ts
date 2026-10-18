// @vitest-environment happy-dom
// Notes and book narratives come from the repository — pull requests, agents — and are rendered as
// HTML. Nothing in them may become markup the author did not ask for (F-013 review).

import { describe, expect, it } from 'vitest';
import { renderNotes } from './notesMarkdown';

function render(md: string): HTMLElement {
  const el = document.createElement('div');
  el.innerHTML = renderNotes(md);
  return el;
}

describe('renderNotes', () => {
  it('keeps a quote inside a link from breaking out of the href', () => {
    const el = render(`[x](https://a"onmouseover="location='javascript:alert(1)'")`);
    for (const node of el.querySelectorAll('*')) {
      expect([...node.attributes].map((a) => a.name).filter((n) => n.startsWith('on'))).toEqual([]);
    }
    const a = el.querySelector('a');
    if (a) expect(a.getAttribute('href')!.startsWith('https://a"')).toBe(true);
  });

  it('writes no markup from text', () => {
    const el = render('<img src=x onerror=alert(1)> "quoted" and \'single\'');
    expect(el.querySelector('img')).toBeNull();
    expect(el.textContent).toBe('<img src=x onerror=alert(1)> "quoted" and \'single\'');
  });

  it('still links a plain http(s) URL, and only that', () => {
    expect(render('[docs](https://example.com/a?b=1&c=2)').querySelector('a')?.getAttribute('href')).toBe('https://example.com/a?b=1&c=2');
    expect(render('[x](javascript:alert(1))').querySelector('a')).toBeNull();
  });

  it('keeps bold, code and lists', () => {
    const el = render('**bold** and `code`\n- one\n- two');
    expect(el.querySelector('strong')?.textContent).toBe('bold');
    expect(el.querySelector('code')?.textContent).toBe('code');
    expect(el.querySelectorAll('li')).toHaveLength(2);
  });
});
