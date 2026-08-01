import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, MessageSquare, Send, Trash2, Upload, X } from 'lucide-react';
import {
  type CommentEntry, type CommentsSidecar,
  addComment, appendReply, commentsForTarget, fetchAuthor, fetchComments,
  mergeCommentPack, newCommentId, parseCommentPack, removeComment, saveComments, updateComment,
} from '@/lib/comments';
import { useApp } from '@/lib/store';

interface Props {
  /** What is the comment attached to? */
  targetKind: 'element' | 'shape' | 'view';
  /** Stable id of the target. */
  targetId: string;
  /** Display title (renders in the header). */
  title?: string;
}

/**
 * Side panel that surfaces every comment on a single target. Used by the inspector
 * and (later) the canvas glyph click. Round-trips through `comments.stemma.json`.
 */
export function CommentsPanel({ targetKind, targetId, title }: Props) {
  const [sidecar, setSidecar] = useState<CommentsSidecar>({ version: 1, comments: [] });
  const [author, setAuthor] = useState('anonymous');
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => { fetchAuthor().then(setAuthor); }, []);
  useEffect(() => { fetchComments().then(setSidecar).catch(() => {}); }, [targetKind, targetId]);

  const items = useMemo(() => commentsForTarget(sidecar, targetKind, targetId), [sidecar, targetKind, targetId]);

  async function persist(next: CommentsSidecar) {
    setSidecar(next);
    setBusy(true);
    try { await saveComments(next); }
    finally { setBusy(false); }
  }

  async function onPostNew() {
    const body = draft.trim();
    if (!body) return;
    const c: CommentEntry = {
      id: newCommentId(),
      targetKind, targetId,
      author, createdAt: new Date().toISOString(),
      body, resolved: false, thread: [],
    };
    setDraft('');
    await persist(addComment(sidecar, c));
  }

  // F-001: merge a comment pack exported from an architecture report (.comments.stemma.json).
  const fileRef = useRef<HTMLInputElement>(null);
  async function onImportPack(file: File) {
    const setToast = useApp.getState().setToast;
    try {
      const pack = parseCommentPack(await file.text());
      const fresh = await fetchComments();
      const { merged, added, repliesAdded } = mergeCommentPack(fresh, pack);
      if (!added && !repliesAdded) { setToast({ kind: 'info', text: 'Pack already imported — nothing new.' }); return; }
      await saveComments(merged);
      setSidecar(merged);
      setToast({ kind: 'success', text: `Imported ${added} comment${added === 1 ? '' : 's'}${repliesAdded ? ` + ${repliesAdded} repl${repliesAdded === 1 ? 'y' : 'ies'}` : ''} from ${pack.author ?? 'pack'}` });
    } catch (e) {
      setToast({ kind: 'error', text: `Pack import failed: ${(e as Error).message}` });
    }
  }

  return (
    <div className="border-t border-default mt-2 pt-2">
      <div className="flex items-center gap-2 px-3 mb-2">
        <MessageSquare className="w-3 h-3 text-indigo-500" />
        <span className="text-[11px] font-semibold text-body">
          Comments
          {title && <span className="text-faint font-normal"> on {title}</span>}
        </span>
        <span className="ml-auto text-[10px] text-faint">{items.length}</span>
        <button
          onClick={() => fileRef.current?.click()}
          title="Import a comment pack exported from an architecture report"
          className="p-1 rounded hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100"
        >
          <Upload className="w-3 h-3" />
        </button>
        <input
          ref={fileRef}
          type="file"
          accept=".json,application/json"
          className="hidden"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) onImportPack(f); e.target.value = ''; }}
        />
      </div>
      <div className="px-3 space-y-2">
        {items.map((c) => (
          <CommentCard
            key={c.id}
            entry={c}
            author={author}
            onResolve={() => persist(updateComment(sidecar, c.id, { resolved: !c.resolved }))}
            onRemove={() => persist(removeComment(sidecar, c.id))}
            onReply={(body) => persist(appendReply(sidecar, c.id, { author, createdAt: new Date().toISOString(), body }))}
          />
        ))}
        {items.length === 0 && (
          <p className="text-[10px] text-faint italic">No comments yet.</p>
        )}
      </div>
      <div className="px-3 mt-2 flex gap-1">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); onPostNew(); } }}
          placeholder="Add a comment…"
          aria-label="New comment"
          className="input-base flex-1 text-xs"
          disabled={busy}
        />
        <button
          onClick={onPostNew}
          disabled={busy || draft.trim() === ''}
          aria-label="Post comment"
          className="btn btn-sm btn-primary"
        >
          <Send className="w-3 h-3" />
        </button>
      </div>
    </div>
  );
}

function CommentCard({ entry, author, onResolve, onRemove, onReply }: {
  entry: CommentEntry;
  author: string;
  onResolve: () => void;
  onRemove: () => void;
  onReply: (body: string) => void;
}) {
  const [reply, setReply] = useState('');
  const [collapsed, setCollapsed] = useState(entry.resolved);
  return (
    <div className={`rounded border ${entry.resolved ? 'border-zinc-200 dark:border-zinc-800/60 opacity-70' : 'border-default'} surface px-2 py-1.5`}>
      <div className="flex items-start gap-1.5">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 text-[10px] text-faint">
            <span className="font-mono text-body">{entry.author}</span>
            <span>•</span>
            <span>{new Date(entry.createdAt).toLocaleString()}</span>
            {entry.resolved && <span className="text-emerald-600 dark:text-emerald-400 ml-1">resolved</span>}
          </div>
          {(!collapsed || !entry.resolved) && (
            <div className="text-xs text-body mt-0.5 whitespace-pre-wrap break-words">{entry.body}</div>
          )}
          {!collapsed && entry.thread.length > 0 && (
            <div className="mt-1 pl-2 border-l border-zinc-200 dark:border-zinc-800/60 space-y-1">
              {entry.thread.map((r, i) => (
                <div key={i}>
                  <div className="text-[10px] text-faint">
                    <span className="font-mono text-body">{r.author}</span> · {new Date(r.createdAt).toLocaleString()}
                  </div>
                  <div className="text-xs text-body whitespace-pre-wrap break-words">{r.body}</div>
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="flex flex-col gap-0.5">
          <button onClick={onResolve} aria-label={entry.resolved ? 'Reopen comment' : 'Resolve comment'} title={entry.resolved ? 'Reopen' : 'Resolve'}
            className="p-0.5 rounded text-faint hover:text-emerald-600">
            {entry.resolved ? <X className="w-3 h-3" /> : <Check className="w-3 h-3" />}
          </button>
          {entry.author === author && (
            <button onClick={onRemove} aria-label="Delete comment" title="Delete"
              className="p-0.5 rounded text-faint hover:text-rose-500">
              <Trash2 className="w-3 h-3" />
            </button>
          )}
          {entry.resolved && (
            <button onClick={() => setCollapsed((v) => !v)} aria-label="Toggle collapse"
              className="p-0.5 rounded text-faint hover:text-body">
              {collapsed ? '+' : '−'}
            </button>
          )}
        </div>
      </div>
      {!entry.resolved && (
        <div className="mt-1 flex gap-1">
          <input
            value={reply}
            onChange={(e) => setReply(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && reply.trim()) { onReply(reply.trim()); setReply(''); } }}
            placeholder="Reply…"
            aria-label="Reply"
            className="input-base flex-1 text-[11px]"
          />
        </div>
      )}
    </div>
  );
}
