import type { WorkspaceModel } from './types';

const BASE = '';

export async function openWorkspace(rootPath: string): Promise<WorkspaceModel> {
  const r = await fetch(`${BASE}/api/workspace/open`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ rootPath }),
  });
  if (!r.ok) throw new Error(`Open failed: ${r.status} ${await r.text()}`);
  return r.json();
}

export async function snapshot(): Promise<WorkspaceModel | null> {
  const r = await fetch(`${BASE}/api/workspace/snapshot`);
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`Snapshot failed: ${r.status}`);
  return r.json();
}
