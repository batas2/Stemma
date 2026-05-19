import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  MAX_SHAPES_PER_VIEW,
  addShape, arrowDisplayLabel, isCustomViewKey, loadShapes,
  newArrow, newEllipse, newImage, newLabel, newRect,
  removeShape, setShapeOrder, setShapeCacheForTest, styleForLinkKind, updateShape,
  type Shape,
} from './shapes';

beforeEach(() => setShapeCacheForTest('/ws/x', { version: 1, views: {} }));
afterEach(() => setShapeCacheForTest('/ws/x', { version: 1, views: {} }));

describe('Shape factories', () => {
  it('creates a rect with sensible defaults', () => {
    const r = newRect(10, 20, 100, 80);
    expect(r.kind).toBe('rect');
    expect(r.x).toBe(10);
    expect(r.w).toBe(100);
    expect(r.strokeStyle).toBe('solid');
    expect(r.id).toMatch(/^shp_r_/);
  });

  it('creates each shape kind with a unique id prefix', () => {
    expect(newRect(0, 0).id).toMatch(/^shp_r_/);
    expect(newEllipse(0, 0).id).toMatch(/^shp_e_/);
    expect(newLabel(0, 0).id).toMatch(/^shp_l_/);
    expect(newArrow(0, 0, 10, 10).id).toMatch(/^shp_a_/);
    expect(newImage(0, 0, 'data:image/svg+xml,foo').id).toMatch(/^shp_i_/);
  });
});

describe('Shape CRUD helpers', () => {
  it('addShape appends and returns a new array', () => {
    const r = newRect(0, 0);
    const next = addShape([], r);
    expect(next).toHaveLength(1);
    expect(next[0]).toBe(r);
  });

  it('addShape throws when the cap is exceeded', () => {
    const full: Shape[] = Array.from({ length: MAX_SHAPES_PER_VIEW }, (_, i) => newRect(i, 0));
    expect(() => addShape(full, newRect(0, 0))).toThrow(/maximum/i);
  });

  it('updateShape patches by id', () => {
    const r = newRect(0, 0);
    const next = updateShape([r], r.id, { fill: '#ff0000' });
    expect((next[0] as typeof r).fill).toBe('#ff0000');
  });

  it('removeShape filters by id', () => {
    const r1 = newRect(0, 0);
    const r2 = newRect(10, 10);
    expect(removeShape([r1, r2], r1.id)).toEqual([r2]);
  });

  it('setShapeOrder updates z', () => {
    const r = newRect(0, 0);
    const next = setShapeOrder([r], r.id, 5);
    expect(next[0].z).toBe(5);
  });
});

describe('Sidecar cache + loadShapes', () => {
  it('returns shapes for the requested view', () => {
    const r = newRect(0, 0);
    setShapeCacheForTest('/ws/x', { version: 1, views: { 'custom:cv_1': { shapes: [r] } } });
    expect(loadShapes('/ws/x', 'custom:cv_1')).toHaveLength(1);
  });

  it('returns [] when the view has no shapes', () => {
    expect(loadShapes('/ws/x', 'custom:other')).toEqual([]);
  });

  it('returns [] when the cached rootPath does not match', () => {
    setShapeCacheForTest('/ws/x', { version: 1, views: { 'custom:cv_1': { shapes: [newRect(0, 0)] } } });
    expect(loadShapes('/ws/y', 'custom:cv_1')).toEqual([]);
  });
});

describe('Anchored arrows', () => {
  it('newArrow accepts optional anchors', () => {
    const a = newArrow(0, 0, 100, 100,
      { kind: 'element', id: 'mod_001' },
      { kind: 'shape', id: 'shp_x' });
    expect(a.fromAnchor).toEqual({ kind: 'element', id: 'mod_001' });
    expect(a.toAnchor).toEqual({ kind: 'shape', id: 'shp_x' });
  });

  it('newArrow without anchors leaves them undefined (free coords)', () => {
    const a = newArrow(0, 0, 100, 100);
    expect(a.fromAnchor).toBeUndefined();
    expect(a.toAnchor).toBeUndefined();
  });
});

describe('Relationship vocabulary', () => {
  it('newArrow defaults to dataFlow with solid stroke', () => {
    const a = newArrow(0, 0, 10, 10);
    expect(a.linkKind).toBe('dataFlow');
    expect(a.strokeStyle).toBe('solid');
  });

  it('newArrow with dependency kind picks dashed stroke', () => {
    const a = newArrow(0, 0, 10, 10, undefined, undefined, 'dependency');
    expect(a.linkKind).toBe('dependency');
    expect(a.strokeStyle).toBe('dashed');
  });

  it('arrowDisplayLabel prefers explicit label over payload / subKind', () => {
    const base = newArrow(0, 0, 10, 10);
    expect(arrowDisplayLabel({ ...base, label: 'Hello' })).toBe('Hello');
    expect(arrowDisplayLabel({ ...base, linkKind: 'dataFlow', payload: 'OrderPlaced' })).toBe('OrderPlaced');
    expect(arrowDisplayLabel({ ...base, linkKind: 'dependency', linkSubKind: 'calls' })).toBe('calls');
    expect(arrowDisplayLabel(base)).toBeUndefined();
  });

  it('styleForLinkKind maps dataFlow → solid, dependency → dashed', () => {
    expect(styleForLinkKind('dataFlow').strokeStyle).toBe('solid');
    expect(styleForLinkKind('dependency').strokeStyle).toBe('dashed');
    expect(styleForLinkKind(undefined).strokeStyle).toBe('solid');
  });
});

describe('isCustomViewKey gating', () => {
  it.each([
    ['custom:cv_1', true],
    ['custom:cv_anything', true],
    ['moduleMap', false],
    ['c4Context', false],
    ['engineer', false],
    ['decisionLog', false],
  ])('isCustomViewKey(%s) = %s', (key, expected) => {
    expect(isCustomViewKey(key)).toBe(expected);
  });
});
