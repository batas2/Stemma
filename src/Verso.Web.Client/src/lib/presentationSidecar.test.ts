// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Avoid real network for the debounced PUT.
vi.mock('./api', () => ({ fetchLayout: vi.fn(async () => null), saveLayoutSidecar: vi.fn(async () => {}) }));

import { setSidecarCacheForTest, sidecarMap, primeLayoutSidecar } from './layout';
import { loadNodeStyles, setNodeStyle } from './nodeStyles';
import { loadNote, saveNote } from './elementNotes';
import { loadCustomProps, setCustomProp } from './customProps';
import { loadShapes, saveShapes, newRect, type ShapeRect } from './shapes';

const ROOT = '/ws/test';

beforeEach(() => {
  setSidecarCacheForTest(ROOT, { version: 1, views: {} });
  localStorage.clear();
});

describe('committed presentation sidecar', () => {
  it('node styles are written to the sidecar and read back (sidecar wins)', () => {
    setNodeStyle(ROOT, 'mod_1', { borderWidth: 2, borderStyle: 'solid', fillColor: '#1F4E79', animation: 'glow' });
    expect(loadNodeStyles(ROOT).mod_1.fillColor).toBe('#1F4E79');
    expect((sidecarMap(ROOT, 'nodeStyles') as Record<string, { animation?: string }>).mod_1.animation).toBe('glow');
  });

  it('notes round-trip through the sidecar and clear when emptied', () => {
    saveNote(ROOT, 'mod_1', 'Owns the **ESMA** gate. #owner: Perform');
    expect(loadNote(ROOT, 'mod_1')).toContain('ESMA');
    expect((sidecarMap(ROOT, 'notes') as Record<string, string>).mod_1).toContain('ESMA');
    saveNote(ROOT, 'mod_1', '   ');
    expect(loadNote(ROOT, 'mod_1')).toBe('');
    expect((sidecarMap(ROOT, 'notes') as Record<string, string>).mod_1).toBeUndefined();
  });

  it('custom properties mirror the whole node map to the sidecar', () => {
    setCustomProp(ROOT, 'mod_1', 'owner', 'Perform');
    setCustomProp(ROOT, 'mod_1', 'status', 'NEW');
    expect(loadCustomProps(ROOT).mod_1).toEqual({ owner: 'Perform', status: 'NEW' });
    expect((sidecarMap(ROOT, 'customProps') as Record<string, Record<string, string>>).mod_1.status).toBe('NEW');
  });

  it('shapes/annotations persist per view in the shared sidecar', () => {
    saveShapes(ROOT, 'moduleMap', [{ id: 's1', kind: 'label', x: 0, y: 0, text: 'Risk Service' } as never]);
    expect(loadShapes(ROOT, 'moduleMap')).toHaveLength(1);
    // A node-style write must NOT clobber the shapes (single shared cache).
    setNodeStyle(ROOT, 'mod_1', { borderWidth: 1, borderStyle: 'solid' });
    expect(loadShapes(ROOT, 'moduleMap')).toHaveLength(1);
  });

  it('shape appearance fields + a shape custom property round-trip', () => {
    const rect: ShapeRect = { ...newRect(0, 0, 200, 120), text: 'Option A (fallback)', fillStyle: 'gradient', shadow: 'glow', animation: 'pulse', radius: 10 };
    saveShapes(ROOT, 'view_stage1', [rect]);
    const back = loadShapes(ROOT, 'view_stage1')[0] as ShapeRect;
    expect(back.text).toBe('Option A (fallback)');
    expect(back.fillStyle).toBe('gradient');
    expect(back.animation).toBe('pulse');
    expect(back.radius).toBe(10);
    // Custom props on a shape id persist to the same committed sidecar.
    setCustomProp(ROOT, rect.id, 'owner', 'Onboard');
    expect((sidecarMap(ROOT, 'customProps') as Record<string, Record<string, string>>)[rect.id].owner).toBe('Onboard');
  });

  it('a re-prime never clobbers an in-memory edit (fetched once per workspace)', async () => {
    // Simulates the live-server churn: the user edits, then an external-change/op refresh calls
    // primeLayoutSidecar again. fetchLayout is mocked to return null (empty disk copy); without the
    // once-per-workspace guard the re-prime would reset the cache and the edit would jump back.
    setNodeStyle(ROOT, 'mod_9', { borderWidth: 3, borderStyle: 'solid', fillColor: '#abcdef' });
    await primeLayoutSidecar(ROOT);
    await primeLayoutSidecar(ROOT);
    expect(loadNodeStyles(ROOT).mod_9?.fillColor).toBe('#abcdef');
    expect((sidecarMap(ROOT, 'nodeStyles') as Record<string, { fillColor?: string }>).mod_9.fillColor).toBe('#abcdef');
  });
});
