/**
 * Removing the selected elements, from the Delete key or the Layout panel: confirmed once, one step
 * of the undo history, and the first refusal said out loud. The Delete key used to remove only the
 * element the inspector showed — "Remove DslReader?" with two boxes selected — and nothing at all
 * after a marquee selection, while the panel removed each element as its own step and dropped any
 * refusal.
 */

import { applyOperation, fetchUndoState } from '@/lib/signalr';
import { history } from '@/lib/history';
import { friendlyOpError } from '@/lib/opError';
import { useApp } from '@/lib/store';
import { confirmAction } from './ConfirmDialog';

export async function confirmAndRemoveElements(ids: string[]): Promise<boolean> {
  const st = useApp.getState();
  const elements = ids.map((id) => st.arch?.elements.find((e) => e.id === id)).filter((e) => !!e);
  if (elements.length === 0) return false;
  const one = elements.length === 1 ? elements[0] : null;
  const ok = await confirmAction({
    title: one ? `Remove ${one.name}?` : `Remove ${elements.length} elements?`,
    body: 'They are removed from the model. Relationships and decisions linked to them are detached.',
    confirmLabel: 'Remove',
    destructive: true,
  });
  if (!ok) return false;
  const grouped = elements.length > 1;
  if (grouped && !history.beginGroup(`Delete ${elements.length} elements`)) {
    st.setToast({ kind: 'error', text: 'Another change is still being written. Try again in a moment.' });
    return false;
  }
  let removed = 0;
  try {
    for (const e of elements) {
      const r = await applyOperation({ kind: 'RemoveElement', opId: `op_${Date.now()}_${e.id}`, elementId: e.id });
      if ('reason' in r) {
        useApp.getState().setToast({ kind: 'error', text: `${e.name} was not removed: ${friendlyOpError(r)}` });
        break;
      }
      removed++;
    }
  } finally {
    if (grouped) history.endGroup(await fetchUndoState().then((s) => s.undoTop).catch(() => null));
  }
  if (removed === elements.length) {
    useApp.getState().setToast({ kind: 'success', text: one ? `Removed ${one.name}` : `Removed ${removed} elements` });
    useApp.getState().selectElement(null);
  }
  return removed > 0;
}
