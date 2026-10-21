import type { ViewKind } from './types';
import { reportFailure, ClientEvent } from './log';
import { beforeLeavingWorkspace, fetchLayout, patchLayoutSidecar, type SidecarChange } from './api';
import { isLayoutConstraint, type LayoutConstraint, type LayoutOffsets } from './layoutDsl';

export interface SavedPosition { x: number; y: number; }

interface SidecarShape {
  version?: number;
  views?: Record<string, { nodes?: Record<string, SavedPosition>; edges?: Record<string, unknown>; shapes?: unknown[]; layoutMode?: string; layout?: unknown; offsets?: Record<string, SavedPosition>; header?: unknown }>;
  nodeStyles?: Record<string, unknown>;
  edgeStyles?: Record<string, unknown>;
  notes?: Record<string, string>;
  customProps?: Record<string, Record<string, string>>;
  annotations?: Record<string, unknown[]>;
  books?: Record<string, unknown>;
}

/** Top-level pass-through sections of the committed sidecar that the client owns the schema of. */
export type SidecarSection = 'nodeStyles' | 'edgeStyles' | 'notes' | 'customProps' | 'annotations';

/** Why the open workspace's sidecar cannot be read or written, in the server's words. */
export interface SidecarProblem { rootPath: string; reason: string; message: string }

let problem: SidecarProblem | null = null;
const problemListeners = new Set<(problem: SidecarProblem | null) => void>();

/**
 * The sidecar of the open workspace cannot be read, or null when it can. While it cannot, no layout
 * edit is sent: each is kept in this window and goes out once the file reads again. That used to
 * happen without a word, and a reload lost every edit of the session.
 */
export function sidecarProblem(): SidecarProblem | null {
  return problem;
}

export function onSidecarProblem(cb: (problem: SidecarProblem | null) => void): () => void {
  problemListeners.add(cb);
  return () => { problemListeners.delete(cb); };
}

function setProblem(next: SidecarProblem | null): void {
  if (JSON.stringify(next) === JSON.stringify(problem)) return;
  problem = next;
  problemListeners.forEach((l) => l(next));
}

/** The server's refusal carried by `error` — a file it cannot read — or null for any other failure. */
function refusalOf(error: unknown): { reason: string; message: string } | null {
  const e = error as { reason?: unknown; message?: unknown } | null;
  return e && typeof e.reason === 'string' && typeof e.message === 'string' ? { reason: e.reason, message: e.message } : null;
}

function ensureSidecar(rootPath: string): SidecarShape {
  if (!sidecarCache || sidecarCache.rootPath !== rootPath) {
    sidecarCache = { rootPath, sidecar: { version: 1, views: {}, nodeStyles: {}, edgeStyles: {} } };
    // A fresh copy holds only what is about to be put in it, so nothing of this workspace has been
    // read. Left marked as read, the empty copy was the whole layout, and the next save removed the
    // rest of the file.
    primedRoot = null;
    sidecarBase = null;
    heldBack = null;
  }
  return sidecarCache.sidecar;
}

/** What an edit makes of the value at its path: the value to put there, or undefined to remove it. */
type Edit = (current: unknown) => unknown;

function valueAt(target: unknown, path: string[]): unknown {
  let node = target;
  for (const key of path) {
    if (!isPlainObject(node)) return undefined;
    node = node[key];
  }
  return node;
}

/**
 * Put what `edit` makes of the value at `path` there, or remove it when that is undefined. Each
 * object on the way is copied rather than changed, so a map handed out earlier — a view's offsets,
 * a section — stays as it was when it was handed out.
 */
function applyEdit(target: Record<string, unknown>, path: string[], edit: Edit): void {
  const current = valueAt(target, path);
  const next = edit(current);
  if (next === undefined && current === undefined) return;
  let node = target;
  for (let i = 0; i < path.length - 1; i++) {
    const child = node[path[i]];
    const copy = isPlainObject(child) ? { ...child } : {};
    node[path[i]] = copy;
    node = copy;
  }
  const last = path[path.length - 1];
  if (next === undefined) delete node[last];
  else node[last] = next;
}

/**
 * Hold an edit made before the sidecar has been read, to make again on the file once it has. Held
 * as what it changed rather than as the window's copy: that copy holds only what the window drew,
 * so laid over the file it put a whole map in place of the file's — every other arrow of the view,
 * the committed shapes, the committed positions — and its removals could not be said at all.
 */
function hold(rootPath: string, path: string[], edit: Edit): void {
  if (isSidecarPrimed(rootPath)) return;
  if (heldBack?.rootPath !== rootPath) heldBack = { rootPath, edits: [] };
  heldBack.edits.push({ path, edit });
}

/** Make an edit to the copy, hold it if the file has not been read yet, and schedule the write. */
function editSidecar(rootPath: string, path: string[], edit: Edit): void {
  applyEdit(ensureSidecar(rootPath) as Record<string, unknown>, path, edit);
  hold(rootPath, path, edit);
  scheduleSidecarWrite(rootPath);
}

function scheduleSidecarWrite(rootPath: string): void {
  if (pendingWrite?.rootPath === rootPath) clearTimeout(pendingWrite.timer);
  const timer = setTimeout(() => {
    pendingWrite = null;
    // Until the committed sidecar has been read there is nothing to measure the edits against, so
    // nothing is sent; priming sends them once it has read the file.
    void flushSidecar(rootPath);
  }, 400);
  pendingWrite = { rootPath, sidecar: ensureSidecar(rootPath), timer };
}

/**
 * The changes that turn `from` into `to`, down to the smallest value that differs: a key whose
 * value changed is set, one that went is removed, and an object present in both is compared key by
 * key. Arrays are values. An empty object that `from` does not have is nothing — it is how an empty
 * section looks in memory, not something anyone wrote — except a view's header, whose being there is
 * the point: an empty header still says the view has one (F-014).
 */
export function sidecarChanges(from: unknown, to: unknown, path: string[] = [], out: SidecarChange[] = []): SidecarChange[] {
  if (isPlainObject(from) && isPlainObject(to)) {
    for (const key of Object.keys(from)) {
      if (from[key] !== undefined && to[key] === undefined) out.push({ path: [...path, key], remove: true });
    }
    for (const key of Object.keys(to)) {
      const value = to[key];
      if (value === undefined) continue;
      if (from[key] === undefined) {
        const header = key === 'header' && path.length === 2 && path[0] === 'views';
        if (header || !(isPlainObject(value) && Object.keys(value).length === 0)) out.push({ path: [...path, key], value });
      } else {
        sidecarChanges(from[key], value, [...path, key], out);
      }
    }
  } else if (JSON.stringify(from) !== JSON.stringify(to)) {
    out.push({ path, value: to });
  }
  return out;
}

/** Apply `changes` to `target` in place, creating the objects a path needs. */
export function applySidecarChanges(target: Record<string, unknown>, changes: SidecarChange[]): void {
  for (const change of changes) {
    let node = target;
    const last = change.path.length - 1;
    let reachable = true;
    for (let i = 0; i < last; i++) {
      const next = node[change.path[i]];
      if (!isPlainObject(next)) {
        if ('remove' in change) { reachable = false; break; }
        node[change.path[i]] = {};
      }
      node = node[change.path[i]] as Record<string, unknown>;
    }
    if (!reachable) continue;
    if ('remove' in change) delete node[change.path[last]];
    else node[change.path[last]] = structuredClone(change.value);
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Send what changed since the copy last read or written, and nothing else (ADR-0021). The server
 * applies it to the file as it is now, so whatever anyone else changed since stays, and the diff of
 * an edit is that edit — sending the whole copy rewrote the file and put back what others had
 * changed (B-014). One send at a time, in order; edits made meanwhile go in the next one. Resolves
 * once what the copy held when it was called has been sent.
 */
function flushSidecar(rootPath: string): Promise<void> {
  const next = sendQueue.then(() => sendChanges(rootPath));
  sendQueue = next.catch(() => undefined);
  return next;
}

async function sendChanges(rootPath: string): Promise<void> {
  if (!isSidecarPrimed(rootPath) || sidecarBase?.rootPath !== rootPath) return;
  // A copy, not references into the live sidecar: an edit made while this request is in flight
  // mutates those objects, and recording the request as written would then record the later edit as
  // written too — when it was never sent.
  const changes = structuredClone(sidecarChanges(sidecarBase.sidecar, sidecarCache!.sidecar));
  if (changes.length === 0) return;
  try {
    const refused = await patchLayoutSidecar(changes, rootPath);
    if (refused) {
      // Kept against the copy, so the next send carries them again.
      reportFailure('Sidecar', ClientEvent.SidecarWriteFailed, 'Writing the layout sidecar')(new Error(`${refused.reason}: ${refused.message}`));
      // Broken since it was read — a merge, a hand edit: said until it reads again.
      if (refused.reason === 'UnreadableSidecar') setProblem({ rootPath, reason: refused.reason, message: refused.message });
    } else if (sidecarBase?.rootPath === rootPath) {
      applySidecarChanges(sidecarBase.sidecar as Record<string, unknown>, changes);
      setProblem(null);
    }
  } catch (error) {
    reportFailure('Sidecar', ClientEvent.SidecarWriteFailed, 'Writing the layout sidecar')(error);
  }
}

/**
 * Send what is waiting now rather than after the pause: the server is about to leave this workspace,
 * and anything sent afterwards would be refused (or, before it named its workspace, written into the
 * next one's file).
 */
export async function settleLayoutSidecar(): Promise<void> {
  if (pendingWrite) {
    clearTimeout(pendingWrite.timer);
    pendingWrite = null;
  }
  await (sidecarCache ? flushSidecar(sidecarCache.rootPath) : sendQueue);
}
beforeLeavingWorkspace(settleLayoutSidecar);

/** Let go of the last workspace's sidecar: another is open, and it is read afresh — reopening the same one included. */
export function forgetLayoutSidecar(): void {
  if (pendingWrite) clearTimeout(pendingWrite.timer);
  pendingWrite = null;
  sidecarCache = null;
  sidecarBase = null;
  primedRoot = null;
  heldBack = null;
  setProblem(null);
}

/**
 * Read the sidecar again after someone else changed it — a pull, a hand edit, an agent — and lay
 * this session's unsent changes over what it now says (ADR-0021). Reading it again used to be
 * forbidden, because the copy it replaced held edits not yet sent; laying those over the new copy is
 * what makes it safe, and not reading it meant the next edit wrote the stale copy over the change.
 */
export function rereadLayoutSidecar(workspaceRoot: string): Promise<void> {
  if (typeof window === 'undefined') return Promise.resolve();
  // Never read because it could not be: the change may be the fix, so try the first read again.
  if (!isSidecarPrimed(workspaceRoot) && problem?.rootPath === workspaceRoot) return primeLayoutSidecar(workspaceRoot);
  // In line with the sends, after the one on its way. Read beside it, the file could be served
  // from before that save and answered after it: the save was then recorded as written, so not
  // laid over what was read, and the window went back to the old value while the file had the new.
  // Behind it, a save that landed is in what is read, and one that failed is still unsent.
  const next = sendQueue.then(() => reread(workspaceRoot));
  sendQueue = next.catch(() => undefined);
  return next;
}

async function reread(workspaceRoot: string): Promise<void> {
  // Not read yet: priming will read the file as it is now.
  if (!isSidecarPrimed(workspaceRoot) || sidecarBase?.rootPath !== workspaceRoot) return;
  let raw: SidecarShape | null;
  try {
    raw = (await fetchLayout()) as SidecarShape | null;
  } catch (error) {
    const refused = refusalOf(error);
    if (refused) setProblem({ rootPath: workspaceRoot, ...refused });
    throw error;
  }
  if (raw === null || !isSidecarPrimed(workspaceRoot) || sidecarBase?.rootPath !== workspaceRoot) return;
  setProblem(null);
  const unsent = sidecarChanges(sidecarBase.sidecar, sidecarCache!.sidecar);
  const next = structuredClone(raw);
  applySidecarChanges(next as Record<string, unknown>, unsent);
  sidecarBase = { rootPath: workspaceRoot, sidecar: structuredClone(raw) };
  sidecarCache = { rootPath: workspaceRoot, sidecar: next };
  mirrorSections(workspaceRoot);
  if (unsent.length > 0) scheduleSidecarWrite(workspaceRoot);
  window.dispatchEvent(new CustomEvent('stemma:sidecar-primed', { detail: { rootPath: workspaceRoot } }));
}

/** Whether this session has read the committed sidecar of `rootPath`, and so holds all of it. */
export function isSidecarPrimed(rootPath: string): boolean {
  return primedRoot === rootPath && sidecarCache?.rootPath === rootPath;
}

/** Read a whole pass-through section from the primed sidecar (undefined if not primed yet). */
export function sidecarMap<T = unknown>(rootPath: string, section: SidecarSection): Record<string, T> | undefined {
  if (!isSidecarPrimed(rootPath)) return undefined;
  return sidecarCache!.sidecar[section] as Record<string, T> | undefined;
}

// Where the browser keeps its copy of a section, drawn before the sidecar has been read (B-012).
const SECTION_CACHE: Partial<Record<SidecarSection, string>> = {
  nodeStyles: 'stemma.nodeStyles',
  edgeStyles: 'stemma.edgeStyles',
  notes: 'stemma.notes',
  customProps: 'stemma.customProps',
};

function sectionCacheKey(section: SidecarSection, rootPath: string): string | null {
  const prefix = SECTION_CACHE[section];
  return prefix ? `${prefix}:${rootPath}` : null;
}

// Each copy as last parsed, so reading one entry per element does not parse the section per element.
const parsedCopies = new Map<string, { raw: string; value: Record<string, unknown> }>();

function browserCopy(cacheKey: string): Record<string, unknown> {
  try {
    const raw = localStorage.getItem(cacheKey);
    if (!raw) return {};
    const known = parsedCopies.get(cacheKey);
    if (known?.raw === raw) return known.value;
    const parsed: unknown = JSON.parse(raw);
    const value = isPlainObject(parsed) ? parsed : {};
    parsedCopies.set(cacheKey, { raw, value });
    return value;
  } catch { return {}; }
}

function writeBrowserCopy(cacheKey: string, value: Record<string, unknown>): void {
  try { localStorage.setItem(cacheKey, JSON.stringify(value)); } catch { /* full, or blocked: it is only a cache */ }
}

/**
 * A pass-through section as the canvas should draw it, shared rather than copied — for reading.
 * Once the committed sidecar has been read it is the whole answer; until then the browser's copy is
 * all there is. The two are never merged: an entry only the browser has is one the repository no
 * longer has — a teammate removed it, a checkout went back past it — and merging it in drew it again
 * on every open (B-012).
 */
function sectionAsDrawn<T>(rootPath: string, section: SidecarSection): Record<string, T> {
  if (isSidecarPrimed(rootPath)) {
    const committed = sidecarCache!.sidecar[section];
    return (isPlainObject(committed) ? committed : {}) as Record<string, T>;
  }
  const cacheKey = sectionCacheKey(section, rootPath);
  return (cacheKey ? browserCopy(cacheKey) : {}) as Record<string, T>;
}

/**
 * A pass-through section as the canvas should draw it — a copy, the caller's to change. Reading
 * writes nothing: the browser's copy is written when the section changes (`sidecarSet`) and when
 * the sidecar is read, once each. It used to be written on every read, and the canvas reads notes
 * once per element: on a large model, every change to a note wrote the whole notes section hundreds
 * of times.
 */
export function cachedSection<T>(rootPath: string, section: SidecarSection): Record<string, T> {
  if (typeof window === 'undefined') return {};
  return { ...sectionAsDrawn<T>(rootPath, section) };
}

/** One entry of a pass-through section as the canvas should draw it, without copying the section. */
export function cachedEntry<T>(rootPath: string, section: SidecarSection, key: string): T | undefined {
  if (typeof window === 'undefined') return undefined;
  const map = sectionAsDrawn<T>(rootPath, section);
  return Object.prototype.hasOwnProperty.call(map, key) ? map[key] : undefined;
}

/** Write the browser's copy of every section from the sidecar just read: what the next open draws first. */
function mirrorSections(rootPath: string): void {
  for (const section of Object.keys(SECTION_CACHE) as SidecarSection[]) {
    writeBrowserCopy(sectionCacheKey(section, rootPath)!, sectionAsDrawn(rootPath, section));
  }
}

/**
 * Set (or delete, when value is undefined) one entry in a pass-through section and schedule the
 * write. The browser's copy of the section is written here, once: the committed section once the
 * sidecar has been read, and before that the copy being drawn, with this entry in it.
 */
export function sidecarSet(rootPath: string, section: SidecarSection, key: string, value: unknown): void {
  if (typeof window === 'undefined') return;
  const next = value === undefined || value === null ? undefined : structuredClone(value);
  editSidecar(rootPath, [section, key], () => next);
  const cacheKey = sectionCacheKey(section, rootPath);
  if (!cacheKey) return;
  if (isSidecarPrimed(rootPath)) {
    writeBrowserCopy(cacheKey, sectionAsDrawn(rootPath, section));
    return;
  }
  const drawn = { ...browserCopy(cacheKey) };
  if (next === undefined) delete drawn[key];
  else drawn[key] = next;
  writeBrowserCopy(cacheKey, drawn);
}

/**
 * The committed `books` section (F-013), or undefined until the sidecar has been read — before then
 * there is no way to tell a workspace with no books from one whose books have not arrived.
 */
export function loadBooksSection(rootPath: string): Record<string, unknown> | undefined {
  if (!isSidecarPrimed(rootPath)) return undefined;
  const books = sidecarCache!.sidecar.books;
  return isPlainObject(books) ? books : {};
}

/**
 * Edit the `books` section in place and schedule the write; the change list carries only what the
 * edit touched (ADR-0021). Refused — false, nothing changed — until the sidecar has been read, and
 * when `books` is something other than an object: replacing what a hand edit left there would
 * delete it, and an edit nobody could see land is worse than one refused out loud.
 */
export function editBooksSection(rootPath: string, edit: (books: Record<string, unknown>) => void): boolean {
  if (typeof window === 'undefined' || !isSidecarPrimed(rootPath)) return false;
  const sidecar = sidecarCache!.sidecar;
  if (sidecar.books !== undefined && !isPlainObject(sidecar.books)) return false;
  const books = sidecar.books ?? {};
  edit(books);
  sidecar.books = books;
  scheduleSidecarWrite(rootPath);
  return true;
}

/** Every view's entry as the sidecar holds it, for reading the parts the client owns (headers). */
export function loadViewEntries(rootPath: string): Record<string, unknown> {
  if (sidecarCache?.rootPath !== rootPath) return {};
  return { ...(sidecarCache.sidecar.views ?? {}) };
}

/**
 * Edit a view's header (F-014, ADR-0023) as the file holds it, and schedule the write. `edit` gets
 * the stored header — every key in it, the ones the app does not read included — or null when the
 * view has none, and returns the header to keep, or null to remove it. Only what changed is sent
 * (ADR-0021), so editing the message leaves a hand-written legend exactly as it was.
 *
 * Refused — false, nothing changed — until the sidecar has been read, and when what is stored under
 * `header` is not an object: replacing what a hand edit left there would delete it.
 */
export function editViewHeader(
  rootPath: string,
  viewKey: string,
  edit: (header: Record<string, unknown> | null) => Record<string, unknown> | null,
): boolean {
  if (typeof window === 'undefined' || !isSidecarPrimed(rootPath)) return false;
  const s = sidecarCache!.sidecar;
  const stored = s.views?.[viewKey]?.header;
  if (stored !== undefined && !isPlainObject(stored)) return false;
  const next = edit(stored ? structuredClone(stored) : null);
  s.views = s.views ?? {};
  const view: Record<string, unknown> = { ...s.views[viewKey] };
  if (next) view.header = next; else delete view.header;
  // A view entry that held nothing but the header goes with it, rather than staying behind empty.
  if (Object.keys(view).length === 0) delete s.views[viewKey];
  else s.views[viewKey] = view;
  scheduleSidecarWrite(rootPath);
  return true;
}

/** Per-view free-form canvas shapes (annotations), persisted under views.<key>.shapes. */
export function loadViewShapes<T = unknown>(rootPath: string, viewKey: string): T[] {
  if (sidecarCache?.rootPath !== rootPath) return [];
  return ((sidecarCache.sidecar.views?.[viewKey]?.shapes) as T[] | undefined) ?? [];
}

export function saveViewShapes(rootPath: string, viewKey: string, shapes: unknown[]): void {
  if (typeof window === 'undefined') return;
  const path = ['views', viewKey, 'shapes'];
  if (isSidecarPrimed(rootPath)) {
    const next = structuredClone(shapes);
    editSidecar(rootPath, path, () => next);
    return;
  }
  // Before the read the window draws only the shapes added since, so the list it saves is not the
  // view's: each shape added, changed or removed is held as that, by its id, and the file's own
  // shapes stay.
  const drawn = loadViewShapes(rootPath, viewKey);
  const drawnById = new Map(drawn.map((shape) => [shapeId(shape), shape] as const));
  for (const shape of shapes) {
    const id = shapeId(shape);
    if (id !== null && JSON.stringify(drawnById.get(id)) === JSON.stringify(shape)) continue;
    const item = structuredClone(shape);
    editSidecar(rootPath, path, (current) => {
      const list = Array.isArray(current) ? [...current] : [];
      const at = id === null ? -1 : list.findIndex((s) => shapeId(s) === id);
      if (at >= 0) list[at] = item; else list.push(item);
      return list;
    });
  }
  const kept = new Set(shapes.map(shapeId));
  for (const id of drawnById.keys()) {
    if (id === null || kept.has(id)) continue;
    editSidecar(rootPath, path, (current) => (Array.isArray(current) ? current.filter((s) => shapeId(s) !== id) : current));
  }
}

function shapeId(shape: unknown): string | null {
  return isPlainObject(shape) && typeof shape.id === 'string' ? shape.id : null;
}

/**
 * Per-view layout mode, committed rather than kept in the browser.
 *
 * This decides whether the positions stored beside it are authoritative or are about to be
 * overwritten by an auto-layout on open — so a workspace that did not carry it drew differently on
 * a fresh clone than on the machine it was authored on. It is presentation and it must travel with
 * the model, which means the sidecar, not `localStorage`.
 */
export function loadViewLayoutModes(rootPath: string): Record<string, string> {
  if (sidecarCache?.rootPath !== rootPath) return {};
  const out: Record<string, string> = {};
  for (const [key, view] of Object.entries(sidecarCache.sidecar.views ?? {})) {
    if (view?.layoutMode) out[key] = view.layoutMode;
  }
  return out;
}

export function saveViewLayoutMode(rootPath: string, viewKey: string, mode: string): void {
  if (typeof window === 'undefined') return;
  editSidecar(rootPath, ['views', viewKey, 'layoutMode'], () => mode);
}

/**
 * The layout constraint governing a view, if it has one.
 *
 * Stored beside the positions rather than instead of them: a constraint may govern part of a
 * diagram, and the nodes it does not mention keep their absolute positions.
 */
export function loadViewConstraint(rootPath: string, viewKey: string): LayoutConstraint | null {
  if (sidecarCache?.rootPath !== rootPath) return null;
  const raw = sidecarCache.sidecar.views?.[viewKey]?.layout;
  return isLayoutConstraint(raw) ? raw : null;
}

export function saveViewConstraint(rootPath: string, viewKey: string, constraint: LayoutConstraint | null): void {
  if (typeof window === 'undefined') return;
  const next = constraint ? structuredClone(constraint) : undefined;
  editSidecar(rootPath, ['views', viewKey, 'layout'], () => next);
}

/** Per-node nudges against the solved constraint. Empty when the view has no constraint. */
export function loadViewOffsets(rootPath: string, viewKey: string): LayoutOffsets {
  if (sidecarCache?.rootPath !== rootPath) return {};
  return sidecarCache.sidecar.views?.[viewKey]?.offsets ?? {};
}

export function saveViewOffset(rootPath: string, viewKey: string, nodeId: string, offset: SavedPosition | null): void {
  if (typeof window === 'undefined') return;
  // A nudge of zero is the absence of a nudge; keeping it would grow the file for nothing.
  const next = !offset || (offset.x === 0 && offset.y === 0) ? undefined : { ...offset };
  editSidecar(rootPath, ['views', viewKey, 'offsets', nodeId], () => next);
}

/** Drop every nudge on a view, returning it to the pure solved arrangement. */
export function clearViewOffsets(rootPath: string, viewKey: string): void {
  if (typeof window === 'undefined') return;
  editSidecar(rootPath, ['views', viewKey, 'offsets'], () => ({}));
}

/** Test seam: inject the shared sidecar cache without going through fetch. */
export function setSidecarCacheForTest(rootPath: string, sidecar: unknown): void {
  sidecarCache = { rootPath, sidecar: sidecar as SidecarShape };
  sidecarBase = { rootPath, sidecar: structuredClone(sidecar) as SidecarShape };
  primedRoot = rootPath;
}

const KEY_PREFIX = 'stemma.layout';
const MIGRATED_KEY_PREFIX = 'stemma.layout.migrated';

function key(workspaceRoot: string, view: ViewKind | string): string {
  return `${KEY_PREFIX}:${workspaceRoot}:${view}`;
}

function migratedKey(workspaceRoot: string): string {
  return `${MIGRATED_KEY_PREFIX}:${workspaceRoot}`;
}

// In-memory cache of the latest sidecar so reads don't refetch every drag-stop.
let sidecarCache: { rootPath: string; sidecar: SidecarShape } | null = null;
let pendingWrite: { rootPath: string; sidecar: SidecarShape; timer: ReturnType<typeof setTimeout> } | null = null;
// The sidecar as the file has it, as far as this session knows: what was last read, plus what has
// been written since. What the cache holds beyond it is what is still to be sent.
let sidecarBase: { rootPath: string; sidecar: SidecarShape } | null = null;
// Sends, one after another.
let sendQueue: Promise<void> = Promise.resolve();
// Workspace the committed sidecar has already been fetched for. Once set, the in-memory cache is
// authoritative for the session and we never re-fetch (re-fetching clobbers unflushed local edits).
let primedRoot: string | null = null;
// Edits made before the sidecar was read, in the order they were made (see `hold`).
let heldBack: { rootPath: string; edits: { path: string[]; edit: Edit }[] } | null = null;

export function loadLayout(workspaceRoot: string, view: ViewKind | string): Record<string, SavedPosition> {
  if (typeof window === 'undefined') return {};
  // Once read, the sidecar is the whole answer: a view it has no positions for is laid out afresh,
  // not from what this browser remembers of it (B-012).
  if (isSidecarPrimed(workspaceRoot)) {
    const nodes = sidecarCache!.sidecar.views?.[view]?.nodes;
    try {
      if (nodes) localStorage.setItem(key(workspaceRoot, view), JSON.stringify(nodes));
      else localStorage.removeItem(key(workspaceRoot, view));
    } catch { /* ignore */ }
    return nodes ?? {};
  }
  // Before that: what was moved during the load, then what this browser remembers.
  if (sidecarCache?.rootPath === workspaceRoot) {
    const v = sidecarCache.sidecar.views?.[view];
    if (v?.nodes) return v.nodes;
  }
  try {
    const raw = localStorage.getItem(key(workspaceRoot, view));
    return raw ? JSON.parse(raw) : {};
  } catch { return {}; }
}

export function saveLayout(workspaceRoot: string, view: ViewKind | string, positions: Record<string, SavedPosition>): void {
  if (typeof window === 'undefined') return;
  const primed = isSidecarPrimed(workspaceRoot);
  // What the window drew from, before this save: the measure of what the save changed.
  const drawn = primed ? null : loadLayout(workspaceRoot, view);
  // Localstorage as the durable in-browser cache.
  try { localStorage.setItem(key(workspaceRoot, view), JSON.stringify(positions)); } catch { /* ignore */ }

  const path = ['views', String(view), 'nodes'];
  const whole = structuredClone(positions);
  if (primed) {
    editSidecar(workspaceRoot, path, () => whole);
    return;
  }
  // Before the read the window draws what it has, and saves every card on the view: the ones it
  // had no position for are at default slots, and on a fresh clone that is all of them. A card it
  // had a position for and that moved is held as moved; one it had none for only fills a gap the
  // file leaves, so a default slot never replaces a committed position. (The first drag on a fresh
  // clone is a default slot too, as far as anyone can tell from here: if the file places that card,
  // the file wins.) A card missing from the save is not removed: the file says what is on the view.
  applyEdit(ensureSidecar(workspaceRoot) as Record<string, unknown>, path, () => whole);
  for (const [id, position] of Object.entries(whole)) {
    const was = drawn![id];
    if (was === undefined) hold(workspaceRoot, [...path, id], (current) => current ?? position);
    else if (JSON.stringify(was) !== JSON.stringify(position)) hold(workspaceRoot, [...path, id], () => position);
  }
  scheduleSidecarWrite(workspaceRoot);
}

export function mergePositions(
  defaults: Record<string, SavedPosition>,
  saved: Record<string, SavedPosition>
): Record<string, SavedPosition> {
  return { ...defaults, ...saved };
}

/**
 * Read edge waypoints for a given view from the sidecar cache. Returns an empty map if
 * the sidecar isn't primed yet or the view has no edge entries.
 */
export function loadEdgeWaypoints(workspaceRoot: string, view: ViewKind | string): Record<string, SavedPosition[]> {
  if (sidecarCache?.rootPath !== workspaceRoot) return {};
  const v = sidecarCache.sidecar.views?.[view];
  if (!v?.edges) return {};
  const out: Record<string, SavedPosition[]> = {};
  for (const [edgeId, entry] of Object.entries(v.edges)) {
    const e = entry as { waypoints?: SavedPosition[] };
    if (e?.waypoints && e.waypoints.length > 0) out[edgeId] = e.waypoints;
  }
  return out;
}

/**
 * Persist a single edge's waypoints into the sidecar (debounced PUT, parallel to saveLayout).
 */
export function saveEdgeWaypoints(
  workspaceRoot: string,
  view: ViewKind | string,
  edgeId: string,
  waypoints: SavedPosition[]
): void {
  if (typeof window === 'undefined') return;
  const next = structuredClone(waypoints);
  // Only the bends: the dot each end is docked to is kept when they are cleared.
  editSidecar(workspaceRoot, ['views', String(view), 'edges', edgeId], (current) =>
    withEntryKey(current, 'waypoints', next.length > 0 ? next : undefined));
}

/** An edge's entry with `key` set (or removed, when `value` is undefined); undefined once nothing is left in it. */
function withEntryKey(entry: unknown, key: string, value: unknown): Record<string, unknown> | undefined {
  const next: Record<string, unknown> = isPlainObject(entry) ? { ...entry } : {};
  if (value === undefined) delete next[key];
  else next[key] = value;
  return Object.keys(next).length > 0 ? next : undefined;
}

/** Which connection dot each end of a relationship is anchored to (see lib/edgeDock DockId). */
export interface EdgeHandlePair { source?: string; target?: string; }

/** Read per-edge dock-handle anchors for a view from the primed sidecar. */
export function loadEdgeHandles(workspaceRoot: string, view: ViewKind | string): Record<string, EdgeHandlePair> {
  if (sidecarCache?.rootPath !== workspaceRoot) return {};
  const v = sidecarCache.sidecar.views?.[view];
  if (!v?.edges) return {};
  const out: Record<string, EdgeHandlePair> = {};
  for (const [edgeId, entry] of Object.entries(v.edges)) {
    const h = (entry as { handles?: EdgeHandlePair }).handles;
    if (h && (h.source || h.target)) out[edgeId] = h;
  }
  return out;
}

/** Persist (or clear) one edge's dock-handle anchors, preserving any waypoints on the same entry. */
export function saveEdgeHandles(
  workspaceRoot: string,
  view: ViewKind | string,
  edgeId: string,
  handles: EdgeHandlePair | null
): void {
  if (typeof window === 'undefined') return;
  const next = handles && (handles.source || handles.target) ? { ...handles } : undefined;
  editSidecar(workspaceRoot, ['views', String(view), 'edges', edgeId], (current) => withEntryKey(current, 'handles', next));
}

/**
 * Fetch the stemma.layout.json sidecar on workspace open. If the sidecar is empty
 * but localStorage has positions for known views, migrate them into the sidecar
 * and write it back so layouts travel with the workspace in Git from now on.
 */
export async function primeLayoutSidecar(workspaceRoot: string): Promise<void> {
  if (typeof window === 'undefined') return;
  // Fetch the committed sidecar from disk exactly ONCE per workspace. Afterwards the in-memory
  // cache is the session's source of truth — every local edit updates it and debounce-flushes to
  // stemma.layout.json. Re-fetching on later refreshes (which fire on every model op AND on the
  // file-watch event our own layout PUT triggers) would overwrite not-yet-flushed edits with stale
  // disk data — the "box jumps back / routing reverts / canvas blinks while editing" bug.
  if (primedRoot === workspaceRoot) return;
  try {
    const raw = (await fetchLayout()) as SidecarShape | null;
    // No workspace open on the server: nothing has been read, so nothing may be written. Treating
    // it as an empty sidecar would let the next edit replace the real one with that edit alone.
    if (raw === null) return;
    setProblem(null);
    // Opening primes from two places at once. Whichever read lands second finds the cache already
    // read — not edits held back while it loaded — and must leave it alone rather than write it.
    if (primedRoot === workspaceRoot) return;
    // What the file says, before anything below adds to the copy: the measure of what to send.
    sidecarBase = { rootPath: workspaceRoot, sidecar: structuredClone(raw) };
    // Edits made while it loaded, made again on the file as read, in the order they were made.
    const held = heldBack?.rootPath === workspaceRoot ? heldBack.edits : [];
    heldBack = null;
    const sidecar: SidecarShape = raw;
    for (const { path, edit } of held) applyEdit(sidecar as Record<string, unknown>, path, edit);
    sidecarCache = { rootPath: workspaceRoot, sidecar };
    // Marked only after a successful read, so a failed fetch retries on the next call. From here on
    // the session holds the whole sidecar, and may write it.
    primedRoot = workspaceRoot;

    // First-load migration from localStorage (idempotent).
    let touched = false;
    const alreadyMigrated = localStorage.getItem(migratedKey(workspaceRoot)) === '1';
    if (!alreadyMigrated) {
      const candidates = ['moduleMap', 'dependencyGraph'];
      sidecar.views = sidecar.views ?? {};
      for (const v of candidates) {
        const stored = localStorage.getItem(key(workspaceRoot, v));
        if (!stored) continue;
        try {
          const positions = JSON.parse(stored) as Record<string, SavedPosition>;
          if (!sidecar.views[v]?.nodes && Object.keys(positions).length > 0) {
            sidecar.views[v] = { ...sidecar.views[v], nodes: positions };
            touched = true;
          }
        } catch { /* ignore corrupt entry */ }
      }
      // Custom views: enumerate localStorage keys for this workspace. The view's key is what follows
      // the workspace's prefix — not what follows the second ':', since a root may hold one (C:\repo).
      const prefix = `${KEY_PREFIX}:${workspaceRoot}:`;
      for (let i = 0; i < localStorage.length; i++) {
        const lsKey = localStorage.key(i);
        if (!lsKey?.startsWith(`${prefix}custom:`)) continue;
        const viewKey = lsKey.slice(prefix.length);
        const stored = localStorage.getItem(lsKey);
        if (!stored) continue;
        try {
          const positions = JSON.parse(stored) as Record<string, SavedPosition>;
          if (!sidecar.views[viewKey]?.nodes && Object.keys(positions).length > 0) {
            sidecar.views[viewKey] = { ...sidecar.views[viewKey], nodes: positions };
            touched = true;
          }
        } catch { /* ignore */ }
      }
      localStorage.setItem(migratedKey(workspaceRoot), '1');
    }
    // The browser's copy of each section is now the committed one (B-012), written once here
    // rather than on every read.
    mirrorSections(workspaceRoot);
    // Edits made while it loaded were held back (see `hold`); they go out with the migration, as
    // what they changed in the file.
    if (touched || held.length > 0) void flushSidecar(workspaceRoot);
    // Tell the store/canvas to re-hydrate styles/notes/props from the now-loaded committed sidecar.
    window.dispatchEvent(new CustomEvent('stemma:sidecar-primed', { detail: { rootPath: workspaceRoot } }));
  } catch (error) {
    // A file the server will not read is said (`sidecarProblem`), and edits wait in this window
    // until it reads. Any other failure is a server not ready yet: drawn from the browser's copy,
    // and read on the next call.
    const refused = refusalOf(error);
    if (refused) setProblem({ rootPath: workspaceRoot, ...refused });
  }
}

/** Read the sidecar again after it could not be: the first read if it never was, else a re-read. */
export function retryLayoutSidecar(workspaceRoot: string): Promise<void> {
  return isSidecarPrimed(workspaceRoot) ? rereadLayoutSidecar(workspaceRoot) : primeLayoutSidecar(workspaceRoot);
}
