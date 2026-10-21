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

// The rich editor (markdownDom) writes more than renderNotes read: colour, underline, highlight,
// strike-through, headings, numbered and task lists, quotes, code blocks, rules and tables. Every
// read-only view — cards, the presenter, a view's header, shapes — showed those as their raw tags
// and markers, and a colour's `#ef4444` as a tag chip. What the editor writes is drawn as itself.
describe('renderNotes draws what the editor writes', () => {
  it('a colour, and its hex code is not a tag', () => {
    const el = render('Pay <span style="color:#ef4444">attention</span> here');
    const span = el.querySelector('span[style]') as HTMLElement;
    expect(span.textContent).toBe('attention');
    expect(span.style.color).not.toBe('');
    expect(el.textContent).toBe('Pay attention here');
  });

  it('a highlight colour', () => {
    const span = render('<span style="background-color:#fde68a">marked</span>').querySelector('span[style]') as HTMLElement;
    expect(span.textContent).toBe('marked');
    expect(span.style.backgroundColor).not.toBe('');
  });

  it('underline, highlight and strike-through', () => {
    const el = render('<u>under</u> <mark>bright</mark> ~~gone~~');
    expect(el.querySelector('u')?.textContent).toBe('under');
    expect(el.querySelector('mark')?.textContent).toBe('bright');
    expect(el.querySelector('s')?.textContent).toBe('gone');
    expect(el.textContent).toBe('under bright gone');
  });

  it('headings', () => {
    const el = render('# Title\n## Section\n### Detail');
    expect(el.querySelector('h1')?.textContent).toBe('Title');
    expect(el.querySelector('h2')?.textContent).toBe('Section');
    expect(el.querySelector('h3')?.textContent).toBe('Detail');
  });

  it('a numbered list', () => {
    const el = render('1. one\n2. two');
    expect([...el.querySelectorAll('ol > li')].map((li) => li.textContent)).toEqual(['one', 'two']);
    expect(el.querySelector('ul')).toBeNull();
  });

  it('a task list, ticked and not', () => {
    const el = render('- [ ] todo\n- [x] done');
    expect([...el.querySelectorAll('li')].map((li) => li.textContent)).toEqual(['☐ todo', '☑ done']);
  });

  it('a table, with its cells formatted', () => {
    const el = render('| Name | Owner |\n| --- | :---: |\n| **Gate** | Perform |');
    expect([...el.querySelectorAll('th')].map((c) => c.textContent)).toEqual(['Name', 'Owner']);
    expect([...el.querySelectorAll('td')].map((c) => c.textContent)).toEqual(['Gate', 'Perform']);
    expect(el.querySelector('td strong')?.textContent).toBe('Gate');
    expect(el.textContent).not.toContain('|');
  });

  it('a quote, a code block and a rule', () => {
    const el = render('> quoted\n> twice\n```\nconst x = <b>1</b>;\n```\n---');
    expect(el.querySelector('blockquote')?.innerHTML).toBe('quoted<br>twice');
    expect(el.querySelector('pre code')?.textContent).toBe('const x = <b>1</b>;');
    expect(el.querySelector('pre b')).toBeNull();
    expect(el.querySelector('hr')).not.toBeNull();
  });

  it('formatting inside a colour', () => {
    const el = render('<span style="color:#2563eb">**bold** and *italic*</span>');
    expect(el.querySelector('span[style] strong')?.textContent).toBe('bold');
    expect(el.querySelector('span[style] em')?.textContent).toBe('italic');
  });

  it('still draws a tag as a chip, and a URL\'s fragment as part of the link', () => {
    const el = render('#owner: Perform\nSee [the page](https://wiki.example.com/Page#Owners).');
    expect(el.querySelector('span b')?.textContent).toBe('Perform');
    expect(el.querySelector('a')?.getAttribute('href')).toBe('https://wiki.example.com/Page#Owners');
  });
});

describe('renderNotes keeps what the text says', () => {
  it('text that looks like the marker raw tags are set aside under', () => {
    expect(render('a \u00011\u0001 b').textContent).toBe('a \u00011\u0001 b');
    const el = render('<u>x</u> \ue0000\ue000 y');
    expect(el.querySelectorAll('u')).toHaveLength(1);
    expect(el.textContent).toBe('x \ue0000\ue000 y');
  });
});

describe('renderNotes keeps out what the editor does not write', () => {
  it('a span with any other style is text', () => {
    const el = render('x <span style="background:url(https://attacker.example/beacon)">y</span>');
    expect(el.querySelector('span[style]')).toBeNull();
    expect(el.textContent).toContain('<span style=');
  });

  it('a tag with attributes, or any other tag, is text', () => {
    const el = render('<u onclick="alert(1)">a</u> <mark style="color:red">b</mark> <script>alert(1)</script>');
    expect(el.querySelector('u, mark, script')).toBeNull();
    for (const node of el.querySelectorAll('*')) {
      expect([...node.attributes].map((a) => a.name).filter((n) => n.startsWith('on'))).toEqual([]);
    }
  });
});
