/**
 * Carrying out a paste (F-015): the plan from `clipboard.ts`, as the operations and sidecar entries
 * the canvas already writes one gesture at a time — and as one step of the undo history.
 *
 * Each element's position is written under its new id the moment the engine says what the id is,
 * before the model is read back, so a copy appears where it is going to stay rather than at a
 * default slot it then jumps from.
 */

import { addedId, applyOperation, fetchUndoState } from './signalr';
import { history, type PresentationChange } from './history';
import { loadLayout, saveLayout, sidecarSet } from './layout';
import { friendlyOpError } from './opError';
import { useApp } from './store';
import type { PastePlan, Ref } from './clipboard';
import type { OperationEnvelope, ViewKind } from './types';

export interface PasteResult {
  /** The new elements, in the order they were made. */
  created: string[];
  /** Why the paste stopped part-way, when it did. */
  failed: string | null;
}

let seq = 0;
const opId = () => `op_${Date.now()}_${seq++}`;

/**
 * Make what the plan describes. `description` names the step in the undo history ("Paste 3 elements",
 * "Duplicate Settle"). Stops at the first refusal and says which element it was; what had landed by
 * then stays, selected, and is one ⌘Z away.
 */
export async function executePaste(plan: PastePlan, viewKey: string, description: string): Promise<PasteResult> {
  const st = useApp.getState();
  const root = st.workspace?.rootPath;
  if (!root) return { created: [], failed: 'No workspace is open.' };

  const ids = new Map<string, string>();
  const created: string[] = [];
  const looks: PresentationChange[] = [];
  const resolve = (r: Ref | null): string | null => (r === null ? null : 'existing' in r ? r.existing : ids.get(r.copied) ?? null);
  let failed: string | null = null;

  const apply = async (op: Omit<OperationEnvelope, 'opId'>, what: string): Promise<string | null | false> => {
    const r = await applyOperation({ ...op, opId: opId() } as OperationEnvelope);
    if ('reason' in r) { failed = `${what}: ${friendlyOpError(r)}`; return false; }
    return addedId(r);
  };

  history.beginGroup(description);
  try {
    for (const e of plan.elements) {
      const id = await apply({
        kind: 'AddElement', elementKind: e.kind, name: e.name,
        contextId: resolve(e.context), systemId: resolve(e.system),
        containerKind: e.containerKind, role: e.role,
      }, `"${e.name}" could not be added`);
      if (id === false) break;
      if (!id) { failed = `"${e.name}" was added, but the engine did not say its id.`; break; }
      ids.set(e.from, id);
      created.push(id);
      const positions = loadLayout(root, viewKey as ViewKind);
      saveLayout(root, viewKey as ViewKind, { ...positions, [id]: e.position });
      // Undoing the paste takes the position away with the element, so the sidecar is left as it was.
      looks.push({ section: 'position', view: viewKey, id, before: undefined, after: e.position });
    }

    if (!failed) {
      for (const e of plan.elements) {
        const id = ids.get(e.from)!;
        const about = resolve(e.about);
        if (about && (await apply({ kind: 'SetElementAttribute', elementId: id, attributeName: 'aboutId', value: about }, `"${e.name}"'s link to what it is about`)) === false) break;
        const life = e.lifecycle;
        if (life && (life.status || life.phase || life.validFrom || life.validUntil)
          && (await apply({ kind: 'SetLifecycle', targetId: id, status: life.status, phase: life.phase, validFrom: life.validFrom, validUntil: life.validUntil }, `"${e.name}"'s status`)) === false) break;
        const own = e.ownership;
        if (own && (own.squad || own.domain)
          && (await apply({ kind: 'SetOwnership', targetId: id, squad: own.squad, domain: own.domain }, `"${e.name}"'s owner`)) === false) break;
        if (e.nodeStyle) looks.push({ section: 'nodeStyles', id, before: undefined, after: e.nodeStyle });
        if (e.note) looks.push({ section: 'notes', id, before: undefined, after: e.note });
        if (e.customProps) looks.push({ section: 'customProps', id, before: undefined, after: e.customProps });
      }
    }

    if (!failed) {
      for (const l of plan.links) {
        const source = ids.get(l.source), target = ids.get(l.target);
        if (!source || !target) continue;
        const id = await apply({
          kind: 'AddLink', linkKind: l.kind, fromId: source, toId: target,
          payload: l.payload, dependencyKind: l.dependencyKind, direction: l.direction,
        }, 'A relationship could not be added');
        if (id === false) break;
        if (!id) continue;
        if (l.label && (await apply({ kind: 'SetLinkAttribute', linkId: id, attributeName: 'label', value: l.label }, 'A relationship\'s label')) === false) break;
        if (l.edgeStyle) looks.push({ section: 'edgeStyles', id, before: undefined, after: l.edgeStyle });
      }
    }

    if (created.length > 0) {
      // Placed by hand, as a dropped box is: an automatic layout would move them off where they landed.
      useApp.getState().setViewLayout(viewKey, 'custom');
    }

    if (looks.length > 0) {
      for (const c of looks) if (c.section !== 'position') sidecarSet(root, c.section, c.id, c.after);
      history.recordPresentation(looks, description);
      useApp.getState().rehydratePresentation();
      window.dispatchEvent(new CustomEvent('stemma:notes-changed'));
    }

    // On a view from Views/, the copies join it — in one save, not one per element.
    if (created.length > 0 && useApp.getState().activeCustomViewId) useApp.getState().addElementsToActiveView(created);
  } finally {
    const depth = await fetchUndoState().then((s) => s.undoDepth).catch(() => null);
    history.endGroup(depth);
  }

  return { created, failed };
}
