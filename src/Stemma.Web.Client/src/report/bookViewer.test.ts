// @vitest-environment happy-dom
// F-013 AC9 — the report walks each book: the page's view as the page frames it, the narrative
// beside it as text and never as markup, and the way on with buttons and arrow keys.

import { beforeAll, describe, expect, it } from 'vitest';
import viewerJs from './viewer.js?raw';
import { buildReportBundle } from './reportData';

beforeAll(() => {
  localStorage.clear();
  const bundle = buildReportBundle({
    rootPath: '/ws-books',
    workspaceName: 'ws',
    model: {
      filePath: '/ws/Architecture/Architecture.cs',
      elements: [
        { id: 'mod_a', name: 'Alpha', kind: 'module', attributes: {} },
        { id: 'mod_b', name: 'Beta', kind: 'module', attributes: {} },
        { id: 'mod_c', name: 'Gamma', kind: 'module', attributes: {} },
      ],
      links: [{ id: 'dep_ab', fromId: 'mod_a', toId: 'mod_b', kind: 'dependency', attributes: { kind: 'uses' } }],
      tags: [],
    },
    customViews: [],
    comments: [],
    readPositions: () => ({ mod_a: { x: 0, y: 0 }, mod_b: { x: 300, y: 0 }, mod_c: { x: 600, y: 0 } }),
    readWaypoints: () => ({}),
    readHandles: () => ({}),
    nodeStyles: {},
    edgeStyles: {},
    notes: {
      mod_a: '**the edge store** · typed `IsSupplierOf`\n- one\n- two',
      mod_b: 'An <u>underlined</u> word, a <mark>highlight</mark>, <span style="color:#ef4444">red</span>, ~~gone~~ and [the spec](https://example.com/spec).\n\n| Owner | Status |\n| --- | --- |\n| Core | live |\n\n---\n\n- [x] shipped\n- [ ] next\n\n<img src=x onerror="window.pwnedNote=1"> [bad](javascript:alert(1))',
    },
    customProps: {},
    books: [{
      id: 'book_a', name: 'A walk', audience: 'engineering',
      pages: [
        { id: 'wide', title: 'Everything', view: 'moduleMap', narrative: 'First the\ncontext.\n\n1. one\n2. two', focus: [], frame: 'view', others: 'dim', steps: [] },
        { id: 'ab', title: 'Alpha and Beta', view: 'moduleMap', narrative: '<img src=x onerror="window.pwned=1"> **bold** `code`', focus: ['mod_a', 'mod_b'], frame: 'focus', others: 'dim', steps: [] },
        { id: 'only', title: 'Only Alpha', view: 'moduleMap', narrative: '', focus: ['mod_a'], frame: 'view', others: 'hide', steps: [] },
      ],
    }],
  });
  document.body.innerHTML = '<div id="app" class="vr-app"></div>';
  const data = document.createElement('script');
  data.type = 'application/json';
  data.id = 'stemma-report-data';
  data.textContent = JSON.stringify(bundle);
  document.body.appendChild(data);
  new Function(viewerJs)();
});

const title = () => document.querySelector('.vr-book-title')?.textContent;
const press = (key: string) => window.dispatchEvent(new KeyboardEvent('keydown', { key }));

describe('a note in the report', () => {
  it('draws what the notes editor writes, and still nothing else as markup', () => {
    const notes = document.querySelectorAll('.vrn-notes')[1]!;
    expect(notes.querySelector('u')?.textContent).toBe('underlined');
    expect(notes.querySelector('mark')?.textContent).toBe('highlight');
    expect((notes.querySelector('span[style]') as HTMLElement | null)?.style.color).toBe('#ef4444');
    expect(notes.querySelector('s')?.textContent).toBe('gone');
    expect(notes.querySelector('a')?.getAttribute('href')).toBe('https://example.com/spec');
    expect([...notes.querySelectorAll('th')].map((c) => c.textContent)).toEqual(['Owner', 'Status']);
    expect([...notes.querySelectorAll('td')].map((c) => c.textContent)).toEqual(['Core', 'live']);
    expect(notes.querySelector('hr')).not.toBeNull();
    expect([...notes.querySelectorAll('li')].map((li) => li.textContent)).toEqual(['☑ shipped', '☐ next']);
    expect(notes.textContent).not.toContain('<u>');
    expect(notes.textContent).not.toContain('| ---');
    // Markup that is not the editor's stays text, and a link that is not http(s) is not a link.
    expect(notes.querySelector('img')).toBeNull();
    expect((window as unknown as { pwnedNote?: number }).pwnedNote).toBeUndefined();
    expect(notes.querySelectorAll('a')).toHaveLength(1);
  });

  it('shows its bold, code and list, built from text rather than read as markup', () => {
    const notes = document.querySelector('.vrn-notes')!;
    expect(notes.querySelector('strong')?.textContent).toBe('the edge store');
    expect(notes.querySelector('code')?.textContent).toBe('IsSupplierOf');
    expect([...notes.querySelectorAll('li')].map((li) => li.textContent)).toEqual(['one', 'two']);
    expect(notes.textContent).not.toContain('**');
  });
});

describe('a book in the report', () => {
  it('is on the rail, and opens on its first page with the narrative as paragraphs and a list', () => {
    const item = [...document.querySelectorAll<HTMLButtonElement>('.vr-navitem')].find((b) => b.textContent?.includes('A walk'));
    expect(item).toBeDefined();
    item!.click();
    expect(title()).toBe('Everything');
    const narrative = document.querySelector('.vr-book-narrative')!;
    expect(narrative.querySelector('p')?.textContent).toBe('First the context.');
    expect([...narrative.querySelectorAll('ol li')].map((li) => li.textContent)).toEqual(['one', 'two']);
    expect(document.querySelectorAll('.vr-canvas .vr-dim')).toHaveLength(0);
  });

  it('turns pages with the arrow keys, and dims what a page does not point at', () => {
    press('ArrowRight');
    expect(title()).toBe('Alpha and Beta');
    // Gamma fades; Alpha, Beta and the link between them do not.
    const dimmed = document.querySelectorAll('.vr-canvas .vr-dim');
    expect(dimmed.length).toBeGreaterThan(0);
    expect([...dimmed].some((el) => el.textContent?.includes('Gamma'))).toBe(true);
    expect([...dimmed].some((el) => el.textContent?.includes('Alpha'))).toBe(false);
  });

  it('shows a narrative as text, never as markup', () => {
    const narrative = document.querySelector('.vr-book-narrative')!;
    expect(narrative.querySelector('img')).toBeNull();
    expect(narrative.textContent).toContain('<img src=x onerror="window.pwned=1">');
    expect(narrative.querySelector('strong')?.textContent).toBe('bold');
    expect(narrative.querySelector('code')?.textContent).toBe('code');
    expect((window as { pwned?: number }).pwned).toBeUndefined();
  });

  it('leaves out what a page hides, and stops at the last page', () => {
    press('PageDown');
    expect(title()).toBe('Only Alpha');
    const canvas = document.querySelector('.vr-canvas')!;
    expect(canvas.textContent).toContain('Alpha');
    expect(canvas.textContent).not.toContain('Gamma');
    press('ArrowRight');
    expect(title()).toBe('Only Alpha');
    press('ArrowLeft');
    expect(title()).toBe('Alpha and Beta');
  });
});
