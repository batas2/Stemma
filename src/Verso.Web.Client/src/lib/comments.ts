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
