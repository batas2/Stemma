// Reading the model again after something changed it: an operation from this window or another, an
// outside edit, a reconnect.

import { archModel, listViolations, snapshot } from './api';
import { primeLayoutSidecar } from './layout';
import { ClientEvent, reportFailure } from './log';
import { useApp } from './store';
import type { ArchModel, Violation, WorkspaceModel } from './types';

/**
 * What a refresh reads. `model` is the model and its problems — all an operation can change, since
 * an operation edits the model's statements and never a project, a type or a view. `workspace` is
 * that and the projects and the views as well, for a change from outside, or from another window.
 */
export type RefreshScope = 'model' | 'workspace';

export interface Refresher {
  /** Read again. Resolves once a read made after this call has been drawn. */
  refresh(scope: RefreshScope): Promise<void>;
  /**
   * Take the next turn, for a read made outside the refresher (opening a workspace): any read
   * already on its way is then not drawn, since what it brings back predates this one.
   */
  claim(): () => boolean;
}

/**
 * Refreshes one at a time, in order. They used to run side by side — a paste of ten operations sent
 * ten at once — and whichever answer came back last was drawn, not the newest. Now a burst that
 * arrives while one read is on its way is read once more after it, as one, with the wider scope any
 * of them asked for. `run` gets the scope and whether it is still the newest read when it answers.
 */
export function createRefresher(run: (scope: RefreshScope, current: () => boolean) => Promise<void>): Refresher {
  let turn = 0;
  let reading = false;
  let waiting: { scope: RefreshScope; done: Promise<void>; resolve: () => void } | null = null;

  function claim(): () => boolean {
    const mine = ++turn;
    return () => mine === turn;
  }

  async function drive(scope: RefreshScope): Promise<void> {
    reading = true;
    let next: RefreshScope | null = scope;
    let settle: (() => void) | null = null;
    while (next) {
      try { await run(next, claim()); } catch { /* run says what failed */ }
      settle?.();
      if (waiting) {
        next = waiting.scope;
        settle = waiting.resolve;
        waiting = null;
      } else {
        next = null;
      }
    }
    reading = false;
  }

  function refresh(scope: RefreshScope): Promise<void> {
    if (!reading) return drive(scope);
    if (waiting) {
      if (scope === 'workspace') waiting.scope = 'workspace';
      return waiting.done;
    }
    let resolve!: () => void;
    const done = new Promise<void>((r) => { resolve = r; });
    waiting = { scope, done, resolve };
    return done;
  }

  return { refresh, claim };
}

/**
 * Whether `filePath` — where the model was read from — is inside `root`. A model from outside is
 * another workspace's: another window opened one on the same server.
 */
export function modelBelongsTo(filePath: string, root: string): boolean {
  const norm = (p: string) => p.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
  return norm(filePath).startsWith(`${norm(root)}/`);
}

// A model that could not be read leaves the one drawn: a 404 or a blip is not an empty model.
const KEEP = Symbol('keep');

async function readModel(scope: RefreshScope, current: () => boolean): Promise<void> {
  const root = useApp.getState().workspace?.rootPath ?? null;
  const readWorkspace = () => snapshot().catch((error) => {
    reportFailure('Api', ClientEvent.RequestFailed, 'Reading the workspace snapshot')(error);
    return null;
  });
  const [read, arch, violations] = await Promise.all([
    scope === 'workspace' || root === null ? readWorkspace() : Promise.resolve(undefined),
    archModel().catch((): typeof KEEP => KEEP),
    listViolations().catch((): Violation[] => []),
  ]);
  if (!current()) return;
  let workspace: WorkspaceModel | null | undefined = read;
  // Not this window's workspace any more: read it, so the window follows, as it always has.
  if (workspace === undefined && arch !== KEEP && arch !== null && root !== null && !modelBelongsTo(arch.filePath, root)) {
    workspace = await readWorkspace();
    if (!current()) return;
  }
  const st = useApp.getState();
  if (workspace) {
    st.setWorkspace(workspace);
    // A view file added or deleted outside Stemma — a pull, an IDE — shows now, not on reopen.
    void st.syncViews();
  }
  const open = useApp.getState().workspace?.rootPath;
  if (open) primeLayoutSidecar(open).catch(reportFailure('Sidecar', ClientEvent.SidecarWriteFailed, 'Priming the layout sidecar'));
  if (arch !== KEEP) st.setArch(arch as ArchModel | null);
  st.setViolations(violations);
}

/** The app's refresher. */
export const modelRefresh = createRefresher(readModel);
