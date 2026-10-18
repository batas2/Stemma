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
    notes: {},
    customProps: {},
    books: [{
      id: 'book_a', name: 'A walk', audience: 'engineering',
      pages: [
        { id: 'wide', title: 'Everything', view: 'moduleMap', narrative: 'First the\ncontext.\n\n1. one\n2. two', focus: [], frame: 'view', others: 'dim' },
        { id: 'ab', title: 'Alpha and Beta', view: 'moduleMap', narrative: '<img src=x onerror="window.pwned=1"> **bold** `code`', focus: ['mod_a', 'mod_b'], frame: 'focus', others: 'dim' },
        { id: 'only', title: 'Only Alpha', view: 'moduleMap', narrative: '', focus: ['mod_a'], frame: 'view', others: 'hide' },
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
