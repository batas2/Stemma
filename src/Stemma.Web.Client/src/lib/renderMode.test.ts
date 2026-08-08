import { describe, it, expect } from 'vitest';
import { parseRenderParams, isBuiltinView } from './renderMode';
import { computeRenderState, EMPTY_CONFIRM_POLLS, type ReadinessInputs } from './renderReady';
import { resolvePalette, paletteCssVars, DEFAULT_PALETTE, PALETTES } from './palette';

describe('parseRenderParams', () => {
  it('returns null for an ordinary session, so the app is untouched by this code path', () => {
    expect(parseRenderParams('')).toBeNull();
    expect(parseRenderParams('?workspace=/tmp/x')).toBeNull();
  });

  it('treats render=0 and render=false as off, not as "present therefore on"', () => {
    expect(parseRenderParams('?render=0')).toBeNull();
    expect(parseRenderParams('?render=false')).toBeNull();
  });

  it('turns on for a bare flag', () => {
    expect(parseRenderParams('?render=1')).not.toBeNull();
    expect(parseRenderParams('?render')).not.toBeNull();
  });

  it('defaults to the app profile, so a stray render=1 cannot silently restyle the canvas', () => {
    expect(parseRenderParams('?render=1')!.profile).toBe('app');
    expect(parseRenderParams('?render=1&profile=publication')!.profile).toBe('publication');
    expect(parseRenderParams('?render=1&profile=nonsense')!.profile).toBe('app');
  });

  it('reads view, theme and palette, leaving each null when unset', () => {
    const p = parseRenderParams('?render=1&view=view_deps&theme=dark&palette=print')!;
    expect(p.view).toBe('view_deps');
    expect(p.theme).toBe('dark');
    expect(p.palette).toBe('print');

    const bare = parseRenderParams('?render=1')!;
    expect(bare.view).toBeNull();
    expect(bare.theme).toBeNull();
    expect(bare.palette).toBeNull();
  });

  it('ignores a theme it does not recognise rather than setting a broken class', () => {
    expect(parseRenderParams('?render=1&theme=sepia')!.theme).toBeNull();
  });

  it('is bare by default and can be opted out of', () => {
    expect(parseRenderParams('?render=1')!.bare).toBe(true);
    expect(parseRenderParams('?render=1&bare=0')!.bare).toBe(false);
  });
});

describe('isBuiltinView', () => {
  it('separates lens names from custom view ids', () => {
    expect(isBuiltinView('moduleMap')).toBe(true);
    expect(isBuiltinView('dependencyGraph')).toBe(true);
    expect(isBuiltinView('view_deps')).toBe(false);
  });
});

describe('computeRenderState', () => {
  const settled: ReadinessInputs = {
    workspaceOpen: true, archLoaded: true, sidecarPrimed: true,
    nodesMeasured: true, viewportStable: true, fontsReady: true, nodeCount: 3, zeroStreak: 0,
  };

  it('is ready only once everything has settled', () => {
    expect(computeRenderState(settled)).toBe('ready');
  });

  it.each([
    ['workspaceOpen', { workspaceOpen: false }],
    ['archLoaded', { archLoaded: false }],
    ['sidecarPrimed', { sidecarPrimed: false }],
    ['fontsReady', { fontsReady: false }],
    ['nodesMeasured', { nodesMeasured: false }],
    ['viewportStable', { viewportStable: false }],
  ])('stays loading while %s is outstanding', (_name, patch) => {
    expect(computeRenderState({ ...settled, ...patch })).toBe('loading');
  });

  it('waits for the pan to stop, not just for the nodes to exist', () => {
    // Fitting the view is animated. Capturing mid-flight crops to wherever the pan had got to,
    // which is how one view rendered twice produced a 399x1200 image and a 1168x862 one.
    expect(computeRenderState({ ...settled, viewportStable: false })).toBe('loading');
  });

  it('reports empty rather than hanging when the view really resolves to nothing', () => {
    // Without this, "the view has no nodes" and "the page never finished" are indistinguishable
    // from outside, and the renderer has to wait for a timeout to tell them apart.
    expect(computeRenderState({ ...settled, nodeCount: 0, nodesMeasured: false, zeroStreak: EMPTY_CONFIRM_POLLS }))
      .toBe('empty');
  });

  it('does not announce empty in the gap between the data landing and React painting', () => {
    // A real bug, caught by the first end-to-end render: every other input flips true one tick
    // before the canvas has drawn anything. `empty` is terminal for the renderer, so publishing it
    // in that gap turns a perfectly good render into a confident failure.
    for (let streak = 0; streak < EMPTY_CONFIRM_POLLS; streak++) {
      expect(computeRenderState({ ...settled, nodeCount: 0, nodesMeasured: false, zeroStreak: streak }))
        .toBe('loading');
    }
  });

  it('does not call an unsettled page empty just because no nodes exist yet', () => {
    const zeroed = { ...settled, nodeCount: 0, zeroStreak: 99 };
    expect(computeRenderState({ ...zeroed, archLoaded: false })).toBe('loading');
    expect(computeRenderState({ ...zeroed, sidecarPrimed: false })).toBe('loading');
    expect(computeRenderState({ ...zeroed, fontsReady: false })).toBe('loading');
  });

  it('never lets a stale zero streak override nodes that have appeared', () => {
    expect(computeRenderState({ ...settled, nodeCount: 4, zeroStreak: 99 })).toBe('ready');
  });

  it('waits for the sidecar, because defaults would place the nodes somewhere else entirely', () => {
    expect(computeRenderState({ ...settled, sidecarPrimed: false })).toBe('loading');
  });
});

describe('palettes', () => {
  it('falls back to the dual-theme default for an unknown name', () => {
    expect(resolvePalette('nope').name).toBe(DEFAULT_PALETTE);
    expect(resolvePalette(null).name).toBe(DEFAULT_PALETTE);
    expect(resolvePalette(undefined).name).toBe(DEFAULT_PALETTE);
  });

  it('keeps the default transparent and outline-only', () => {
    // These two are the whole reason the profile exists: a fill and a background are the things
    // that cannot survive landing on a page whose colour the author does not control.
    const p = resolvePalette(DEFAULT_PALETTE);
    expect(p.background).toBeNull();
    expect(p.fill).toBe('none');
  });

  it('exposes every palette as CSS variables the stylesheet reads', () => {
    for (const name of Object.keys(PALETTES)) {
      const vars = paletteCssVars(resolvePalette(name));
      expect(Object.keys(vars).sort()).toEqual(['--pub-accent', '--pub-fill', '--pub-stroke', '--pub-text']);
      expect(vars['--pub-stroke']).toMatch(/^#|^none$/);
    }
  });

  it('ships no brand: print is the only opaque palette, and it is opaque on purpose', () => {
    expect(resolvePalette('print').background).toBe('#ffffff');
    expect(resolvePalette('slide').background).toBeNull();
  });
});
