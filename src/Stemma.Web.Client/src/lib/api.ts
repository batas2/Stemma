import type { ArchModel, OperationFailed, RecentEntry, Violation, WorkspaceModel } from './types';

const BASE = '';

import { correlationHeaders } from './log';
import { connectionId } from './signalr';

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


/** Names the window a save came from: its live connection to the hub. */
export const CONNECTION_HEADER = 'X-Stemma-Connection';

/**
 * The header that says which window a save came from. After a layout or comment save the server
 * tells every other window, so a second tab sees the change; this window has it already, and is
 * left out. Without a live connection there is nothing to name, and the header is left out too.
 */
export function connectionHeaders(): Record<string, string> {
  const id = connectionId();
  return id ? { [CONNECTION_HEADER]: id } : {};
}

/**
 * What has to reach the open workspace before the server leaves it: layout edits still waiting to be
 * sent. Whoever holds them registers here, so nothing that opens, creates or closes a workspace can
 * forget to wait — sent afterwards, they landed in the next workspace's file.
 */
const beforeLeaving = new Set<() => Promise<void>>();

export function beforeLeavingWorkspace(settle: () => Promise<void>): void {
  beforeLeaving.add(settle);
}

async function leaving(): Promise<void> {
  await Promise.all([...beforeLeaving].map((settle) => settle().catch(() => undefined)));
}

export async function openWorkspace(rootPath: string): Promise<WorkspaceModel> {
  await leaving();
  const r = await request(`${BASE}/api/workspace/open`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ rootPath }),
  });
  if (!r.ok) throw new Error(`Open failed: ${r.status} ${await r.text()}`);
  return r.json();
}

/** A new workspace, and what became of it in Git. */
export interface CreatedWorkspace extends WorkspaceModel {
  gitInitialised?: boolean;
  /** False when the folder was already inside a repository: its files are left for its owner to commit. */
  committed?: boolean;
  /** The repository the folder was already in, when it was. */
  repositoryRoot?: string | null;
}

/** What to tell someone who has just created `name`: where it is, and whether Git has it yet. */
export function createdMessage(name: string, created: CreatedWorkspace): string {
  if (created.committed === false && created.repositoryRoot) {
    return `Created ${name} inside the Git repository at ${created.repositoryRoot}. Its files are not committed — commit them when you're ready.`;
  }
  return `Created ${name} in ${created.rootPath}`;
}

export async function initWorkspace(rootPath?: string, name?: string): Promise<CreatedWorkspace> {
  await leaving();
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
  await leaving();
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

export interface BookPdfPagePayload { title: string; narrative: string; capturePngBase64?: string; }
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

/** Take a workspace off the recent list (204). */
export async function removeRecent(rootPath: string): Promise<void> {
  const r = await request(`${BASE}/api/workspace/recents?rootPath=${encodeURIComponent(rootPath)}`, { method: 'DELETE' });
  if (!r.ok && r.status !== 204) throw new Error(`Removing from recents failed: ${r.status}`);
}

export async function listRecents(): Promise<RecentEntry[]> {
  const r = await request(`${BASE}/api/workspace/recents`);
  if (!r.ok) return [];
  return r.json();
}

/** The server would not read the sidecar (409): it does not parse — a merge conflict, a half-saved edit. */
export class LayoutRefused extends Error {
  constructor(readonly reason: string, message: string) {
    super(message);
    this.name = 'LayoutRefused';
  }
}

/**
 * The sidecar as the file has it. A file that cannot be read (409) throws a `LayoutRefused` with the
 * server's reason, in words meant for whoever opens the file to fix it: nothing is primed from it.
 */
export async function fetchLayout(): Promise<unknown> {
  const r = await request(`${BASE}/api/workspace/layout`);
  if (r.status === 404) return null;
  if (r.status === 409) {
    const refused = await refusal(r);
    throw new LayoutRefused(refused.reason, refused.message);
  }
  if (!r.ok) throw new Error(`Layout fetch failed: ${r.status} ${await r.text()}`);
  return r.json();
}

/** One change to the sidecar: the value at a path of keys, or its removal (ADR-0021). */
export type SidecarChange = { path: string[]; value: unknown } | { path: string[]; remove: true };

/**
 * Apply changes to the sidecar as it is on disk; resolves to the refusal (409) if it declines them —
 * among other reasons, because `rootPath`, the workspace they were made in, is no longer the open one.
 */
export async function patchLayoutSidecar(changes: SidecarChange[], rootPath: string): Promise<OperationFailed | null> {
  const r = await request(`${BASE}/api/workspace/layout`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json', ...connectionHeaders() },
    body: JSON.stringify({ changes, rootPath }),
  });
  if (r.status === 409) return refusal(r);
  if (!r.ok) throw new Error(`Layout save failed: ${r.status}`);
  return null;
}

// ---------------------------------------------------------------- what the model was (F-017, ADR-0024)

export interface GitCommit { sha: string; shortSha: string; subject: string; author: string; when: string }
export interface GitHistoryInfo {
  repository: boolean;
  /** Why there is nothing to compare with, when there is not. */
  reason: string | null;
  branch: string | null;
  defaultBranch: string | null;
  /** Where this branch left the default one, when on another branch. */
  mergeBase: string | null;
  commits: GitCommit[];
  tags: { name: string; sha: string }[];
}

export async function fetchHistory(): Promise<GitHistoryInfo> {
  const r = await request(`${BASE}/api/workspace/history`);
  if (!r.ok) throw new Error(`History failed: ${r.status}`);
  return r.json();
}

export interface ModelAt {
  rev: string;
  sha: string;
  /** Null when there was no model at that revision. */
  arch: ArchModel | null;
  /** The layout sidecar as it was then, for where removed elements used to sit. */
  layout: unknown | null;
}

/** The model at a revision. Throws with the server's reason when the revision cannot be read. */
export async function fetchModelAt(rev: string): Promise<ModelAt> {
  const r = await request(`${BASE}/api/workspace/arch-at?rev=${encodeURIComponent(rev)}`);
  if (!r.ok) {
    let reason = `The revision could not be read (${r.status}).`;
    try { const body = await r.json(); if (typeof body?.detail === 'string') reason = body.detail; } catch { /* not JSON */ }
    throw new Error(reason);
  }
  return r.json();
}
