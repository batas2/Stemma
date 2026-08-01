import * as signalR from '@microsoft/signalr';
import type { OperationEnvelope, OperationResult } from './types';

let connection: signalR.HubConnection | null = null;
const opListeners = new Set<(r: OperationResult) => void>();
const externalListeners = new Set<() => void>();

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

export async function applyOperation(op: OperationEnvelope): Promise<OperationResult> {
  const conn = await ensureConnection();
  return conn.invoke<OperationResult>('ApplyOperation', op);
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
