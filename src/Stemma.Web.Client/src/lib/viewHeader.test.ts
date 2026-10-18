// F-014 — a view's header: read tolerantly from the sidecar, its legend computed from what the
// view draws unless written, and an edit to one field sent as one change.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ArchElement, ArchLink, ArchTagInfo } from './types';
import {
  headerTitle, legendItems, readViewHeader, readViewHeaders, unknownLegendStatuses,
  type DrawnView,
} from './viewHeader';

vi.mock('./api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./api')>()),
  fetchLayout: vi.fn(),
  patchLayoutSidecar: vi.fn(),
}));

const el = (id: string, kind: ArchElement['kind'] = 'module'): ArchElement => ({ id, name: id, kind, attributes: {} });
const link = (id: string, kind: ArchLink['kind'], fromId = 'a', toId = 'b'): ArchLink => ({ id, fromId, toId, kind, attributes: {} });
const tag = (targetId: string, status: string): ArchTagInfo => ({
  targetId, lifecycle: { status, phase: null, validFrom: null, validUntil: null }, ownership: null,
});

function drawn(over: Partial<DrawnView> = {}): DrawnView {
  return {
    elements: [el('a'), el('b'), el('c'), el('d')],
    links: [],
    tags: [tag('a', 'reuse'), tag('b', 'build'), tag('c', 'reuse'), tag('d', 'target')],
    nodeStyles: {
      a: { fillColor: '#d5e8d4', borderColor: '#82b366' },
      b: { fillColor: '#cce5ff', borderColor: '#3d85c6', borderStyle: 'dashed' },
      c: { fillColor: '#d5e8d4', borderColor: '#82b366' },
    },
    edgeStyles: {},
    ...over,
  };
}

describe('reading a header', () => {
  it('keeps the fields that are text and ignores the rest', () => {
    expect(readViewHeader({ title: 'T', message: 7, context: '  ', legend: 'nope' })).toEqual({ title: 'T' });
    expect(readViewHeader('a string')).toBeNull();
    expect(readViewHeader({})).toEqual({});
  });

  it('keeps the legend entries it understands, and an empty legend as empty', () => {
    const h = readViewHeader({
      legend: [
        { status: 'reuse' },
        { status: 'build', label: 'build — new' },
        { swatch: { fill: '#fff', style: 'dashed' }, label: 'zone' },
        { line: { color: '#64748b', style: 'wavy' }, label: 'projected from' },
        { swatch: { fill: '#fff' } },
        42,
      ],
    });
    expect(h?.legend).toEqual([
      { status: 'reuse' },
      { status: 'build', label: 'build — new' },
      { swatch: { fill: '#fff', style: 'dashed' }, label: 'zone' },
      { line: { color: '#64748b' }, label: 'projected from' },
    ]);
    expect(readViewHeader({ legend: [] })?.legend).toEqual([]);
  });

  it('reads every view that has one, by view key', () => {
    expect(readViewHeaders({ moduleMap: { header: { message: 'M' } }, 'custom:v': { nodes: {} }, x: null }))
      .toEqual({ moduleMap: { message: 'M' } });
  });

  it('falls back to the view’s name for its title', () => {
    expect(headerTitle({}, 'Module Map')).toBe('Module Map');
    expect(headerTitle({ title: 'Mine' }, 'Module Map')).toBe('Mine');
  });
});

describe('the legend', () => {
  it('lists each status the view carries, in order, drawn the way most of those cards are', () => {
    expect(legendItems({}, drawn())).toEqual([
      { kind: 'swatch', label: 'reuse', fill: '#d5e8d4', border: '#82b366', style: 'solid' },
      { kind: 'swatch', label: 'build', fill: '#cce5ff', border: '#3d85c6', style: 'dashed' },
      // No style of its own: as the built-in status draws it.
      { kind: 'swatch', label: 'target', fill: 'rgba(99,102,241,0.10)', border: '#6366f1', style: 'solid' },
    ]);
  });

  it('then each kind of link, dashed where the canvas dashes it and in the colour it is drawn', () => {
    const items = legendItems({}, drawn({
      tags: [],
      links: [link('f1', 'dataFlow'), link('d1', 'dependency'), link('d2', 'dependency'), link('r1', 'relation')],
      edgeStyles: { f1: { color: '#2563eb', lineStyle: 'solid' }, r1: { lineStyle: 'dotted' } },
    }));
    expect(items).toEqual([
      { kind: 'line', label: 'data flow', color: '#2563eb', style: 'solid' },
      { kind: 'line', label: 'dependency', color: null, style: 'dashed' },
      { kind: 'line', label: 'relation', color: null, style: 'dotted' },
    ]);
  });

  it('is replaced by a written one, whose status entries still take their swatch from the view', () => {
    const items = legendItems({
      legend: [
        { status: 'build', label: 'build — new' },
        { swatch: { fill: '#fff8e1', border: '#d6b656' }, label: 'the shared graph' },
        { line: { color: '#64748b', style: 'dashed' }, label: 'projected from' },
      ],
    }, drawn());
    expect(items).toEqual([
      { kind: 'swatch', label: 'build — new', fill: '#cce5ff', border: '#3d85c6', style: 'dashed' },
      { kind: 'swatch', label: 'the shared graph', fill: '#fff8e1', border: '#d6b656', style: 'solid' },
      { kind: 'line', label: 'projected from', color: '#64748b', style: 'dashed' },
    ]);
  });

  it('takes from the status what a card’s own style leaves unset, as the card does', () => {
    const items = legendItems({}, drawn({
      elements: [el('a')],
      tags: [tag('a', 'to-be-created')],
      nodeStyles: { a: { fillColor: '#fef3c7' } },
    }));
    expect(items).toEqual([{ kind: 'swatch', label: 'to-be-created', fill: '#fef3c7', border: '#f59e0b', style: 'dashed' }]);
  });

  it('is not drawn at all when written empty', () => {
    expect(legendItems({ legend: [] }, drawn())).toEqual([]);
  });

  it('names the written statuses no element in the view carries', () => {
    expect(unknownLegendStatuses({ legend: [{ status: 'reuse' }, { status: 'retire' }] }, drawn())).toEqual(['retire']);
  });
});

describe('editing through the sidecar', () => {
  const ROOT = '/ws/headers';

  beforeEach(() => { localStorage.clear(); vi.useFakeTimers(); });
  afterEach(() => vi.useRealTimers());

  async function session(onDisk: unknown) {
    vi.resetModules();
    const api = vi.mocked(await import('./api'));
    vi.clearAllMocks();
    api.patchLayoutSidecar.mockResolvedValue(null);
    api.fetchLayout.mockImplementation(async () => structuredClone(onDisk));
    const layout = await import('./layout');
    return { api, layout };
  }
  const sent = (api: Awaited<ReturnType<typeof session>>['api']) => api.patchLayoutSidecar.mock.calls.map((c) => c[0]);
  const setField = (field: string, value: string) => (h: Record<string, unknown> | null) => ({ ...(h ?? {}), [field]: value });

  it('is refused until the sidecar has been read', async () => {
    const { api, layout } = await session({ version: 1, views: {} });
    expect(layout.editViewHeader(ROOT, 'moduleMap', () => ({ message: 'M' }))).toBe(false);
    await vi.advanceTimersByTimeAsync(1000);
    expect(api.patchLayoutSidecar).not.toHaveBeenCalled();
  });

  it('sends one change for one field, and leaves the rest of a hand-written header as it is', async () => {
    const header = {
      $comment: 'written by hand',
      title: 'T',
      message: 'old',
      legend: [{ label: 'zone', swatch: { fill: '#fff' } }, { swatch: { fill: '#000' } }],
    };
    const { api, layout } = await session({ version: 1, views: { 'custom:v': { nodes: { a: { x: 1, y: 2 } }, header } } });
    await layout.primeLayoutSidecar(ROOT);
    expect(layout.editViewHeader(ROOT, 'custom:v', setField('message', 'new'))).toBe(true);
    await vi.advanceTimersByTimeAsync(1000);
    expect(sent(api)).toEqual([[{ path: ['views', 'custom:v', 'header', 'message'], value: 'new' }]]);
  });

  it('adds an empty header to a view that already has positions, and it is written', async () => {
    const { api, layout } = await session({ version: 1, views: { moduleMap: { nodes: { a: { x: 1, y: 2 } } } } });
    await layout.primeLayoutSidecar(ROOT);
    layout.editViewHeader(ROOT, 'moduleMap', (h) => h ?? {});
    await vi.advanceTimersByTimeAsync(1000);
    expect(sent(api)).toEqual([[{ path: ['views', 'moduleMap', 'header'], value: {} }]]);
  });

  it('adds a header to a view the file has no entry for, and removing it leaves no empty entry', async () => {
    const { api, layout } = await session({ version: 1, views: {} });
    await layout.primeLayoutSidecar(ROOT);
    layout.editViewHeader(ROOT, 'moduleMap', (h) => h ?? {});
    await vi.advanceTimersByTimeAsync(1000);
    layout.editViewHeader(ROOT, 'moduleMap', () => null);
    await vi.advanceTimersByTimeAsync(1000);
    expect(sent(api)[0]).toEqual([{ path: ['views', 'moduleMap'], value: { header: {} } }]);
    expect(sent(api)[1]).toEqual([{ path: ['views', 'moduleMap'], remove: true }]);
  });

  it('will not replace a header that is not an object', async () => {
    const { api, layout } = await session({ version: 1, views: { moduleMap: { header: 'a hand edit' } } });
    await layout.primeLayoutSidecar(ROOT);
    expect(layout.editViewHeader(ROOT, 'moduleMap', setField('message', 'M'))).toBe(false);
    await vi.advanceTimersByTimeAsync(1000);
    expect(api.patchLayoutSidecar).not.toHaveBeenCalled();
  });
});
