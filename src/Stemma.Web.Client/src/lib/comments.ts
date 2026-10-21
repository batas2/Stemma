// Epic 07 Track D — comments substrate.
// Sidecar lives in `comments.stemma.json` at the workspace root. The engine changes it: the canvas
// sends changes naming each comment by id and shows the file the engine answers with, never a copy
// of its own written back whole (B-018).

import { connectionHeaders } from './api';

export interface CommentReply { author: string; createdAt: string; body: string; }

export interface CommentEntry {
  id: string;
  targetKind: 'element' | 'shape' | 'view';
  targetId: string;
  author: string;
  createdAt: string;
  body: string;
  resolved: boolean;
  thread: CommentReply[];
}

export interface CommentsSidecar { version: number; comments: CommentEntry[]; }

/** One change to the comments, naming its comment by id. Adding what is there and removing what
 *  is gone change nothing, so a change sent twice is harmless. */
export type CommentChange =
  | { op: 'add'; comment: CommentEntry }
  | { op: 'reply'; id: string; reply: CommentReply }
  | { op: 'resolve'; id: string; resolved: boolean }
  | { op: 'remove'; id: string };

/** The engine declined: the file does not parse (`UnreadableSidecar`), or the comment is gone (`NoSuchComment`). */
export class CommentsRefused extends Error {
  constructor(readonly reason: string, message: string) {
    super(message);
    this.name = 'CommentsRefused';
  }
}

/** The file as it is. One that cannot be read is a refusal, never an empty list: the next comment
 *  posted onto an empty list was written over every comment the file held. */
export async function fetchComments(): Promise<CommentsSidecar> {
  const r = await fetch('/api/workspace/comments');
  if (r.status === 409) throw await refused(r);
  if (!r.ok) throw new Error(`Loading comments failed: ${r.status}`);
  return normalised(await r.json());
}

/** Apply `changes` to the file as it is on disk; resolves to the file as it now is, comments
 *  someone else wrote meanwhile included. */
export async function patchComments(changes: CommentChange[]): Promise<CommentsSidecar> {
  const r = await fetch('/api/workspace/comments', {
    method: 'PATCH',
    // Named, so the server tells the other windows and not this one (which shows the answer).
    headers: { 'content-type': 'application/json', ...connectionHeaders() },
    body: JSON.stringify({ changes }),
  });
  if (r.status === 409) throw await refused(r);
  if (!r.ok) throw new Error(`Saving comments failed: ${r.status}`);
  return normalised(await r.json());
}

async function refused(r: Response): Promise<CommentsRefused> {
  const body = await r.json().catch(() => ({})) as { reason?: string; message?: string };
  return new CommentsRefused(body.reason ?? 'Refused', body.message ?? `The comments could not be changed (${r.status}).`);
}

/** A hand-written or agent-written comment may leave out what the panel relies on. */
function normalised(raw: { version?: number; comments?: Partial<CommentEntry>[] }): CommentsSidecar {
  return {
    version: raw.version ?? 1,
    comments: (raw.comments ?? []).map((c) => ({
      ...c,
      targetKind: c.targetKind ?? 'element',
      author: c.author ?? 'anonymous',
      resolved: c.resolved ?? false,
      thread: c.thread ?? [],
    }) as CommentEntry),
  };
}

export async function fetchAuthor(): Promise<string> {
  try {
    const r = await fetch('/api/workspace/author');
    if (!r.ok) return 'anonymous';
    const j = await r.json();
    return j?.author ?? 'anonymous';
  } catch { return 'anonymous'; }
}

export function newCommentId(): string {
  return `cmt_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
}

export function addComment(sidecar: CommentsSidecar, c: CommentEntry): CommentsSidecar {
  return { ...sidecar, comments: [...sidecar.comments, c] };
}

export function removeComment(sidecar: CommentsSidecar, id: string): CommentsSidecar {
  return { ...sidecar, comments: sidecar.comments.filter((x) => x.id !== id) };
}

export function updateComment(sidecar: CommentsSidecar, id: string, patch: Partial<CommentEntry>): CommentsSidecar {
  return {
    ...sidecar,
    comments: sidecar.comments.map((x) => x.id === id ? { ...x, ...patch } : x),
  };
}

export function appendReply(sidecar: CommentsSidecar, id: string, reply: CommentReply): CommentsSidecar {
  return updateComment(sidecar, id, {
    thread: [...(sidecar.comments.find((x) => x.id === id)?.thread ?? []), reply],
  });
}

export function commentsForTarget(sidecar: CommentsSidecar, kind: CommentEntry['targetKind'], targetId: string): CommentEntry[] {
  return sidecar.comments.filter((c) => c.targetKind === kind && c.targetId === targetId);
}

// ---- F-001 comment pack: feedback written inside an exported architecture report, sent back as
// a JSON file and merged here. The pack is a transport envelope only — the sidecar stays the
// single durable home for comments.

export interface CommentPack {
  version: number;
  kind?: string;            // 'stemma-comment-pack'
  exportedAt?: string;
  author?: string;
  workspaceRoot?: string;
  comments: CommentEntry[];
}

export function parseCommentPack(raw: string): CommentPack {
  const p = JSON.parse(raw) as CommentPack;
  if (!p || !Array.isArray(p.comments)) throw new Error('Not a Stemma comment pack');
  for (const c of p.comments) {
    if (!c.id || !c.targetId || typeof c.body !== 'string') throw new Error('Malformed comment in pack');
  }
  return p;
}

/** A pack as the changes that bring it into the comments: each comment it has that they do not,
 *  and each reply not yet in a thread. Empty when it was imported already. */
export function packChanges(sidecar: CommentsSidecar, pack: CommentPack): {
  changes: CommentChange[]; added: number; repliesAdded: number;
} {
  const { merged, added, repliesAdded } = mergeCommentPack(sidecar, pack);
  const before = new Map(sidecar.comments.map((c) => [c.id, c]));
  const changes: CommentChange[] = [];
  for (const c of merged.comments) {
    const was = before.get(c.id);
    if (!was) changes.push({ op: 'add', comment: c });
    // The merge appends replies after the ones already there.
    else for (const reply of c.thread.slice(was.thread.length)) changes.push({ op: 'reply', id: c.id, reply });
  }
  return { changes, added, repliesAdded };
}

/** Merge a pack into the sidecar. Idempotent: comments merge by id; for an id that already
 *  exists, only thread replies not yet present (by author+createdAt+body) are appended and the
 *  local `resolved` flag is kept. Returns the merged sidecar plus what actually changed. */
export function mergeCommentPack(sidecar: CommentsSidecar, pack: CommentPack): {
  merged: CommentsSidecar; added: number; repliesAdded: number;
} {
  let added = 0;
  let repliesAdded = 0;
  const merged = sidecar.comments.map((c) => ({ ...c, thread: [...c.thread] }));
  const mergedById = new Map(merged.map((c) => [c.id, c]));
  for (const incoming of pack.comments) {
    const existing = mergedById.get(incoming.id);
    if (!existing) {
      const fresh: CommentEntry = {
        id: incoming.id,
        targetKind: incoming.targetKind ?? 'element',
        targetId: incoming.targetId,
        author: incoming.author || pack.author || 'anonymous',
        createdAt: incoming.createdAt || new Date().toISOString(),
        body: incoming.body,
        resolved: false,
        thread: [...(incoming.thread ?? [])],
      };
      merged.push(fresh);
      mergedById.set(fresh.id, fresh);
      added++;
      continue;
    }
    const seen = new Set(existing.thread.map((r) => `${r.author}|${r.createdAt}|${r.body}`));
    for (const r of incoming.thread ?? []) {
      const key = `${r.author}|${r.createdAt}|${r.body}`;
      if (!seen.has(key)) { existing.thread.push(r); seen.add(key); repliesAdded++; }
    }
  }
  return { merged: { ...sidecar, comments: merged }, added, repliesAdded };
}
