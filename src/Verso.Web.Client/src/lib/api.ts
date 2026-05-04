import type { ArchModel, WorkspaceModel } from './types';

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

export async function initWorkspace(rootPath: string, name?: string): Promise<WorkspaceModel> {
  const r = await fetch(`${BASE}/api/workspace/init`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ rootPath, name }),
  });
  if (!r.ok) throw new Error(`Init failed: ${r.status} ${await r.text()}`);
  return r.json();
}

export async function snapshot(): Promise<WorkspaceModel | null> {
  const r = await fetch(`${BASE}/api/workspace/snapshot`);
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`Snapshot failed: ${r.status}`);
  return r.json();
}

export async function archModel(): Promise<ArchModel | null> {
  const r = await fetch(`${BASE}/api/workspace/arch`);
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`Arch fetch failed: ${r.status}`);
  return r.json();
}

export async function exportMermaid(view: 'c4Context' | 'moduleMap' | 'dependencyGraph'): Promise<string> {
  const r = await fetch(`${BASE}/api/workspace/export/mermaid?view=${view}`);
  if (!r.ok) throw new Error(`Mermaid export failed: ${r.status}`);
  return r.text();
}
