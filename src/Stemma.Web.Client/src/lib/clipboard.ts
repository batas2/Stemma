/**
 * Copy and paste (F-015) — what a copy holds, and the plan a paste carries out.
 *
 * A copy is taken of the model and the presentation as they are at the moment of copying, so a
 * paste after the originals were edited or deleted still makes what was copied. Pasting is planned
 * here, purely, and carried out by `paste.ts` as ordinary operations: every new element is an
 * `AddElement` and every look a sidecar entry, so nothing a paste writes is anything the canvas did
 * not already write one gesture at a time.
 *
 * Only relationships *between* copied elements are copied: one to an element left behind would be
 * a second arrow between two things that already have one, which nobody asked for.
 */

import type { ArchElementKind, ArchLinkKind, ArchModel, ArchTagInfo } from './types';
import type { NodeStyle } from './nodeStyles';
import type { EdgeStyle } from './edgeStyles';
import type { CustomProps } from './customProps';

export interface Point { x: number; y: number }

export interface ClipElement {
  id: string;
  name: string;
  kind: ArchElementKind;
  attributes: Record<string, string | null>;
  lifecycle: ArchTagInfo['lifecycle'];
  ownership: ArchTagInfo['ownership'];
  nodeStyle?: NodeStyle;
  note?: string;
  customProps?: CustomProps;
  /** Where it sat relative to the copy's top-left corner. */
  offset: Point;
}

export interface ClipLink {
  id: string;
  fromId: string;
  toId: string;
  kind: ArchLinkKind;
  attributes: Record<string, string | null>;
  edgeStyle?: EdgeStyle;
}

export interface Clip {
  /** The layout key of the view it was copied on, for cascading a paste back onto it. */
  viewKey: string;
  elements: ClipElement[];
  links: ClipLink[];
  /** The copy's top-left corner on that view, and its size. */
  origin: Point;
  size: { w: number; h: number };
}

export interface CopyContext {
  viewKey: string;
  /** Where each element is drawn on that view, and how big it is drawn. */
  boxes: Record<string, { x: number; y: number; w: number; h: number }>;
  nodeStyles: Record<string, NodeStyle>;
  edgeStyles: Record<string, EdgeStyle>;
  customProps: Record<string, CustomProps>;
  note: (id: string) => string;
}

const DEFAULT_SIZE = { w: 200, h: 92 };

/**
 * The elements a copy of `ids` takes. A bounded context takes the modules drawn inside its box —
 * selecting the box is selecting what is in it, the way copying a group copies its members.
 */
export function copiedIds(arch: ArchModel, ids: string[]): string[] {
  const out = new Set(ids.filter((id) => arch.elements.some((e) => e.id === id)));
  for (const e of arch.elements) {
    if (e.kind === 'module' && e.attributes.contextId && out.has(e.attributes.contextId)) {
      const ctx = arch.elements.find((x) => x.id === e.attributes.contextId);
      if (ctx?.kind === 'boundedContext') out.add(e.id);
    }
  }
  // Model order, so a paste declares them in the order the file already had them.
  return arch.elements.filter((e) => out.has(e.id)).map((e) => e.id);
}

export function buildClip(arch: ArchModel, ids: string[], ctx: CopyContext): Clip | null {
  const take = copiedIds(arch, ids);
  if (take.length === 0) return null;
  const set = new Set(take);
  const tags = new Map(arch.tags.map((t) => [t.targetId, t]));

  // Where the copy sits: the union of the boxes drawn. Elements not drawn on this view (copied from
  // the sidebar, say) are laid out in a row under it rather than piled on one spot.
  const drawn = take.filter((id) => ctx.boxes[id]);
  const left = drawn.length ? Math.min(...drawn.map((id) => ctx.boxes[id].x)) : 0;
  const top = drawn.length ? Math.min(...drawn.map((id) => ctx.boxes[id].y)) : 0;
  const right = drawn.length ? Math.max(...drawn.map((id) => ctx.boxes[id].x + ctx.boxes[id].w)) : 0;
  const bottom = drawn.length ? Math.max(...drawn.map((id) => ctx.boxes[id].y + ctx.boxes[id].h)) : 0;
  let spare = 0;

  const elements: ClipElement[] = take.map((id) => {
    const e = arch.elements.find((x) => x.id === id)!;
    const box = ctx.boxes[id];
    const offset = box
      ? { x: box.x - left, y: box.y - top }
      : { x: (spare++) * (DEFAULT_SIZE.w + 40), y: drawn.length ? bottom - top + 40 : 0 };
    const note = ctx.note(id);
    const props = ctx.customProps[id];
    // A copy is the same size as what it copies; only a pasted *look* leaves the size behind.
    const style = ctx.nodeStyles[id];
    return {
      id: e.id,
      name: e.name,
      kind: e.kind,
      attributes: { ...e.attributes },
      lifecycle: tags.get(id)?.lifecycle ?? null,
      ownership: tags.get(id)?.ownership ?? null,
      ...(style ? { nodeStyle: { ...style } } : {}),
      ...(note ? { note } : {}),
      ...(props && Object.keys(props).length ? { customProps: { ...props } } : {}),
      offset,
    };
  });

  const links: ClipLink[] = arch.links
    .filter((l) => set.has(l.fromId) && set.has(l.toId))
    .map((l) => ({
      id: l.id, fromId: l.fromId, toId: l.toId, kind: l.kind, attributes: { ...l.attributes },
      ...(ctx.edgeStyles[l.id] ? { edgeStyle: { ...ctx.edgeStyles[l.id] } } : {}),
    }));

  const width = drawn.length ? right - left : DEFAULT_SIZE.w;
  const height = drawn.length ? bottom - top : DEFAULT_SIZE.h;
  return {
    viewKey: ctx.viewKey,
    elements,
    links,
    origin: { x: left, y: top },
    size: { w: Math.max(width, spare * (DEFAULT_SIZE.w + 40)), h: spare > 0 ? height + 40 + DEFAULT_SIZE.h : height },
  };
}

/** The names, one per line: what a copy is as text, for pasting into a document or a chat. */
export function clipText(clip: Clip): string {
  return clip.elements.map((e) => e.name).join('\n');
}

/** "Name copy", then "Name copy 2", … — whichever is free. */
export function copyName(name: string, taken: Set<string>): string {
  const base = `${name} copy`;
  if (!taken.has(base)) return base;
  for (let n = 2; n < 1000; n++) {
    const candidate = `${base} ${n}`;
    if (!taken.has(candidate)) return candidate;
  }
  return `${base} ${Date.now()}`;
}

/** A reference a pasted element makes: to another pasted element, or to one already in the model. */
export type Ref = { copied: string } | { existing: string };

export interface PlannedElement {
  /** The id of the element it copies. */
  from: string;
  name: string;
  kind: ArchElementKind;
  context: Ref | null;
  system: Ref | null;
  about: Ref | null;
  containerKind: string | null;
  role: string | null;
  lifecycle: ClipElement['lifecycle'];
  ownership: ClipElement['ownership'];
  nodeStyle?: NodeStyle;
  note?: string;
  customProps?: CustomProps;
  position: Point;
}

export interface PlannedLink {
  from: string;
  kind: ArchLinkKind;
  source: string;
  target: string;
  payload: string | null;
  dependencyKind: string | null;
  direction: string | null;
  label: string | null;
  edgeStyle?: EdgeStyle;
}

export interface PastePlan {
  elements: PlannedElement[];
  links: PlannedLink[];
}

export interface PasteOptions {
  /** Where the copy's top-left corner lands. */
  at: Point;
  /**
   * The bounded context whose box holds a point on the target view, or null for none. Given, a module
   * pasted inside a box joins that context and one pasted outside every box is top level — the rule a
   * dropped module follows. Not given, a module keeps the context it had.
   */
  contextAt?: (p: Point) => string | null;
  /** How big each box is drawn, for finding its centre; the default size otherwise. */
  sizeOf?: (id: string) => { w: number; h: number };
}

/** The order to declare them in: containers before what goes in them, so a reference has somewhere to point. */
function declarationRank(kind: ArchElementKind): number {
  return kind === 'boundedContext' || kind === 'softwareSystem' ? 0 : 1;
}

export function planPaste(clip: Clip, arch: ArchModel, opts: PasteOptions): PastePlan {
  const copied = new Set(clip.elements.map((e) => e.id));
  const existing = new Set(arch.elements.map((e) => e.id));
  const contexts = new Set(arch.elements.filter((e) => e.kind === 'boundedContext').map((e) => e.id));
  const taken = new Set(arch.elements.map((e) => e.name));

  const ref = (id: string | null | undefined): Ref | null => {
    if (!id) return null;
    if (copied.has(id)) return { copied: id };
    return existing.has(id) ? { existing: id } : null;
  };

  const ordered = [...clip.elements].sort((a, b) => declarationRank(a.kind) - declarationRank(b.kind));
  const elements = ordered.map((e): PlannedElement => {
    const position = { x: opts.at.x + e.offset.x, y: opts.at.y + e.offset.y };
    let context = ref(e.attributes.contextId);
    if (e.kind === 'module' && opts.contextAt && !(context && 'copied' in context)) {
      // Its context did not come with it: where it lands decides, as for a dropped module.
      const size = opts.sizeOf?.(e.id)
        ?? (e.nodeStyle?.width && e.nodeStyle?.height ? { w: e.nodeStyle.width, h: e.nodeStyle.height } : DEFAULT_SIZE);
      const under = opts.contextAt({ x: position.x + size.w / 2, y: position.y + size.h / 2 });
      context = under && contexts.has(under) ? { existing: under } : null;
    }
    const name = copyName(e.name, taken);
    taken.add(name);
    return {
      from: e.id,
      name,
      kind: e.kind,
      context: e.kind === 'module' || e.kind === 'capability' ? context : null,
      system: e.kind === 'container' ? ref(e.attributes.systemId) : null,
      about: e.kind === 'risk' || e.kind === 'question' || e.kind === 'assumption' ? ref(e.attributes.aboutId) : null,
      containerKind: e.kind === 'container' ? e.attributes.kind ?? null : null,
      role: e.kind === 'person' ? e.attributes.role ?? null : null,
      lifecycle: e.lifecycle,
      ownership: e.ownership,
      ...(e.nodeStyle ? { nodeStyle: e.nodeStyle } : {}),
      ...(e.note ? { note: e.note } : {}),
      ...(e.customProps ? { customProps: e.customProps } : {}),
      position,
    };
  });

  const links = clip.links.map((l): PlannedLink => ({
    from: l.id,
    kind: l.kind,
    source: l.fromId,
    target: l.toId,
    payload: l.kind === 'dataFlow' ? l.attributes.payload ?? null : null,
    dependencyKind: l.kind === 'dependency' ? l.attributes.kind ?? null : null,
    direction: l.kind === 'dataFlow' ? l.attributes.direction ?? null : null,
    label: l.kind === 'relation' ? l.attributes.label ?? null : null,
    ...(l.edgeStyle ? { edgeStyle: l.edgeStyle } : {}),
  }));

  return { elements, links };
}

/**
 * Where a paste lands. Back onto the view it came from while the originals are on screen, each paste
 * a step further down and right of the last, so copies never hide under each other; anywhere else,
 * in the middle of what is on screen.
 */
export function pasteOrigin(clip: Clip, opts: {
  viewKey: string;
  pasteCount: number;
  originalsOnScreen: boolean;
  viewportCentre: Point;
}): Point {
  if (clip.viewKey === opts.viewKey && opts.originalsOnScreen) {
    const step = CASCADE * (opts.pasteCount + 1);
    return { x: clip.origin.x + step, y: clip.origin.y + step };
  }
  return { x: opts.viewportCentre.x - clip.size.w / 2, y: opts.viewportCentre.y - clip.size.h / 2 };
}

export const CASCADE = 32;

// ------------------------------------------------------------------ the copy held between gestures

let held: Clip | null = null;
let pasted = 0;

export function holdClip(clip: Clip): void { held = clip; pasted = 0; }
export function heldClip(): Clip | null { return held; }
/** How many times the held copy has been pasted, counted up by each paste. */
export function nextPasteCount(): number { return pasted++; }

// ------------------------------------------------------------------ a copied look (⌥⌘C / ⌥⌘V)

export type HeldStyle = { target: 'node'; style: NodeStyle } | { target: 'edge'; style: EdgeStyle };
let heldStyle: HeldStyle | null = null;

/** A box's look without its size: a look pasted onto a box of another size keeps that size. */
export function lookOf(style: NodeStyle): NodeStyle {
  const { width: _w, height: _h, ...look } = style;
  return look as NodeStyle;
}

const styleListeners = new Set<() => void>();

export function holdStyle(s: HeldStyle): void { heldStyle = s; styleListeners.forEach((l) => l()); }

/** For a control that is enabled only once a look has been copied. */
export function subscribeHeldStyle(cb: () => void): () => void {
  styleListeners.add(cb);
  return () => { styleListeners.delete(cb); };
}
export function heldStyleFor(target: 'node' | 'edge'): HeldStyle | null {
  return heldStyle?.target === target ? heldStyle : null;
}

/** The look pasted onto a box: the copied one, keeping the box's own size. */
export function pasteLook(onto: NodeStyle | undefined, look: NodeStyle): NodeStyle {
  return { ...lookOf(look), ...(onto?.width ? { width: onto.width } : {}), ...(onto?.height ? { height: onto.height } : {}) };
}
