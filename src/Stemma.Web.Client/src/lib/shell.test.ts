import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { isDesktopShell, pickFolder, resetShellForTests } from './shell';

/**
 * The shell is optional. Everything here is about the browser path staying intact and about no
 * caller ever being left waiting on a promise that cannot settle.
 */

type Reply = (message: string) => void;

function installShell() {
  const sent: string[] = [];
  let deliver: Reply = () => {};
  (globalThis as unknown as { external: unknown }).external = {
    sendMessage: (m: string) => sent.push(m),
    receiveMessage: (cb: Reply) => { deliver = cb; },
  };
  return {
    sent,
    lastRequest: () => JSON.parse(sent[sent.length - 1]),
    answer: (reply: unknown) => deliver(JSON.stringify(reply)),
    deliverRaw: (raw: string) => deliver(raw),
  };
}

function removeShell() {
  delete (globalThis as unknown as { external?: unknown }).external;
}

beforeEach(() => { resetShellForTests(); removeShell(); });
afterEach(() => { removeShell(); vi.useRealTimers(); });

describe('detecting the shell', () => {
  it('is off in a browser tab', () => {
    expect(isDesktopShell()).toBe(false);
  });

  it('is off when something else has claimed window.external', () => {
    // Browsers have a legacy `external` object with none of these methods on it.
    (globalThis as unknown as { external: unknown }).external = { AddSearchProvider: () => {} };
    expect(isDesktopShell()).toBe(false);
  });

  it('is on inside the window', () => {
    installShell();
    expect(isDesktopShell()).toBe(true);
  });
});

describe('picking a folder', () => {
  it('sends a request the shell can answer', async () => {
    const shell = installShell();

    const picked = pickFolder('Open a workspace', '/home/someone');
    const request = shell.lastRequest();
    expect(request.type).toBe('pickFolder');
    expect(request.title).toBe('Open a workspace');
    expect(request.defaultPath).toBe('/home/someone');

    shell.answer({ id: request.id, ok: true, path: '/home/someone/models/payments' });
    await expect(picked).resolves.toBe('/home/someone/models/payments');
  });

  it('resolves to null when the user cancels', async () => {
    const shell = installShell();
    const picked = pickFolder('Open');
    shell.answer({ id: shell.lastRequest().id, ok: false, path: null });
    await expect(picked).resolves.toBeNull();
  });

  it('resolves to null when the shell refuses', async () => {
    const shell = installShell();
    const picked = pickFolder('Open');
    shell.answer({ id: shell.lastRequest().id, ok: false, error: 'no display' });
    await expect(picked).resolves.toBeNull();
  });

  it('resolves to null in a browser rather than hanging', async () => {
    // The caller shows a spinner; there has to be an answer even when there is no shell.
    await expect(pickFolder('Open')).resolves.toBeNull();
  });

  it('keeps two pickers apart', async () => {
    const shell = installShell();

    const first = pickFolder('First');
    const firstId = shell.lastRequest().id;
    const second = pickFolder('Second');
    const secondId = shell.lastRequest().id;
    expect(secondId).not.toBe(firstId);

    // Answered out of order, which a modal dialog makes unlikely and not impossible.
    shell.answer({ id: secondId, ok: true, path: '/second' });
    shell.answer({ id: firstId, ok: true, path: '/first' });

    await expect(first).resolves.toBe('/first');
    await expect(second).resolves.toBe('/second');
  });

  it('registers exactly one listener however many folders are picked', () => {
    const shell = installShell();
    pickFolder('One');
    pickFolder('Two');
    pickFolder('Three');
    // Photino's receiveMessage registers a callback rather than adding an event listener, so
    // subscribing per request would leave the last one holding every reply.
    expect(shell.sent).toHaveLength(3);
  });

  it('ignores a reply that is not for anyone', async () => {
    const shell = installShell();
    const picked = pickFolder('Open');

    shell.answer({ id: 'nobody', ok: true, path: '/elsewhere' });
    shell.deliverRaw('not json');
    shell.answer({ ok: true, path: '/no-id' });

    shell.answer({ id: shell.lastRequest().id, ok: true, path: '/right' });
    await expect(picked).resolves.toBe('/right');
  });

  it('gives up rather than leaving the caller waiting forever', async () => {
    vi.useFakeTimers();
    installShell();

    const picked = pickFolder('Open');
    await vi.advanceTimersByTimeAsync(5 * 60 * 1000 + 1);

    await expect(picked).resolves.toBeNull();
  });

  it('survives a shell that throws on send', async () => {
    (globalThis as unknown as { external: unknown }).external = {
      sendMessage: () => { throw new Error('window closed'); },
      receiveMessage: () => {},
    };

    await expect(pickFolder('Open')).resolves.toBeNull();
  });
});
