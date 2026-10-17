// @vitest-environment happy-dom
// Phase 0 (commercialization §4.6): every exported report says what made it, and links there. The
// report travels to people who have never heard of Stemma, so the credit is how they would.

import { beforeAll, describe, expect, it } from 'vitest';
import viewerJs from './viewer.js?raw';
import { buildReportBundle } from './reportData';

const PROJECT = 'https://bfrackowiak.pl/stemma/';

beforeAll(() => {
  const bundle = buildReportBundle({
    rootPath: '/ws',
    workspaceName: 'ws',
    model: { filePath: '/ws/Architecture/Architecture.cs', elements: [{ id: 'mod_a', name: 'Alpha', kind: 'module', attributes: {} }], links: [], tags: [] },
    customViews: [],
    comments: [],
    readPositions: () => ({ mod_a: { x: 0, y: 0 } }),
    readWaypoints: () => ({}),
    readHandles: () => ({}),
    nodeStyles: {},
    edgeStyles: {},
    notes: {},
    customProps: {},
    now: new Date('2026-10-17T12:00:00Z'),
  });
  document.body.innerHTML = '<div id="app" class="vr-app"></div>';
  const data = document.createElement('script');
  data.type = 'application/json';
  data.id = 'stemma-report-data';
  data.textContent = JSON.stringify(bundle);
  document.body.appendChild(data);
  new Function(viewerJs)();
});

describe('the exported report', () => {
  it('says it was made with Stemma, and links to it', () => {
    const credit = document.querySelector<HTMLAnchorElement>('a.vr-credit');
    expect(credit?.textContent).toBe('Made with Stemma');
    expect(credit?.getAttribute('href')).toBe(PROJECT);
  });

  it('opens the link beside the report, without handing the report to the page it opens', () => {
    const credit = document.querySelector<HTMLAnchorElement>('a.vr-credit')!;
    expect(credit.getAttribute('target')).toBe('_blank');
    expect(credit.getAttribute('rel')).toBe('noopener');
  });

  it('keeps the credit when printed, where the rail it sits in is hidden', () => {
    expect(document.querySelector('.vr-print-credit')?.textContent).toContain(PROJECT);
  });
});
