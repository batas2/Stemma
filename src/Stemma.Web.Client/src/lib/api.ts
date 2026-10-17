import type { ArchModel, Book, OperationFailed, RecentEntry, Violation, WorkspaceModel } from './types';

const BASE = '';

import { correlationHeaders } from './log';

/**
 * Every request goes through here so the correlation header cannot be forgotten on a new endpoint.
 *
 * The server echoes the id back, which is what lets a client-side error record name the exchange
 * that produced it — one grep then returns the click, the call, the operation and the write.
 */
async function request(input: string, init: RequestInit = {}): Promise<Response> {
  return fetch(input, {
    ...init,
    headers: { ...(init.headers as Record<string, string> | undefined), ...correlationHeaders() },
  });
}


export async function openWorkspace(rootPath: string): Promise<WorkspaceModel> {
  const r = await request(`${BASE}/api/workspace/open`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ rootPath }),
  });
  if (!r.ok) throw new Error(`Open failed: ${r.status} ${await r.text()}`);
  return r.json();
}

export async function initWorkspace(rootPath?: string, name?: string): Promise<WorkspaceModel> {
  const r = await request(`${BASE}/api/workspace/init`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ rootPath, name }),
  });
  if (!r.ok) throw new Error(`Init failed: ${r.status} ${await r.text()}`);
  return r.json();
}

export async function snapshot(): Promise<WorkspaceModel | null> {
  const r = await request(`${BASE}/api/workspace/snapshot`);
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`Snapshot failed: ${r.status}`);
  return r.json();
}

export async function closeWorkspace(): Promise<void> {
  const r = await request(`${BASE}/api/workspace/close`, { method: 'POST' });
  if (!r.ok && r.status !== 204) throw new Error(`Close failed: ${r.status} ${await r.text()}`);
}

export async function archModel(): Promise<ArchModel | null> {
  const r = await request(`${BASE}/api/workspace/arch`);
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`Arch fetch failed: ${r.status}`);
  return r.json();
}

/** Where an id is declared and the line of C# that declares it — the file's own text (F-003 AC7). */
export interface DeclarationSource { id: string; filePath: string; line: number; text: string }

export async function elementSource(id: string): Promise<DeclarationSource | null> {
  const r = await request(`${BASE}/api/workspace/source/${encodeURIComponent(id)}`);
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`Source fetch failed: ${r.status}`);
  return r.json();
}

export async function books(): Promise<Book[] | null> {
  const r = await request(`${BASE}/api/workspace/books`);
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`Books fetch failed: ${r.status}`);
  return r.json();
}

export async function exportMermaid(view: 'moduleMap' | 'dependencyGraph'): Promise<string> {
  const r = await request(`${BASE}/api/workspace/export/mermaid?view=${view}`);
  if (!r.ok) throw new Error(`Mermaid export failed: ${r.status}`);
  return r.text();
}

export async function listViolations(): Promise<Violation[]> {
  const r = await request(`${BASE}/api/workspace/violations`);
  if (r.status === 404) return [];
  if (!r.ok) return [];
  return r.json();
}

export interface ServerView { id: string; name: string; baseView: string; elementIds: string[]; }

/**
 * The views `Views/*.cs` declares. A list that cannot be read throws rather than coming back
 * empty, because the caller takes this list as the whole truth (B-012).
 */
export async function listServerViews(): Promise<ServerView[]> {
  const r = await request(`${BASE}/api/workspace/views`);
  if (!r.ok) throw new Error(`views fetch failed: ${r.status}`);
  return r.json();
}

/** Save a view through the engine; resolves to its refusal (409) when it declines the edit. */
export async function saveServerView(view: ServerView): Promise<OperationFailed | null> {
  const r = await request(`${BASE}/api/workspace/views`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(view),
  });
  if (r.status === 409) return refusal(r);
  if (!r.ok) throw new Error(`view save failed: ${r.status} ${await r.text()}`);
  return null;
}

/** Delete a view through the engine. One that is already gone (404) is not a failure. */
export async function deleteServerView(viewId: string): Promise<OperationFailed | null> {
  const r = await request(`${BASE}/api/workspace/views/${encodeURIComponent(viewId)}`, { method: 'DELETE' });
  if (r.status === 409) return refusal(r);
  if (!r.ok && r.status !== 404) throw new Error(`view delete failed: ${r.status}`);
  return null;
}

async function refusal(r: Response): Promise<OperationFailed> {
  const body = (await r.json().catch(() => ({}))) as { reason?: string; message?: string };
  return { opId: '', reason: body.reason ?? 'ApplyFailed', message: body.message ?? '' };
}

export async function exportDrawio(): Promise<string> {
  const r = await request(`${BASE}/api/workspace/export/drawio`);
  if (!r.ok) throw new Error(`drawio export failed: ${r.status}`);
  return r.text();
}

export interface BookPdfPagePayload { viewId: string; title: string; narrative: string; capturePngBase64?: string; }
export interface BookPdfPayload { name: string; audience: string | null; pages: BookPdfPagePayload[]; }

export async function exportBookPdf(book: BookPdfPayload): Promise<Blob> {
  const r = await request(`${BASE}/api/workspace/export/book-pdf`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(book),
  });
  if (!r.ok) throw new Error(`book PDF export failed: ${r.status}`);
  return r.blob();
}

export async function listRecents(): Promise<RecentEntry[]> {
  const r = await request(`${BASE}/api/workspace/recents`);
  if (!r.ok) return [];
  return r.json();
}

/** The sidecar as the file has it. A file that cannot be read (409) throws: nothing is primed from it. */
export async function fetchLayout(): Promise<unknown> {
  const r = await request(`${BASE}/api/workspace/layout`);
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`Layout fetch failed: ${r.status} ${await r.text()}`);
  return r.json();
}

/** One change to the sidecar: the value at a path of keys, or its removal (ADR-0021). */
export type SidecarChange = { path: string[]; value: unknown } | { path: string[]; remove: true };

/** Apply changes to the sidecar as it is on disk; resolves to the refusal (409) if it declines them. */
export async function patchLayoutSidecar(changes: SidecarChange[]): Promise<OperationFailed | null> {
  const r = await request(`${BASE}/api/workspace/layout`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ changes }),
  });
  if (r.status === 409) return refusal(r);
  if (!r.ok) throw new Error(`Layout save failed: ${r.status}`);
  return null;
}
