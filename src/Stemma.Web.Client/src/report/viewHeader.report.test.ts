// @vitest-environment happy-dom
// F-014 AC6 — the report explains its views: a view's header (title, message, context, legend)
// above its diagram, its annotations drawn in it with backdrops beneath the cards, all as text and
// never as markup. And B-020: the report's Module Map draws no Concept.

import { beforeAll, describe, expect, it } from 'vitest';
import viewerJs from './viewer.js?raw';
import { buildReportBundle } from './reportData';

beforeAll(() => {
  localStorage.clear();
  const bundle = buildReportBundle({
    rootPath: '/ws-headers',
    workspaceName: 'ws',
    model: {
      filePath: '/ws/Architecture/Architecture.cs',
      elements: [
        { id: 'mod_a', name: 'Alpha', kind: 'module', attributes: {} },
        { id: 'mod_b', name: 'Beta', kind: 'module', attributes: {} },
        { id: 'con_c', name: 'Gamma the concept', kind: 'concept', attributes: {} },
      ],
      links: [{ id: 'dep_ab', fromId: 'mod_a', toId: 'mod_b', kind: 'dependency', attributes: { kind: 'uses' } }],
      tags: [
        { targetId: 'mod_a', lifecycle: { status: 'reuse', phase: null, validFrom: null, validUntil: null }, ownership: null },
        { targetId: 'mod_b', lifecycle: { status: 'build', phase: null, validFrom: null, validUntil: null }, ownership: null },
      ],
    },
    customViews: [{ id: 'view_line', name: 'The line', baseView: 'all', elementIds: ['mod_a', 'mod_b', 'con_c'], createdAt: '' }],
    comments: [],
    readPositions: () => ({ mod_a: { x: 0, y: 0 }, mod_b: { x: 300, y: 0 }, con_c: { x: 600, y: 0 } }),
    readWaypoints: () => ({}),
    readHandles: () => ({}),
    nodeStyles: {
      mod_a: { borderWidth: 1, borderStyle: 'solid', fillColor: '#d5e8d4', borderColor: '#82b366', visibleFields: ['name', 'status'] },
      con_c: { borderWidth: 1, borderStyle: 'solid', visibleFields: ['name'] },
    },
    edgeStyles: {},
    notes: {},
    customProps: {},
    viewHeaders: {
      moduleMap: { message: 'Every component and where it lives.' },
      'custom:view_line': {
        title: 'Where the line falls',
        message: 'Shared by default, private by declaration.',
        context: '**Left** is the platform’s.\n- <img src=x onerror="window.pwned=1"> one',
        legend: [{ status: 'reuse', label: 'reuse — runs today' }, { line: { style: 'dashed' }, label: 'uses' }],
      },
    },
    readShapes: (key) => key === 'custom:view_line'
      ? [
        { id: 'sh_zone', kind: 'rect', x: -40, y: -60, w: 700, h: 300, z: -2, fill: '#fff8e1', stroke: '#d6b656', strokeWidth: 2, label: 'SHARED', text: 'one truth, **read by all**' },
        { id: 'sh_note', kind: 'label', x: 0, y: 260, text: 'ask in the room', fontSize: 16, color: '#b85450', z: 1 },
      ]
      : [],
  });
  document.body.innerHTML = '<div id="app" class="vr-app"></div>';
  const data = document.createElement('script');
  data.type = 'application/json';
  data.id = 'stemma-report-data';
  data.textContent = JSON.stringify(bundle);
  document.body.appendChild(data);
  new Function(viewerJs)();
});

const open = (name: string) => [...document.querySelectorAll<HTMLButtonElement>('.vr-navitem')].find((b) => b.textContent?.includes(name))!.click();

describe('the Module Map in the report', () => {
  it('draws no Concept (B-020), under its header', () => {
    open('Module Map');
    const canvas = document.querySelector('.vr-canvas')!;
    expect(canvas.textContent).toContain('Alpha');
    expect(canvas.textContent).not.toContain('Gamma the concept');
    expect(document.querySelector('.vr-vh-title')?.textContent).toBe('Module Map');
    expect(document.querySelector('.vr-vh-message')?.textContent).toBe('Every component and where it lives.');
  });

  it('computes its legend from what it draws', () => {
    const labels = [...document.querySelectorAll('.vr-legend li')].map((li) => li.textContent);
    expect(labels).toEqual(['reuse', 'build', 'dependency']);
  });
});

describe('a view with a header and annotations', () => {
  it('shows its title, message and context, the context as text and never as markup', () => {
    open('The line');
    const header = document.querySelector('.vr-viewheader')!;
    expect(header.querySelector('.vr-vh-title')?.textContent).toBe('Where the line falls');
    expect(header.querySelector('.vr-vh-message')?.textContent).toBe('Shared by default, private by declaration.');
    expect(header.querySelector('.vr-vh-context strong')?.textContent).toBe('Left');
    expect(header.querySelector('img')).toBeNull();
    expect(header.textContent).toContain('<img src=x');
    expect((window as { pwned?: number }).pwned).toBeUndefined();
  });

  it('shows the written legend', () => {
    expect([...document.querySelectorAll('.vr-legend li')].map((li) => li.textContent)).toEqual(['reuse — runs today', 'uses']);
  });

  it('draws the Concept it names, a backdrop beneath the cards and a label over them', () => {
    const svg = document.querySelector('.vr-canvas')!;
    expect(svg.textContent).toContain('Gamma the concept');
    const children = [...svg.children];
    const zone = children.findIndex((c) => c.classList.contains('vr-shape') && c.textContent?.includes('SHARED'));
    const firstCard = children.findIndex((c) => c.tagName.toLowerCase() === 'foreignobject' && !c.classList.contains('vr-shape-fo'));
    const label = children.findIndex((c) => c.textContent === 'ask in the room');
    expect(zone).toBeGreaterThan(-1);
    expect(zone).toBeLessThan(firstCard);
    expect(label).toBeGreaterThan(firstCard);
    expect(children[zone].querySelector('.vr-shape-body strong')?.textContent).toBe('read by all');
  });
});

describe('a card in the report', () => {
  it('shows the fields its author chose: no kind row, and the status beside the name', () => {
    open('The line');
    const cards = [...document.querySelectorAll('.vrn')];
    const alpha = cards.find((c) => c.textContent?.includes('Alpha'))!;
    expect(alpha.querySelector('.vrn-head')).toBeNull();
    expect(alpha.querySelector('.vrn-titlerow .vrn-badge')?.textContent).toContain('reuse');
    const gamma = cards.find((c) => c.textContent?.includes('Gamma the concept'))!;
    expect(gamma.querySelector('.vrn-head')).toBeNull();
    expect(gamma.querySelector('.vrn-badge')).toBeNull();
    // A card nobody chose fields for keeps the report's own rows.
    const beta = cards.find((c) => c.textContent?.includes('Beta'))!;
    expect(beta.querySelector('.vrn-head')).not.toBeNull();
  });
});
