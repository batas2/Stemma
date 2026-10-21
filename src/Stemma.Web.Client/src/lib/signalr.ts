import * as signalR from '@microsoft/signalr';
import { ClientEvent, correlationId, reportFailure } from './log';
import { history } from './history';
import type { OperationEnvelope, OperationResult } from './types';

let connection: signalR.HubConnection | null = null;
const opListeners = new Set<(r: OperationResult) => void>();
const externalListeners = new Set<() => void>();
const sidecarListeners = new Set<() => void>();
const commentsListeners = new Set<() => void>();
const presenterStateListeners = new Set<(state: unknown) => void>();
const presenterCommandListeners = new Set<(command: unknown) => void>();
const reconnectListeners = new Set<() => void>();
let everConnected = false;

export async function ensureConnection(): Promise<signalR.HubConnection> {
  if (connection?.state === signalR.HubConnectionState.Connected) return connection;
  // Made again after one that was up gave up: whatever was announced in between was missed.
  const again = everConnected;
  if (connection) {
    try { await connection.stop(); } catch { /* ignore */ }
  }
  connection = new signalR.HubConnectionBuilder()
    .withUrl('/hubs/workspace')
    .withAutomaticReconnect()
    .configureLogging(signalR.LogLevel.Warning)
    .build();
  connection.on('OperationApplied', (r: OperationResult) => opListeners.forEach(l => l(r)));
  connection.on('ExternalChange', () => externalListeners.forEach(l => l()));
  connection.on('SidecarChanged', () => sidecarListeners.forEach(l => l()));
  connection.on('CommentsChanged', () => commentsListeners.forEach(l => l()));
  connection.on('PresenterState', (state: unknown) => presenterStateListeners.forEach(l => l(state)));
  connection.on('PresenterCommand', (command: unknown) => presenterCommandListeners.forEach(l => l(command)));
  connection.onreconnected(() => reconnectListeners.forEach(l => l()));
  await connection.start();
  everConnected = true;
  if (again) reconnectListeners.forEach(l => l());
  return connection;
}

export function onOperationApplied(cb: (r: OperationResult) => void) {
  opListeners.add(cb);
  return () => opListeners.delete(cb);
}

export function onExternalChange(cb: () => void) {
  externalListeners.add(cb);
  return () => externalListeners.delete(cb);
}

/** stemma.layout.json changed on disk by someone other than this canvas (ADR-0021). */
export function onSidecarChanged(cb: () => void) {
  sidecarListeners.add(cb);
  return () => sidecarListeners.delete(cb);
}

/** comments.stemma.json changed by a hand other than this engine's — a pull, a teammate, an agent (B-018). */
export function onCommentsChanged(cb: () => void) {
  commentsListeners.add(cb);
  return () => commentsListeners.delete(cb);
}

/**
 * The live connection is back after a drop — reconnected on its own, or made again after it gave
 * up. What was announced meanwhile (operations, outside changes, layout and comment saves) is not
 * sent again, so whoever shows any of it reads it afresh.
 */
export function onReconnected(cb: () => void) {
  reconnectListeners.add(cb);
  return () => { reconnectListeners.delete(cb); };
}

/** The presenter's console and the presenting window, relayed by the hub to every other window (F-019). */
export function onPresenterState(cb: (state: unknown) => void) {
  presenterStateListeners.add(cb);
  return () => { presenterStateListeners.delete(cb); };
}

export function onPresenterCommand(cb: (command: unknown) => void) {
  presenterCommandListeners.add(cb);
  return () => { presenterCommandListeners.delete(cb); };
}

export async function sendPresenter(kind: 'PresenterState' | 'PresenterCommand', payload: unknown): Promise<void> {
  const conn = await ensureConnection();
  await conn.invoke(kind, payload);
}

/**
 * The hub carries the correlation id as an argument rather than a header — SignalR has no header on
 * an invocation, and the id has to survive the hop for AC5 to hold end to end.
 */
export async function applyOperation(op: OperationEnvelope): Promise<OperationResult> {
  let result: OperationResult;
  try {
    const conn = await ensureConnection();
    sentOperations.add(op.opId);
    // A bound, for operations whose announcement never came (the connection dropped meanwhile).
    if (sentOperations.size > 500) sentOperations.delete(sentOperations.values().next().value!);
    result = await conn.invoke<OperationResult>('ApplyOperation', op, correlationId());
  } catch (error) {
    sentOperations.delete(op.opId);
    // A refusal like any other, so every caller that says why an edit did not happen says this too —
    // a thrown error reached no one, and the edit silently did not happen.
    reportFailure('Operations', ClientEvent.OperationFailed, describeOperation(op))(error);
    return { opId: op.opId, reason: 'Unreachable', message: error instanceof Error ? error.message : String(error) };
  }
  // Every edit this window makes is a step of its undo history (F-015 AC6), in the order it was made.
  if (!('reason' in result)) history.recordOperation(describeOperation(op));
  else sentOperations.delete(op.opId); // refused: nothing is announced
  return result;
}

// Operations this window sent whose announcement (OperationApplied) has not come back yet.
const sentOperations = new Set<string>();

/**
 * Whether the operation announced as `opId` is one this window sent — asked once per announcement.
 * An operation edits the model and nothing else, so a window's own needs only the model read again;
 * one from another window may come from a workspace that window has just opened on this server.
 */
export function isOwnOperation(opId: string): boolean {
  return sentOperations.delete(opId);
}

/** What an operation did, in the words an undo toast uses ("Undid Rename"). */
export function describeOperation(op: OperationEnvelope): string {
  switch (op.kind) {
    case 'AddElement': return typeof op.name === 'string' ? `Add ${op.name}` : 'Add element';
    case 'RenameElement': return 'Rename';
    case 'RemoveElement': return 'Delete';
    case 'AddLink': return 'Add relationship';
    case 'RemoveLink': return 'Delete relationship';
    case 'SetLinkAttribute': return 'Edit relationship';
    case 'SetLifecycle': return 'Set status';
    case 'SetOwnership': return 'Set owner';
    case 'SetElementContext': return 'Move to bounded context';
    case 'SetElementAttribute': return 'Edit attribute';
    default: return 'Edit';
  }
}

/** The id an AddElement or AddLink made, as the engine says it (F-015) — null for any other result. */
export function addedId(result: OperationResult): string | null {
  if ('reason' in result) return null;
  for (const d of result.deltas as { kind?: string; id?: string }[]) {
    if ((d.kind === 'ElementAdded' || d.kind === 'LinkAdded') && typeof d.id === 'string') return d.id;
  }
  return null;
}

export async function undoOperation(): Promise<OperationResult | null> {
  const conn = await ensureConnection();
  return conn.invoke<OperationResult | null>('Undo');
}

export async function redoOperation(): Promise<OperationResult | null> {
  const conn = await ensureConnection();
  return conn.invoke<OperationResult | null>('Redo');
}

export interface UndoState {
  canUndo: boolean; canRedo: boolean; undoDescription: string | null; redoDescription: string | null;
  undoDepth: number; redoDepth: number;
  /** Which push the top undo / redo entry was (0 for none): a grouped undo checks these before undoing a group together. */
  undoTop: number; redoTop: number;
  /** How many steps the engine keeps. */
  capacity: number;
}

export async function fetchUndoState(): Promise<UndoState> {
  const conn = await ensureConnection();
  return conn.invoke<UndoState>('GetUndoState');
}

export function getConnectionState(): signalR.HubConnectionState | 'unknown' {
  return connection?.state ?? 'unknown';
}

/** This window's live connection as the hub knows it, or null while there is none. */
export function connectionId(): string | null {
  return connection?.state === signalR.HubConnectionState.Connected ? connection.connectionId ?? null : null;
}
