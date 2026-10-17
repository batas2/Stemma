import * as signalR from '@microsoft/signalr';
import { correlationId } from './log';
import type { OperationEnvelope, OperationResult } from './types';

let connection: signalR.HubConnection | null = null;
const opListeners = new Set<(r: OperationResult) => void>();
const externalListeners = new Set<() => void>();
const sidecarListeners = new Set<() => void>();
const commentsListeners = new Set<() => void>();

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

/**
 * The hub carries the correlation id as an argument rather than a header — SignalR has no header on
 * an invocation, and the id has to survive the hop for AC5 to hold end to end.
 */
export async function applyOperation(op: OperationEnvelope): Promise<OperationResult> {
  const conn = await ensureConnection();
  return conn.invoke<OperationResult>('ApplyOperation', op, correlationId());
}

export async function undoOperation(): Promise<OperationResult | null> {
  const conn = await ensureConnection();
  return conn.invoke<OperationResult | null>('Undo');
}

export async function redoOperation(): Promise<OperationResult | null> {
  const conn = await ensureConnection();
  return conn.invoke<OperationResult | null>('Redo');
}

export interface UndoState { canUndo: boolean; canRedo: boolean; undoDescription: string | null; redoDescription: string | null; }

export async function fetchUndoState(): Promise<UndoState> {
  const conn = await ensureConnection();
  return conn.invoke<UndoState>('GetUndoState');
}

export function getConnectionState(): signalR.HubConnectionState | 'unknown' {
  return connection?.state ?? 'unknown';
}
