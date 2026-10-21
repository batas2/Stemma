import * as signalR from '@microsoft/signalr';
import { correlationId } from './log';
import { history } from './history';
import type { OperationEnvelope, OperationResult } from './types';

let connection: signalR.HubConnection | null = null;
const opListeners = new Set<(r: OperationResult) => void>();
const externalListeners = new Set<() => void>();
const sidecarListeners = new Set<() => void>();
const commentsListeners = new Set<() => void>();
const presenterStateListeners = new Set<(state: unknown) => void>();
const presenterCommandListeners = new Set<(command: unknown) => void>();

export async function ensureConnection(): Promise<signalR.HubConnection> {
  if (connection?.state === signalR.HubConnectionState.Connected) return connection;
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
  await connection.start();
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
  const conn = await ensureConnection();
  const result = await conn.invoke<OperationResult>('ApplyOperation', op, correlationId());
  // Every edit this window makes is a step of its undo history (F-015 AC6), in the order it was made.
  if (!('reason' in result)) history.recordOperation(describeOperation(op));
  return result;
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
