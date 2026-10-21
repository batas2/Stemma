// @vitest-environment happy-dom
// A layout file the server cannot read was ignored without a word: edits piled up in the window
// and a reload lost them. The banner says so, in the server's words, for as long as it lasts, and
// offers to read the file again.

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SidecarProblem } from '@/lib/layout';

const state = vi.hoisted(() => ({
  problem: null as SidecarProblem | null,
  listeners: new Set<(p: SidecarProblem | null) => void>(),
  retry: vi.fn(async () => undefined),
}));

vi.mock('@/lib/layout', () => ({
  sidecarProblem: () => state.problem,
  onSidecarProblem: (cb: (p: SidecarProblem | null) => void) => { state.listeners.add(cb); return () => { state.listeners.delete(cb); }; },
  retryLayoutSidecar: state.retry,
}));

const { SidecarBanner } = await import('./SidecarBanner');

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;

function say(problem: SidecarProblem | null) {
  state.problem = problem;
  act(() => state.listeners.forEach((l) => l(problem)));
}

beforeEach(() => {
  state.problem = null;
  state.retry.mockClear();
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root.render(<SidecarBanner />));
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

const CONFLICT = { rootPath: '/ws/a', reason: 'UnreadableSidecar', message: 'stemma.layout.json cannot be read at line 3: \'<\' is an invalid start of a value.' };

describe('SidecarBanner', () => {
  it('says nothing while the file reads', () => {
    expect(host.textContent).toBe('');
  });

  it('says the file cannot be read, why, and that the changes are kept', () => {
    say(CONFLICT);
    const status = host.querySelector('[role="status"]')!;
    expect(status.getAttribute('aria-live')).toBe('polite');
    expect(status.textContent).toContain(
      'stemma.layout.json can\'t be read — stemma.layout.json cannot be read at line 3: \'<\' is an invalid start of a value. Layout changes are kept in this window until it\'s fixed.',
    );
  });

  it('reads the file again when asked', async () => {
    say(CONFLICT);
    const button = host.querySelector('button')!;
    expect(button.textContent).toBe('Try again');
    await act(async () => { button.click(); });
    expect(state.retry).toHaveBeenCalledWith('/ws/a');
  });

  it('goes once a read succeeds', () => {
    say(CONFLICT);
    say(null);
    expect(host.textContent).toBe('');
  });
});
