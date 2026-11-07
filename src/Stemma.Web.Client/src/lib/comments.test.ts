import { describe, expect, it } from 'vitest';
import {
  openCommentCounts,
  addComment, appendReply, commentsForTarget, removeComment, updateComment,
  type CommentEntry, type CommentsSidecar,
} from './comments';

const baseSidecar: CommentsSidecar = { version: 1, comments: [] };

function makeComment(id: string, targetId: string, resolved = false): CommentEntry {
  return {
    id, targetKind: 'element', targetId,
    author: 'b', createdAt: '2026-05-12T10:00:00Z',
    body: 'hi', resolved, thread: [],
  };
}

describe('Comment CRUD helpers', () => {
  it('addComment appends', () => {
    const next = addComment(baseSidecar, makeComment('c1', 'e1'));
    expect(next.comments).toHaveLength(1);
    expect(next).not.toBe(baseSidecar);  // returns a new sidecar
  });

  it('removeComment filters by id', () => {
    const s = addComment(addComment(baseSidecar, makeComment('c1', 'e1')), makeComment('c2', 'e2'));
    const next = removeComment(s, 'c1');
    expect(next.comments).toHaveLength(1);
    expect(next.comments[0].id).toBe('c2');
  });

  it('updateComment patches by id', () => {
    const s = addComment(baseSidecar, makeComment('c1', 'e1'));
    const next = updateComment(s, 'c1', { resolved: true });
    expect(next.comments[0].resolved).toBe(true);
  });

  it('appendReply pushes onto the thread', () => {
    const s = addComment(baseSidecar, makeComment('c1', 'e1'));
    const next = appendReply(s, 'c1', { author: 'alice', createdAt: '2026-05-12T11:00:00Z', body: 'k' });
    expect(next.comments[0].thread).toHaveLength(1);
    expect(next.comments[0].thread[0].author).toBe('alice');
  });
});

describe('commentsForTarget filtering', () => {
  it('returns only comments matching the kind + id', () => {
    const s: CommentsSidecar = { version: 1, comments: [
      makeComment('c1', 'e1'),
      makeComment('c2', 'e2'),
      makeComment('c3', 'e1'),
    ] };
    expect(commentsForTarget(s, 'element', 'e1').map((c) => c.id)).toEqual(['c1', 'c3']);
  });

  it('returns [] when nothing matches', () => {
    const s: CommentsSidecar = { version: 1, comments: [makeComment('c1', 'e1')] };
    expect(commentsForTarget(s, 'shape', 'e1')).toEqual([]);
  });
});

// F-027: what a card's badge counts.
describe('openCommentCounts', () => {
  const c = (id: string, targetId: string, over: Partial<CommentEntry> = {}): CommentEntry => ({
    id, targetKind: 'element', targetId, author: 'aria', createdAt: '', body: id, resolved: false, thread: [], ...over,
  });

  it('counts the open comments on each element and relationship, and nothing else', () => {
    const counts = openCommentCounts({
      version: 1,
      comments: [
        c('a', 'mod_pay'), c('b', 'mod_pay'), c('c', 'flow_save'),
        c('d', 'mod_pay', { resolved: true }),
        c('e', 'view_buy', { targetKind: 'view' }),
        c('f', 'shape_1', { targetKind: 'shape' }),
      ],
    });
    expect(counts).toEqual({ mod_pay: 2, flow_save: 1 });
  });

  it('is empty when every comment is resolved', () => {
    expect(openCommentCounts({ version: 1, comments: [c('a', 'mod_pay', { resolved: true })] })).toEqual({});
  });
});
