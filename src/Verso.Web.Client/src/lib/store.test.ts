// Vitest cases for the five UX bugs documented in
// docs/epic-07-canvas-shapes-ux/UX-INVESTIGATION.md.
// Each case maps to one fix in store.ts / App.tsx.

import { afterEach, describe, expect, it, vi, beforeEach } from 'vitest';
import { useApp } from './store';
import type { CustomView, WorkspaceModel } from './types';

const baseSnapshot = (rootPath: string): WorkspaceModel => ({ rootPath, projects: [] });

beforeEach(() => {
  // Reset store between tests so state from a previous test doesn't leak in.
  useApp.setState({
    workspace: null, arch: null, view: 'moduleMap',
    customViews: [], activeCustomViewId: null,
    selectedElementId: null, selectedLinkId: null,
  });
  if (typeof window !== 'undefined') localStorage.clear();
});

afterEach(() => vi.restoreAllMocks());

describe('UX bug #2 — setView no-op when value matches', () => {
  it('does not clobber activeCustomViewId or selectedElementId when the view does not change', () => {
    useApp.setState({ view: 'moduleMap', activeCustomViewId: 'cv_x', selectedElementId: 'mod_001' });
    useApp.getState().setView('moduleMap');
    expect(useApp.getState().activeCustomViewId).toBe('cv_x');
    expect(useApp.getState().selectedElementId).toBe('mod_001');
  });

  it('clobbers activeCustomViewId only when the view actually changes', () => {
    useApp.setState({ view: 'moduleMap', activeCustomViewId: 'cv_x', selectedElementId: 'mod_001' });
    useApp.getState().setView('dependencyGraph');
    expect(useApp.getState().activeCustomViewId).toBeNull();
    expect(useApp.getState().selectedElementId).toBeNull();
  });
});

describe('setActiveCustomView', () => {
  it('sets the active view id and clears selection', () => {
    useApp.setState({ view: 'moduleMap', workspace: baseSnapshot('/ws/x'), selectedElementId: 'mod_001' });
    useApp.getState().setActiveCustomView('cv_q4');
    expect(useApp.getState().activeCustomViewId).toBe('cv_q4');
    expect(useApp.getState().selectedElementId).toBeNull();
  });

  it('keeps the current model view', () => {
    useApp.setState({ view: 'dependencyGraph', workspace: baseSnapshot('/ws/x') });
    useApp.getState().setActiveCustomView('cv_q4');
    expect(useApp.getState().view).toBe('dependencyGraph');
  });
});

describe('UX bug #4 — setWorkspace hydrates only on first open per rootPath', () => {
  it('does not reset activeCustomViewId on a refresh of the same workspace', () => {
    const fixture: CustomView = { id: 'cv_a', name: 'A', baseView: 'all', elementIds: [], createdAt: '2026-01-01' };
    localStorage.setItem('verso.views:/ws/a', JSON.stringify([fixture]));
    // First open hydrates from localStorage.
    useApp.getState().setWorkspace(baseSnapshot('/ws/a'));
    expect(useApp.getState().customViews).toHaveLength(1);
    // Mutate in-memory state as if the user picked a custom view.
    useApp.getState().setActiveCustomView('cv_a');
    expect(useApp.getState().activeCustomViewId).toBe('cv_a');
    // Simulate a refresh: setWorkspace(snapshot) called again with the same rootPath.
    useApp.getState().setWorkspace(baseSnapshot('/ws/a'));
    // The second call must not reload localStorage; in-memory active-view selection survives.
    expect(useApp.getState().activeCustomViewId).toBe('cv_a');
  });

  it('does hydrate when the rootPath changes', () => {
    localStorage.setItem('verso.views:/ws/a', JSON.stringify([]));
    localStorage.setItem('verso.views:/ws/b', JSON.stringify([
      { id: 'cv_b', name: 'B', baseView: 'all', elementIds: [], createdAt: '2026-01-01' },
    ]));
    useApp.getState().setWorkspace(baseSnapshot('/ws/a'));
    expect(useApp.getState().customViews).toHaveLength(0);
    useApp.getState().setWorkspace(baseSnapshot('/ws/b'));
    expect(useApp.getState().customViews).toHaveLength(1);
  });

  it('clears state when workspace becomes null', () => {
    useApp.setState({
      workspace: baseSnapshot('/ws/a'),
      customViews: [{ id: 'cv_a', name: 'A', baseView: 'all', elementIds: [], createdAt: '2026-01-01' }],
      activeCustomViewId: 'cv_a',
    });
    useApp.getState().setWorkspace(null);
    expect(useApp.getState().customViews).toHaveLength(0);
    expect(useApp.getState().activeCustomViewId).toBeNull();
  });
});
