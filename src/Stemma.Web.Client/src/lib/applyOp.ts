/**
 * Apply an operation and say so when it does not happen. A refusal used to be dropped by half the
 * places that made edits — Rename, Set status and Delete from a context menu among them — so on a
 * read-only file the box simply stayed, with nothing on screen to say why.
 */

import { applyOperation } from './signalr';
import { friendlyOpError } from './opError';
import { useApp } from './store';
import type { OperationEnvelope, OperationResult } from './types';

export async function applyOrSay(op: OperationEnvelope, success?: string): Promise<OperationResult> {
  const r = await applyOperation(op);
  if ('reason' in r) useApp.getState().setToast({ kind: 'error', text: friendlyOpError(r) });
  else if (success) useApp.getState().setToast({ kind: 'success', text: success });
  return r;
}
