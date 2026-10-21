/**
 * Talking to the desktop shell, when there is one.
 *
 * The same bundle runs in a browser tab and inside the Photino window (ADR-0017), so nothing here
 * may be required for the app to work — every call degrades to "no shell" and the browser path
 * stays exactly as it was. The shell offers two capabilities a tab cannot have: the OS folder picker,
 * which is why opening a workspace used to mean typing an absolute path, and opening the app's own
 * presenter console in the system browser (F-019).
 */

/** What Photino injects into the page. Absent in a browser. */
interface ShellChannel {
  sendMessage?: (message: string) => void;
  receiveMessage?: (callback: (message: string) => void) => void;
}

interface ShellReply {
  id?: string;
  ok?: boolean;
  path?: string | null;
  error?: string;
}

function channel(): Required<ShellChannel> | null {
  const external = (globalThis as { external?: ShellChannel }).external;
  if (typeof external?.sendMessage !== 'function' || typeof external.receiveMessage !== 'function') return null;
  return external as Required<ShellChannel>;
}

/** True inside the desktop window, false in a browser tab. */
export function isDesktopShell(): boolean {
  return channel() !== null;
}

const pending = new Map<string, (reply: ShellReply) => void>();
let listening = false;
let nextId = 0;

/**
 * One listener for the lifetime of the page. Photino's `receiveMessage` registers a callback rather
 * than an event, so subscribing per request would stack them up.
 */
function listen(shell: Required<ShellChannel>) {
  if (listening) return;
  listening = true;
  shell.receiveMessage((raw) => {
    let reply: ShellReply;
    try {
      reply = JSON.parse(raw) as ShellReply;
    } catch {
      return;
    }
    if (!reply.id) return;
    const settle = pending.get(reply.id);
    if (!settle) return;
    pending.delete(reply.id);
    settle(reply);
  });
}

/**
 * How long to wait before giving up on the shell.
 *
 * The dialog is modal and the user may sit in it, so this is generous. It exists at all because a
 * promise that never settles leaves the caller's spinner up forever, which is a worse failure than
 * an honest "the picker did not answer".
 */
const REPLY_TIMEOUT_MS = 5 * 60 * 1000;

/**
 * Ask the shell for a folder. Resolves to the chosen path, or null when the user cancelled, when
 * there is no shell, or when the shell failed to answer.
 */
export function pickFolder(title: string, defaultPath = ''): Promise<string | null> {
  const shell = channel();
  if (!shell) return Promise.resolve(null);
  listen(shell);

  const id = String(++nextId);
  return new Promise<string | null>((resolve) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      resolve(null);
    }, REPLY_TIMEOUT_MS);

    pending.set(id, (reply) => {
      clearTimeout(timer);
      resolve(reply.ok && reply.path ? reply.path : null);
    });

    try {
      shell.sendMessage(JSON.stringify({ id, type: 'pickFolder', title, defaultPath }));
    } catch {
      clearTimeout(timer);
      pending.delete(id);
      resolve(null);
    }
  });
}

/**
 * Ask the shell to open one of this app's own pages in the system browser (F-019: the presenter's
 * console, for the laptop's screen while the window is on the projector). False when there is no
 * shell or it refused; the shell opens only its own loopback address.
 */
export function openInBrowser(url: string): Promise<boolean> {
  const shell = channel();
  if (!shell) return Promise.resolve(false);
  listen(shell);
  const id = String(++nextId);
  return new Promise<boolean>((resolve) => {
    const timer = setTimeout(() => { pending.delete(id); resolve(false); }, 10_000);
    pending.set(id, (reply) => { clearTimeout(timer); resolve(!!reply.ok); });
    try {
      shell.sendMessage(JSON.stringify({ id, type: 'openInBrowser', url }));
    } catch {
      clearTimeout(timer);
      pending.delete(id);
      resolve(false);
    }
  });
}

/** Test seam: the module keeps one listener and a request counter for the page's lifetime. */
export function resetShellForTests() {
  pending.clear();
  listening = false;
  nextId = 0;
}
