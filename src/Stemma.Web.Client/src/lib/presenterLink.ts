/**
 * The presenter's console (F-019): what the presenting window tells it, and what it asks back.
 *
 * Messages go through the hub to every other window, so the console can be a window of this browser,
 * of another browser, or the system browser opened by the desktop shell. A session id ties a console
 * to one presentation: a console left open from an earlier one does not steer a new one by accident.
 */

import { isDesktopShell, openInBrowser } from './shell';

export interface ConsolePage {
  title: string;
  narrative: string;
  /** The view it shows, by name. */
  viewName: string;
  /** How many elements it points at; 0 for the whole view. */
  focus: number;
  /** Why the page cannot show what it says, when it cannot. */
  problem: string | null;
}

export interface PresenterState {
  type: 'state';
  session: string;
  book: { name: string; audience: string | null };
  pages: ConsolePage[];
  index: number;
  /** Where the page's steps have got to (F-020), when it has steps. */
  step: { at: number; of: number; caption: string } | null;
  startedAt: number;
  blank: boolean;
}

export type PresenterMessage = PresenterState | { type: 'ended'; session: string };

export type ConsoleAction = 'next' | 'prev' | 'first' | 'last' | 'blank' | 'exit' | 'goto' | 'hello';

export interface ConsoleCommand {
  type: 'command';
  action: ConsoleAction;
  /** The session the console is following; a `hello` has none yet. */
  session: string | null;
  index?: number;
}

export function isPresenterMessage(v: unknown): v is PresenterMessage {
  const m = v as { type?: unknown; session?: unknown };
  return !!m && (m.type === 'state' || m.type === 'ended') && typeof m.session === 'string';
}

export function isConsoleCommand(v: unknown): v is ConsoleCommand {
  const m = v as { type?: unknown; action?: unknown };
  return !!m && m.type === 'command' && typeof m.action === 'string';
}

/** Whether a command is for this presentation: its session, or a console saying hello. */
export function commandIsFor(command: ConsoleCommand, session: string): boolean {
  return command.action === 'hello' || command.session === session;
}

/** The console's address: this app, asked to be the console. */
export function consoleUrl(origin: string): string {
  return `${origin}/?presenter=1`;
}

export function isConsolePage(search: string): boolean {
  return new URLSearchParams(search).get('presenter') === '1';
}

/**
 * Open the console: a window of this browser, or — in the desktop shell, whose window is the one on
 * the projector — the system browser. False when the browser blocked the window.
 */
export async function openConsole(): Promise<boolean> {
  const url = consoleUrl(window.location.origin);
  if (isDesktopShell()) return openInBrowser(url);
  const opened = window.open(url, 'stemma-presenter', 'popup=yes,width=1200,height=780');
  if (opened) opened.focus();
  return opened !== null;
}

/** "4:07", or "1:02:33" past the hour. */
export function formatElapsed(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  const two = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${two(m)}:${two(sec)}` : `${m}:${two(sec)}`;
}
