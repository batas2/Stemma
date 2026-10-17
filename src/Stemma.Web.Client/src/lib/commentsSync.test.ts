// B-018. The comments panel sends changes, each naming its comment by id, and shows the file the
// server answers with — never its own copy of the whole file. A file the server cannot read is a
// refusal the panel shows, not an empty list it would later write over.

import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  CommentsRefused, fetchComments, packChanges, patchComments,
  type CommentEntry, type CommentPack, type CommentsSidecar,
} from './comments';

function respond(status: number, body: unknown) {
  return vi.fn(async () => new Response(typeof body === 'string' ? body : JSON.stringify(body), { status }));
}

const comment = (id: string, thread: CommentEntry['thread'] = []): CommentEntry => ({
  id, targetKind: 'element', targetId: 'ctx_a', author: 'ada',
  createdAt: '2026-10-01T09:00:00Z', body: `about ${id}`, resolved: false, thread,
});

afterEach(() => vi.unstubAllGlobals());

describe('reading', () => {
  it('shows what the file says, filling in what a hand-written comment leaves out', async () => {
    vi.stubGlobal('fetch', respond(200, {
      version: 1,
      comments: [{ id: 'cmt_1', targetKind: 'element', targetId: 'ctx_a', author: 'ada', createdAt: '2026-10-01T09:00:00Z', body: 'hi', labels: ['q'] }],
    }));

    const read = await fetchComments();

    expect(read.comments[0]).toMatchObject({ id: 'cmt_1', resolved: false, thread: [] });
  });

  it('a file the server cannot read is a refusal, not an empty list', async () => {
    vi.stubGlobal('fetch', respond(409, { reason: 'UnreadableSidecar', message: 'comments.stemma.json cannot be read: …' }));

    const read = fetchComments();

    await expect(read).rejects.toBeInstanceOf(CommentsRefused);
    await expect(read).rejects.toMatchObject({ reason: 'UnreadableSidecar', message: expect.stringContaining('comments.stemma.json') });
  });
});

describe('writing', () => {
  it('sends the change, not the file, and answers with the file as it now is', async () => {
    const onDisk: CommentsSidecar = { version: 1, comments: [comment('cmt_1'), comment('cmt_from_a_pull')] };
    const fetch = respond(200, onDisk);
    vi.stubGlobal('fetch', fetch);

    const after = await patchComments([{ op: 'resolve', id: 'cmt_1', resolved: true }]);

    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/workspace/comments');
    expect(init.method).toBe('PATCH');
    expect(JSON.parse(init.body as string)).toEqual({ changes: [{ op: 'resolve', id: 'cmt_1', resolved: true }] });
    expect(after.comments.map((c) => c.id)).toEqual(['cmt_1', 'cmt_from_a_pull']);
  });

  it('a reply to a comment someone removed is refused, and says so', async () => {
    vi.stubGlobal('fetch', respond(409, { reason: 'NoSuchComment', message: "There is no comment 'cmt_9'; someone may have removed it." }));

    await expect(patchComments([{ op: 'reply', id: 'cmt_9', reply: { author: 'ada', createdAt: 'x', body: 'y' } }]))
      .rejects.toMatchObject({ reason: 'NoSuchComment' });
  });
});

describe('a comment pack, as changes', () => {
  const pack: CommentPack = {
    version: 1,
    author: 'priya',
    comments: [
      { ...comment('cmt_new'), author: '' },
      comment('cmt_1', [
        { author: 'sam', createdAt: '2026-10-02T00:00:00Z', body: 'already here' },
        { author: 'devin', createdAt: '2026-10-03T00:00:00Z', body: 'new reply' },
      ]),
    ],
  };
  const fresh: CommentsSidecar = {
    version: 1,
    comments: [comment('cmt_1', [{ author: 'sam', createdAt: '2026-10-02T00:00:00Z', body: 'already here' }])],
  };

  it('adds what is new and replies with what is new, and nothing else', () => {
    const { changes, added, repliesAdded } = packChanges(fresh, pack);

    expect(added).toBe(1);
    expect(repliesAdded).toBe(1);
    expect(changes).toEqual([
      { op: 'reply', id: 'cmt_1', reply: { author: 'devin', createdAt: '2026-10-03T00:00:00Z', body: 'new reply' } },
      { op: 'add', comment: expect.objectContaining({ id: 'cmt_new', author: 'priya', resolved: false }) },
    ]);
  });

  it('imported twice is nothing the second time', () => {
    const once = packChanges(fresh, pack);
    const merged: CommentsSidecar = {
      version: 1,
      comments: [
        { ...fresh.comments[0], thread: [...fresh.comments[0].thread, pack.comments[1].thread[1]] },
        (once.changes.find((c) => c.op === 'add') as { comment: CommentEntry }).comment,
      ],
    };

    expect(packChanges(merged, pack).changes).toEqual([]);
  });
});
