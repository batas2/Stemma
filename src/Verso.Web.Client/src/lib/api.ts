import type { ArchModel, RecentEntry, Violation, WorkspaceModel } from './types';

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

export async function listViolations(): Promise<Violation[]> {
  const r = await fetch(`${BASE}/api/workspace/violations`);
  if (r.status === 404) return [];
  if (!r.ok) return [];
  return r.json();
}

export interface ServerView { id: string; name: string; baseView: string; elementIds: string[]; }

export async function listServerViews(): Promise<ServerView[]> {
  const r = await fetch(`${BASE}/api/workspace/views`);
  if (r.status === 404) return [];
  if (!r.ok) return [];
  return r.json();
}

export async function saveServerView(view: ServerView): Promise<void> {
  const r = await fetch(`${BASE}/api/workspace/views`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(view),
  });
  if (!r.ok) throw new Error(`view save failed: ${r.status} ${await r.text()}`);
}

export async function deleteServerView(viewId: string): Promise<void> {
  const r = await fetch(`${BASE}/api/workspace/views/${encodeURIComponent(viewId)}`, { method: 'DELETE' });
  if (!r.ok && r.status !== 404) throw new Error(`view delete failed: ${r.status}`);
}

export async function exportDrawio(): Promise<string> {
  const r = await fetch(`${BASE}/api/workspace/export/drawio`);
  if (!r.ok) throw new Error(`drawio export failed: ${r.status}`);
  return r.text();
}

export async function listRecents(): Promise<RecentEntry[]> {
  const r = await fetch(`${BASE}/api/workspace/recents`);
  if (!r.ok) return [];
  return r.json();
}

export async function fetchLayout(): Promise<unknown> {
  const r = await fetch(`${BASE}/api/workspace/layout`);
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`Layout fetch failed: ${r.status}`);
  return r.json();
}

export async function saveLayoutSidecar(sidecar: unknown): Promise<void> {
  const r = await fetch(`${BASE}/api/workspace/layout`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(sidecar),
  });
  if (!r.ok) throw new Error(`Layout save failed: ${r.status}`);
}
