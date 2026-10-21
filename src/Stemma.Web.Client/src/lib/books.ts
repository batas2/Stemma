/**
 * Books (F-013, ADR-0022) — an ordered walk through the model for one audience.
 *
 * A book lives in the `books` section of `stemma.layout.json`, because it is presentation: deleting
 * one leaves the architecture exactly as true as it was. Each page names a view, the elements to
 * point at, how to frame them, and the words to say over them. It refers to the model by id and
 * copies nothing out of it, so a rename in code is a rename in the slides, and a deleted element is
 * a page that says it is broken rather than one that quietly shows something else.
 *
 * Pages are keyed by id with their order kept apart, in `order`. The canvas sends the smallest value
 * that changed (ADR-0021) and an array is one value: kept as a list, a narrative edit would re-send
 * every page. Keyed, it is one line of the diff.
 *
 * Everything here is pure. The readers accept whatever a person or an agent wrote by hand and make
 * the best book of it; the editors change the raw section in place, touching only the members the
 * edit is about, so a key Stemma does not know and a default somebody spelled out both survive.
 */

import type { ArchModel } from './types';

export type BookFrame = 'view' | 'focus';
export type BookOthers = 'dim' | 'hide';

/** One beat of a flow (F-020): a relationship lit in its turn, and what to say over it. */
export interface BookStep {
  link: string;
  note: string;
}

export interface BookPage {
  id: string;
  title: string;
  /** `moduleMap`, `dependencyGraph`, or the id of a view in `Views/`. */
  view: string;
  /** Markdown. */
  narrative: string;
  /** Element ids to point at; empty means the page is about the whole view. */
  focus: string[];
  frame: BookFrame;
  others: BookOthers;
  /** Relationships played one at a time before the next page (F-020); empty for most pages. */
  steps: BookStep[];
}

export interface Book {
  id: string;
  name: string;
  audience: string | null;
  pages: BookPage[];
}

/** The raw `books` section, as the sidecar holds it. */
export type BooksSection = Record<string, unknown>;

type Raw = Record<string, unknown>;

export type PagePatch = Partial<Pick<BookPage, 'title' | 'view' | 'narrative' | 'focus' | 'frame' | 'others' | 'steps'>>;

export interface PageProblem {
  kind: 'missing-view' | 'dangling-focus' | 'dangling-step';
  /** The focus ids that are not elements, or the step links that are not relationships. */
  ids?: string[];
}

const BUILTIN_VIEWS = new Set(['moduleMap', 'dependencyGraph', 'concerns']);

function isRecord(value: unknown): value is Raw {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
}

/**
 * How a page frames its view. A page with nothing to point at can only show the whole view; one
 * with a focus zooms to it unless it says `view`, which keeps the lit elements in their surroundings.
 */
export function resolveFrame(focus: string[], frame: unknown): BookFrame {
  if (focus.length === 0) return 'view';
  return frame === 'view' ? 'view' : 'focus';
}

/**
 * The order pages are shown in: the ones `order` names, then any it does not, in file order. A book
 * written by hand without an `order`, or one whose `order` a merge left behind, still presents.
 */
export function pageOrder(book: unknown): string[] {
  if (!isRecord(book)) return [];
  const pages = isRecord(book.pages) ? book.pages : {};
  const listed: string[] = [];
  for (const id of strings(book.order)) {
    if (Object.hasOwn(pages, id) && !listed.includes(id)) listed.push(id);
  }
  return [...listed, ...Object.keys(pages).filter((id) => !listed.includes(id))];
}

/** Steps as a person or an agent may write them: an id, or `{ link, note }`. Anything else is skipped. */
export function readSteps(value: unknown): BookStep[] {
  if (!Array.isArray(value)) return [];
  const out: BookStep[] = [];
  for (const v of value) {
    if (typeof v === 'string' && v) out.push({ link: v, note: '' });
    else if (isRecord(v) && typeof v.link === 'string' && v.link) out.push({ link: v.link, note: text(v.note) });
  }
  return out;
}

function readPage(id: string, raw: unknown): BookPage | null {
  // A page that is not an object is a hand edit gone wrong; `stemma validate` says so, and the
  // book presents without it rather than not at all.
  if (!isRecord(raw)) return null;
  const focus = strings(raw.focus);
  return {
    id,
    title: text(raw.title),
    view: text(raw.view),
    narrative: text(raw.narrative),
    focus,
    frame: resolveFrame(focus, raw.frame),
    others: raw.others === 'hide' ? 'hide' : 'dim',
    steps: readSteps(raw.steps),
  };
}

export function readBooks(section: unknown): Book[] {
  if (!isRecord(section)) return [];
  const books: Book[] = [];
  for (const [id, raw] of Object.entries(section)) {
    if (!isRecord(raw)) continue;
    const pages = isRecord(raw.pages) ? raw.pages : {};
    books.push({
      id,
      name: text(raw.name) || id,
      audience: text(raw.audience) || null,
      pages: pageOrder(raw).map((pid) => readPage(pid, pages[pid])).filter((p): p is BookPage => p !== null),
    });
  }
  return books;
}

// ---------------------------------------------------------------- edits

function bookIn(section: BooksSection, bookId: string): Raw | null {
  const book = section[bookId];
  return isRecord(book) ? book : null;
}

function pagesOf(book: Raw): Raw {
  if (!isRecord(book.pages)) book.pages = {};
  return book.pages as Raw;
}

export function addBook(section: BooksSection, id: string, name: string): void {
  section[id] = { name, pages: {} };
}

export function renameBook(section: BooksSection, bookId: string, name: string): void {
  const book = bookIn(section, bookId);
  if (book) book.name = name;
}

export function setBookAudience(section: BooksSection, bookId: string, audience: string | null): void {
  const book = bookIn(section, bookId);
  if (!book) return;
  if (audience && audience.trim()) book.audience = audience.trim();
  else delete book.audience;
}

export function removeBook(section: BooksSection, bookId: string): void {
  delete section[bookId];
}

/**
 * Add a page right after the page `after` (default: at the end). The `order` is written out in
 * full from then on. Places are named by page id, never by position: the list a person sees leaves
 * out a page a hand edit broke, and the file does not, so a position means different pages to each.
 */
export function addPage(
  section: BooksSection,
  bookId: string,
  page: { id: string; title: string; view: string; focus?: string[] },
  after?: string,
): void {
  const book = bookIn(section, bookId);
  if (!book) return;
  const order = pageOrder(book);
  const raw: Raw = { title: page.title, view: page.view };
  if (page.focus && page.focus.length > 0) raw.focus = [...page.focus];
  pagesOf(book)[page.id] = raw;
  const at = after === undefined ? -1 : order.indexOf(after);
  order.splice(at < 0 ? order.length : at + 1, 0, page.id);
  book.order = order;
}

/**
 * Change the fields `patch` names, and only those. A value equal to its default is removed rather
 * than written, so a page states only what it chose. `frame` is tidied only when the patch is about
 * focus or framing — an edit to the narrative must not also rewrite a default someone spelled out.
 */
export function updatePage(section: BooksSection, bookId: string, pageId: string, patch: PagePatch): void {
  const book = bookIn(section, bookId);
  if (!book) return;
  const raw = pagesOf(book)[pageId];
  if (!isRecord(raw)) return;

  if (patch.title !== undefined) raw.title = patch.title;
  if (patch.view !== undefined) raw.view = patch.view;
  if (patch.narrative !== undefined) {
    if (patch.narrative) raw.narrative = patch.narrative;
    else delete raw.narrative;
  }
  if (patch.others !== undefined) {
    if (patch.others === 'hide') raw.others = 'hide';
    else delete raw.others;
  }
  if (patch.focus !== undefined) {
    if (patch.focus.length > 0) raw.focus = [...patch.focus];
    else delete raw.focus;
  }
  if (patch.steps !== undefined) {
    // A step with nothing to say is written as its id alone, the shortest thing that says it. A step
    // someone wrote with keys of their own keeps them: the schema allows them, and an edit to a note
    // must not delete what it did not touch.
    const before = Array.isArray(raw.steps) ? (raw.steps as unknown[]) : [];
    const kept = (link: string): Raw | null => {
      const i = before.findIndex((b) => isRecord(b) && b.link === link && Object.keys(b).some((k) => k !== 'link' && k !== 'note'));
      return i >= 0 ? (before.splice(i, 1)[0] as Raw) : null;
    };
    if (patch.steps.length > 0) {
      raw.steps = patch.steps.map((st) => {
        const own = kept(st.link);
        if (own) {
          const out: Raw = { ...own, link: st.link };
          if (st.note.trim()) out.note = st.note; else delete out.note;
          return out;
        }
        return st.note.trim() ? { link: st.link, note: st.note } : st.link;
      });
    } else delete raw.steps;
  }
  if (patch.focus !== undefined || patch.frame !== undefined) {
    const focus = strings(raw.focus);
    const wanted = patch.frame ?? (raw.frame === 'view' ? 'view' : 'focus');
    // `view` is the only frame that differs from the default, and only when there is a focus.
    if (focus.length > 0 && wanted === 'view') raw.frame = 'view';
    else delete raw.frame;
  }
}

export function removePage(section: BooksSection, bookId: string, pageId: string): void {
  const book = bookIn(section, bookId);
  if (!book) return;
  delete pagesOf(book)[pageId];
  if (Array.isArray(book.order) && book.order.includes(pageId)) {
    book.order = book.order.filter((id) => id !== pageId);
  }
}

/** Move `pageId` to where `targetId` is, in presentation order; the pages between shift over. */
export function movePage(section: BooksSection, bookId: string, pageId: string, targetId: string): void {
  const book = bookIn(section, bookId);
  if (!book) return;
  const order = pageOrder(book);
  const from = order.indexOf(pageId);
  const to = order.indexOf(targetId);
  if (from < 0 || to < 0 || from === to) return;
  order.splice(from, 1);
  order.splice(to, 0, pageId);
  book.order = order;
}

/** A copy of a page, placed right after it — the usual way to make the next, closer step of a zoom. */
export function duplicatePage(section: BooksSection, bookId: string, pageId: string, newId: string): void {
  const book = bookIn(section, bookId);
  if (!book) return;
  const pages = pagesOf(book);
  if (!isRecord(pages[pageId])) return;
  const order = pageOrder(book);
  pages[newId] = structuredClone(pages[pageId]);
  order.splice(order.indexOf(pageId) + 1, 0, newId);
  book.order = order;
}

// ---------------------------------------------------------------- ids, views, checks

function newId(prefix: string, taken: Iterable<string>): string {
  const used = new Set(taken);
  for (;;) {
    const id = `${prefix}${Math.random().toString(36).slice(2, 8).padEnd(6, '0')}`;
    if (!used.has(id)) return id;
  }
}

export function newBookId(taken: Iterable<string>): string {
  return newId('book_', taken);
}

export function newPageId(taken: Iterable<string>): string {
  return newId('p_', taken);
}

/** The layout key the canvas draws a page's view under: a view from `Views/` is `custom:<id>`. */
export function viewKeyOf(view: string): string {
  return BUILTIN_VIEWS.has(view) ? view : `custom:${view}`;
}

/**
 * What is wrong with a page against the model as it is now: a view that no longer exists, or focus
 * ids that are no longer elements. `views` holds the view ids a page may name.
 */
export function pageProblems(page: BookPage, ctx: { views: Set<string>; elements: Set<string>; links?: Set<string> }): PageProblem[] {
  const problems: PageProblem[] = [];
  if (!ctx.views.has(page.view)) problems.push({ kind: 'missing-view' });
  const dangling = page.focus.filter((id) => !ctx.elements.has(id));
  if (dangling.length > 0) problems.push({ kind: 'dangling-focus', ids: dangling });
  if (ctx.links) {
    const gone = page.steps.map((st) => st.link).filter((id) => !ctx.links!.has(id));
    if (gone.length > 0) problems.push({ kind: 'dangling-step', ids: [...new Set(gone)] });
  }
  return problems;
}

/**
 * A narrative with its paragraphs joined back up. Narratives are written in editors and files that
 * wrap at a column, and a line break inside a paragraph is a property of the editor, not of the
 * text; shown as written, every wrapped line becomes its own paragraph. Blank lines and list items
 * keep their breaks.
 */
export function reflowNarrative(md: string): string {
  // A line that starts a block of its own: a list item, numbered or not, a heading, a quote, a fence.
  const starts = /^\s*(?:[-*+]\s+|\d+[.)]\s+|#{1,6}\s|>|```)/;
  const out: string[] = [];
  let fenced = false;
  for (const line of md.replace(/\r\n?/g, '\n').split('\n')) {
    const fence = /^\s*```/.test(line);
    const prev = out.length > 0 ? out[out.length - 1] : '';
    // A line of text right after another is the same paragraph, or the same list item, wrapped —
    // except inside a code fence, and except after a heading or a fence, which end where they end.
    const joins = !fenced && !fence && line.trim() !== '' && !starts.test(line)
      && prev.trim() !== '' && !/^\s*(?:#{1,6}\s|```)/.test(prev);
    if (joins) out[out.length - 1] = `${prev.trimEnd()} ${line.trim()}`;
    else out.push(line);
    if (fence) fenced = !fenced;
  }
  return out.join('\n');
}

/** One sentence for a page's problems, for a tooltip or the presenter's notice. */
export function describeProblems(problems: PageProblem[], page: BookPage): string {
  return problems.map((p) => p.kind === 'missing-view'
    ? `The view "${page.view}" no longer exists.`
    : p.kind === 'dangling-step'
      ? `${p.ids!.length === 1 ? 'A step plays a relationship that is' : `${p.ids!.length} steps play relationships that are`} no longer in the model (${p.ids!.join(', ')}).`
      : `${p.ids!.length === 1 ? 'An element it points at is' : `${p.ids!.length} elements it points at are`} no longer in the model (${p.ids!.join(', ')}).`,
  ).join(' ');
}

/** "①" … "⑳", then "21." — a step's number as it is drawn on its arrow. */
export function stepMark(n: number): string {
  return n >= 1 && n <= 20 ? String.fromCodePoint(0x2460 + n - 1) : `${n}.`;
}

/**
 * Where a page's flow has got to (F-020): `at` steps lit, the last of them the one being talked about.
 * Captured for the PDF, every step is lit and none is singled out — the handout shows the whole flow.
 */
export function stepsLit(page: BookPage, at: number, everything: boolean): { shown: BookStep[]; current: BookStep | null } {
  if (page.steps.length === 0) return { shown: [], current: null };
  if (everything) return { shown: page.steps, current: null };
  const n = Math.max(0, Math.min(at, page.steps.length));
  return { shown: page.steps.slice(0, n), current: n > 0 ? page.steps[n - 1] : null };
}

/** What a step is about, said in a line: its note, or the arrow it lights ("Canvas → Web host · open"). */
export function stepCaption(step: BookStep, arch: Pick<ArchModel, 'elements' | 'links'> | null): string {
  if (step.note.trim()) return step.note.trim();
  const link = arch?.links.find((l) => l.id === step.link);
  if (!link) return step.link;
  const name = (id: string) => arch?.elements.find((e) => e.id === id)?.name ?? id;
  const label = link.attributes.payload ?? link.attributes.label ?? link.attributes.kind ?? '';
  return `${name(link.fromId)} → ${name(link.toId)}${label ? ` · ${label}` : ''}`;
}

/** A page's steps as text, for a page of paper: "1. Canvas → Web host · open — what to say". */
export function stepsAsText(page: BookPage, arch: Pick<ArchModel, 'elements' | 'links'> | null): string {
  return page.steps.map((st, i) => {
    const arrow = stepCaption({ ...st, note: '' }, arch);
    return `${i + 1}. ${arrow}${st.note.trim() ? ` — ${st.note.trim()}` : ''}`;
  }).join('\n');
}
