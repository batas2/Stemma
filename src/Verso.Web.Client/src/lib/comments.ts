// Epic 07 Track D — comments substrate.
// Sidecar lives in `comments.verso.json` at the workspace root, written via the engine API.

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

export async function fetchComments(): Promise<CommentsSidecar> {
  const r = await fetch('/api/workspace/comments');
  if (!r.ok) return { version: 1, comments: [] };
  return r.json();
}

export async function saveComments(sidecar: CommentsSidecar): Promise<void> {
  const r = await fetch('/api/workspace/comments', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(sidecar),
  });
  if (!r.ok) throw new Error(`Comments save failed: ${r.status}`);
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
  kind?: string;            // 'verso-comment-pack'
  exportedAt?: string;
  author?: string;
  workspaceRoot?: string;
  comments: CommentEntry[];
}

export function parseCommentPack(raw: string): CommentPack {
  const p = JSON.parse(raw) as CommentPack;
  if (!p || !Array.isArray(p.comments)) throw new Error('Not a Verso comment pack');
  for (const c of p.comments) {
    if (!c.id || !c.targetId || typeof c.body !== 'string') throw new Error('Malformed comment in pack');
  }
  return p;
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
