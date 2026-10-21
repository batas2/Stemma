import { describe, expect, it } from 'vitest';
import { commandIsFor, consoleUrl, formatElapsed, isConsoleCommand, isConsolePage, isPresenterMessage } from './presenterLink';

describe('presenter link', () => {
  it('keeps a console to the presentation it follows', () => {
    expect(commandIsFor({ type: 'command', action: 'next', session: 'a' }, 'a')).toBe(true);
    expect(commandIsFor({ type: 'command', action: 'next', session: 'old' }, 'a')).toBe(false);
    // A console saying hello has no session yet, and is answered.
    expect(commandIsFor({ type: 'command', action: 'hello', session: null }, 'a')).toBe(true);
  });

  it('reads only what is shaped like a message', () => {
    expect(isPresenterMessage({ type: 'ended', session: 's' })).toBe(true);
    expect(isPresenterMessage({ type: 'state' })).toBe(false);
    expect(isPresenterMessage(null)).toBe(false);
    expect(isConsoleCommand({ type: 'command', action: 'prev', session: 's' })).toBe(true);
    expect(isConsoleCommand({ action: 'prev' })).toBe(false);
  });

  it('is the app, asked to be the console', () => {
    expect(consoleUrl('http://127.0.0.1:5188')).toBe('http://127.0.0.1:5188/?presenter=1');
    expect(isConsolePage('?presenter=1')).toBe(true);
    expect(isConsolePage('?render=1')).toBe(false);
  });

  it('writes time the way a clock does', () => {
    expect(formatElapsed(0)).toBe('0:00');
    expect(formatElapsed(247_000)).toBe('4:07');
    expect(formatElapsed(3_753_000)).toBe('1:02:33');
  });
});
