// Epic 13 — make "add an element" bulletproof.
//
// Three add entry points (sidebar-palette drop, canvas right-click, command palette) used to
// (a) find the new element by a fragile name+kind match and (b) leave it wherever the current
// view's filter put it — which, for a kind the view doesn't render, was nowhere. This module
// centralizes the reveal: identify the new element by id-diff, switch to a lens that renders
// its kind, position it, and select + center it.

import { useApp } from './store';
import { lensForKind, viewRendersKind } from './lenses';
import { loadLayout, saveLayout } from './layout';
import type { ArchElementKind, ViewKind } from './types';

/** The first element whose id is not in `prevIds` — the one a just-applied AddElement created.
 *  Pure + deterministic, so it unit-tests without timers. */
export function firstNewId(prevIds: Set<string>, elements: { id: string }[]): string | null {
  for (const e of elements) if (!prevIds.has(e.id)) return e.id;
  return null;
}

export interface RevealResult { id: string; name: string; kind: ArchElementKind; view: ViewKind; switched: boolean; }

/**
 * Poll for the element added since `prevIds`, then guarantee it's visible: if the current view
 * can't render its kind, switch to the lens that can (respecting an active custom view), drop a
 * layout position (if a drop point was given), and select + center it. Returns null if no new
 * element appeared (op failed / not refreshed) within the budget.
 */
export async function revealNewElement(
  prevIds: Set<string>,
  opts: { dropPos?: { x: number; y: number } } = {},
): Promise<RevealResult | null> {
  let newId: string | null = null;
  for (let i = 0; i < 15 && !newId; i++) {
    await new Promise((r) => setTimeout(r, 80));
    newId = firstNewId(prevIds, useApp.getState().arch?.elements ?? []);
  }
  if (!newId) return null;

  const st = useApp.getState();
  const el = (st.arch?.elements ?? []).find((e) => e.id === newId);
  if (!el) return null;
  const kind = el.kind as ArchElementKind;

  const inCustomView = st.activeCustomViewId != null;
  let switched = false;
  let finalView: ViewKind = st.view;

  if (inCustomView) {
    // The element is added to the active view's membership; it renders there.
    st.addElementToActiveView(newId);
  } else if (!viewRendersKind(st.view, kind)) {
    // Current lens can't show this kind — switch to the one that can.
    const target = lensForKind(kind);
    if (st.view !== target.view) st.setView(target.view); // resets selection; we re-select below
    finalView = target.view;
    switched = true;
  }

  const ws = st.workspace;
  if (ws && opts.dropPos) {
    const layoutKey = inCustomView ? `custom:${st.activeCustomViewId}` : finalView;
    const positions = loadLayout(ws.rootPath, layoutKey as ViewKind);
    positions[newId] = opts.dropPos;
    saveLayout(ws.rootPath, layoutKey as ViewKind, positions);
  }

  // Select + center after the (possible) view switch settles. When a drop position was given,
  // also force the node there — the arch refresh may have placed it at a default grid slot
  // before the layout save landed.
  setTimeout(() => {
    useApp.getState().selectElement(newId!);
    if (typeof window !== 'undefined') {
      if (opts.dropPos) {
        window.dispatchEvent(new CustomEvent('verso:place-node', { detail: { nodeId: newId, pos: opts.dropPos } }));
      }
      window.dispatchEvent(new CustomEvent('verso:focus-node', { detail: { nodeId: newId } }));
    }
  }, 60);

  return { id: newId, name: el.name, kind, view: finalView, switched };
}

/** Toast text after a reveal — names the lens when we had to switch so the move isn't surprising. */
export function revealToast(r: RevealResult): string {
  const label = r.view === 'dependencyGraph' ? 'Dependencies' : 'Module Map';
  return r.switched
    ? `Added ${r.name} · showing in ${label}`
    : `Added ${r.name} — rename in the inspector`;
}
