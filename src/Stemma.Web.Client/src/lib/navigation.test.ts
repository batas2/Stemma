import { describe, expect, it } from 'vitest';
import { hashFor, leave, placeFor, placeOf, readHash, step, viewsShowing, type Place, type Trail } from './navigation';
import type { ArchElement, CustomView } from './types';

const el = (id: string, kind: ArchElement['kind']): ArchElement => ({ id, name: id, kind, attributes: {} });
const view = (id: string, elementIds: string[], baseView: CustomView['baseView'] = 'all'): CustomView =>
  ({ id, name: id.toUpperCase(), baseView, elementIds, createdAt: '' });

const MAP: Place = { view: 'moduleMap', customViewId: null };
const DEPS: Place = { view: 'dependencyGraph', customViewId: null };

describe('viewsShowing', () => {
  it('lists the built-in lenses that draw a kind, and the views that name it', () => {
    const views = [view('v_pay', ['mod']), view('v_other', ['x'])];
    expect(viewsShowing(el('mod', 'module'), views).map((v) => v.id)).toEqual(['moduleMap', 'dependencyGraph', 'v_pay']);
    expect(viewsShowing(el('sys', 'softwareSystem'), views).map((v) => v.id)).toEqual(['moduleMap']);
  });

  it('puts a concern on the Concerns list as well', () => {
    expect(viewsShowing(el('r', 'risk'), []).map((v) => v.id)).toEqual(['moduleMap', 'concerns']);
  });

  it('draws a Concept only where a view names it (ADR-0018)', () => {
    expect(viewsShowing(el('c', 'concept'), [view('v_essay', ['c'])]).map((v) => v.id)).toEqual(['v_essay']);
  });

  it('honours a view\'s lens: a dependency view does not draw a person it names', () => {
    expect(viewsShowing(el('p', 'person'), [view('v_deps', ['p'], 'dependencyGraph')]).map((v) => v.id)).toEqual(['moduleMap']);
  });
});

describe('placeFor', () => {
  it('stays where it is when this view draws the element', () => {
    expect(placeFor(el('mod', 'module'), [], DEPS)).toEqual(DEPS);
  });

  it('goes to the Module Map otherwise', () => {
    expect(placeFor(el('sys', 'softwareSystem'), [], DEPS)).toEqual(MAP);
    const inView: Place = { view: 'moduleMap', customViewId: 'v_pay' };
    expect(placeFor(el('sys', 'softwareSystem'), [view('v_pay', ['mod'])], inView)).toEqual(MAP);
  });

  it('opens a view that names a Concept, and nowhere when none does', () => {
    expect(placeFor(el('c', 'concept'), [view('v_essay', ['c'])], MAP)).toEqual(placeOf('v_essay'));
    expect(placeFor(el('c', 'concept'), [], MAP)).toBeNull();
  });

  it('never reveals on Concerns, which is a list', () => {
    const concerns: Place = { view: 'concerns', customViewId: null };
    expect(placeFor(el('r', 'risk'), [], concerns)).toEqual(MAP);
  });
});

describe('the trail', () => {
  const empty: Trail = { back: [], forward: [] };
  const V: Place = placeOf('v_pay');

  it('goes back to where you were, and forward again', () => {
    let trail = leave(empty, MAP, DEPS);
    trail = leave(trail, DEPS, V);
    const back = step(trail, V, () => true, 'back')!;
    expect(back.to).toEqual(DEPS);
    const back2 = step(back.trail, DEPS, () => true, 'back')!;
    expect(back2.to).toEqual(MAP);
    const fwd = step(back2.trail, MAP, () => true, 'forward')!;
    expect(fwd.to).toEqual(DEPS);
  });

  it('forgets forward when you go somewhere new', () => {
    const trail = leave(leave(empty, MAP, DEPS), DEPS, V);
    const back = step(trail, V, () => true, 'back')!;
    expect(back.trail.forward).toHaveLength(1);
    expect(leave(back.trail, DEPS, MAP).forward).toHaveLength(0);
  });

  it('skips a view that has gone since', () => {
    const trail = leave(leave(empty, MAP, V), V, DEPS);
    const back = step(trail, DEPS, (p) => p.customViewId !== 'v_pay', 'back')!;
    expect(back.to).toEqual(MAP);
  });

  it('has nowhere to go at the start', () => {
    expect(step(empty, MAP, () => true, 'back')).toBeNull();
  });

  it('does not stack the same place twice', () => {
    expect(leave(leave(empty, MAP, DEPS), MAP, DEPS).back).toEqual([MAP]);
  });
});

describe('the address', () => {
  it('round-trips a place and a selection', () => {
    const hash = hashFor(placeOf('v_pay'), 'mod_auth');
    expect(readHash(hash)).toEqual({ view: 'v_pay', select: 'mod_auth' });
    expect(readHash(hashFor(MAP, null))).toEqual({ view: 'moduleMap', select: null });
  });
});
