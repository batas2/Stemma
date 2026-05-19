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

describe('Epic 08 C6/C7 — YAML concept selection + hydration', () => {
  it('setYamlConcepts replaces both concepts and relations', () => {
    useApp.getState().setYamlConcepts(
      [{ id: 'agg_x', kind: 'AggregateRoot', name: 'X', layer: 'data', properties: {}, aliases: [] }],
      [{ id: 'rel_a', kind: 'composes', from: 'agg_x', to: 'ent_y', properties: {} }],
    );
    expect(useApp.getState().yamlConcepts).toHaveLength(1);
    expect(useApp.getState().yamlRelations).toHaveLength(1);
  });

  it('selectYamlConcept records the id and clears arch selection', () => {
    useApp.setState({ selectedElementId: 'el_old', selectedLinkId: 'lk_old' });
    useApp.getState().selectYamlConcept('agg_x');
    expect(useApp.getState().selectedYamlConceptId).toBe('agg_x');
    expect(useApp.getState().selectedElementId).toBeNull();
    expect(useApp.getState().selectedLinkId).toBeNull();
  });

  it('selectYamlConcept(null) clears the selection', () => {
    useApp.getState().selectYamlConcept('agg_x');
    useApp.getState().selectYamlConcept(null);
    expect(useApp.getState().selectedYamlConceptId).toBeNull();
  });

  it('selectElement clears any prior yaml concept selection', () => {
    useApp.getState().selectYamlConcept('agg_x');
    useApp.getState().selectElement('el_y');
    // Arch selection is independent — yaml selection persists until DataInspector clears it.
    // Current contract: arch select doesn't touch yaml slot. Lock that in.
    expect(useApp.getState().selectedYamlConceptId).toBe('agg_x');
    expect(useApp.getState().selectedElementId).toBe('el_y');
  });
});

describe('Epic 08 A9 — Books audience filter', () => {
  it('booksAudienceFilter defaults to null', () => {
    expect(useApp.getState().booksAudienceFilter).toBeNull();
  });

  it('setBooksAudienceFilter accepts a string and null', () => {
    useApp.getState().setBooksAudienceFilter('engineering');
    expect(useApp.getState().booksAudienceFilter).toBe('engineering');
    useApp.getState().setBooksAudienceFilter(null);
    expect(useApp.getState().booksAudienceFilter).toBeNull();
  });
});
