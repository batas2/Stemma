import * as signalR from '@microsoft/signalr';
import type { OperationEnvelope, OperationResult } from './types';

let connection: signalR.HubConnection | null = null;
const listeners = new Set<(r: OperationResult) => void>();

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
  connection.on('OperationApplied', (r: OperationResult) => listeners.forEach(l => l(r)));
  await connection.start();
  return connection;
}

export function onOperationApplied(cb: (r: OperationResult) => void) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export async function applyOperation(op: OperationEnvelope): Promise<OperationResult> {
  const conn = await ensureConnection();
  return conn.invoke<OperationResult>('ApplyOperation', op);
}

export function getConnectionState(): signalR.HubConnectionState | 'unknown' {
  return connection?.state ?? 'unknown';
}
