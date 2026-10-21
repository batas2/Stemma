// Two windows on one workspace never saw each other's layout or comment edits: the engine does not
// announce its own writes, so a change saved from one tab reached no other. The server now tells
// every other window after a save, and needs to know which window it came from — the one that has
// it already. Each save names this window's live connection in `X-Stemma-Connection`.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const live = vi.hoisted(() => ({ id: 'conn-1' as string | null }));
vi.mock('./signalr', () => ({ connectionId: () => live.id }));

const { patchLayoutSidecar } = await import('./api');
const { patchComments } = await import('./comments');

let fetchMock: ReturnType<typeof vi.fn>;
const headersOf = (call: number) => new Headers(fetchMock.mock.calls[call][1].headers as HeadersInit);

beforeEach(() => {
  live.id = 'conn-1';
  fetchMock = vi.fn(async () => new Response('{"version":1,"comments":[]}', { status: 200 }));
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe('a save names the window it came from', () => {
  it('a layout change carries the live connection', async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
    await patchLayoutSidecar([{ path: ['notes', 'm1'], value: 'x' }], '/ws');
    expect(headersOf(0).get('X-Stemma-Connection')).toBe('conn-1');
  });

  it('a comment change carries it too', async () => {
    await patchComments([{ op: 'remove', id: 'cmt_1' }]);
    expect(headersOf(0).get('X-Stemma-Connection')).toBe('conn-1');
  });

  it('without a live connection the header is left out', async () => {
    live.id = null;
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
    await patchLayoutSidecar([{ path: ['notes', 'm1'], value: 'x' }], '/ws');
    await patchComments([{ op: 'remove', id: 'cmt_1' }]);
    expect(headersOf(0).has('X-Stemma-Connection')).toBe(false);
    expect(headersOf(1).has('X-Stemma-Connection')).toBe(false);
  });
});
