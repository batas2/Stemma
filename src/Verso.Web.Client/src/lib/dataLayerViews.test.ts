// Epic 08: assert the new built-in view kinds (`dataModel`, `resourceTree`) are first-class
// in the store and type system. The ViewSwitcher renders six built-in views; switching
// between them must not blow away unrelated state.

import { beforeEach, describe, expect, it } from 'vitest';
import { useApp } from './store';

beforeEach(() => {
  useApp.setState({
    workspace: null, arch: null, view: 'moduleMap',
    customViews: [], activeCustomViewId: null,
    selectedTypeId: null, selectedElementId: null, selectedLinkId: null,
  });
  if (typeof window !== 'undefined') localStorage.clear();
});

describe('Epic 08 — Data Model + Resource Tree built-in views', () => {
  it('accepts `dataModel` as a target of setView', () => {
    useApp.getState().setView('dataModel');
    expect(useApp.getState().view).toBe('dataModel');
  });

  it('accepts `resourceTree` as a target of setView', () => {
    useApp.getState().setView('resourceTree');
    expect(useApp.getState().view).toBe('resourceTree');
  });

  it('switching from custom view to dataModel drops the active custom view', () => {
    useApp.setState({ view: 'moduleMap', activeCustomViewId: 'cv_x' });
    useApp.getState().setView('dataModel');
    expect(useApp.getState().activeCustomViewId).toBeNull();
    expect(useApp.getState().view).toBe('dataModel');
  });

  it('toggling between dataModel and resourceTree keeps both reachable', () => {
    const setView = useApp.getState().setView;
    setView('dataModel');
    expect(useApp.getState().view).toBe('dataModel');
    setView('resourceTree');
    expect(useApp.getState().view).toBe('resourceTree');
    setView('dataModel');
    expect(useApp.getState().view).toBe('dataModel');
  });
});
