/**
 * A view's header (F-014, ADR-0023): its title, the one sentence it should leave in the room, how to
 * read it, and what its colours mean.
 *
 * Pure — reading what the sidecar holds, and computing the legend from what a view draws — so the
 * canvas, the presenter and the report share one set of rules. Lives under `views.<key>.header`.
 */

import type { ArchElement, ArchLink, ArchLinkKind, ArchTagInfo } from './types';

export type LegendLineStyle = 'solid' | 'dashed' | 'dotted';

export interface LegendSwatch { fill?: string; border?: string; style?: LegendLineStyle }
export interface LegendLine { color?: string; style?: LegendLineStyle }

/** One legend entry as written in the sidecar. */
export type LegendEntrySpec =
  | { status: string; label?: string }
  | { swatch: LegendSwatch; label: string }
  | { line: LegendLine; label: string };

export interface ViewHeaderSpec {
  /** Shown instead of the view's name. */
  title?: string;
  /** The one sentence the view should leave in the room. */
  message?: string;
  /** Markdown: what the view shows and how to read it. */
  context?: string;
  /** Absent: computed from what the view draws. Empty: no legend. */
  legend?: LegendEntrySpec[];
}

export type HeaderField = 'title' | 'message' | 'context';

/** A legend entry ready to draw. A null colour means the theme's default. */
export type LegendItem =
  | { kind: 'swatch'; label: string; fill: string | null; border: string | null; style: LegendLineStyle }
  | { kind: 'line'; label: string; color: string | null; style: LegendLineStyle };

/** The parts of a node style and an edge style a legend reads. */
export interface DrawnNodeStyle { fillColor?: string; borderColor?: string; borderStyle?: string }
export interface DrawnEdgeStyle { color?: string; lineStyle?: string }

/** What a view draws, as the legend needs it. */
export interface DrawnView {
  elements: ArchElement[];
  links: ArchLink[];
  tags: ArchTagInfo[];
  nodeStyles: Record<string, DrawnNodeStyle | undefined>;
  edgeStyles: Record<string, DrawnEdgeStyle | undefined>;
}

const LINE_STYLES = new Set<LegendLineStyle>(['solid', 'dashed', 'dotted']);

function text(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() !== '' ? v : undefined;
}

function lineStyle(v: unknown): LegendLineStyle | undefined {
  return typeof v === 'string' && LINE_STYLES.has(v as LegendLineStyle) ? (v as LegendLineStyle) : undefined;
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function colours<T extends string>(raw: Record<string, unknown>, keys: T[]): Partial<Record<T, string>> {
  const out: Partial<Record<T, string>> = {};
  for (const k of keys) { const c = text(raw[k]); if (c) out[k] = c; }
  return out;
}

/** One entry as written, or null when it is none of the three shapes an entry can take. */
export function readLegendEntry(raw: unknown): LegendEntrySpec | null {
  if (!isObject(raw)) return null;
  const label = text(raw.label);
  const status = text(raw.status);
  if (status) return label ? { status, label } : { status };
  if (!label) return null;
  if (isObject(raw.swatch)) {
    const style = lineStyle(raw.swatch.style);
    return { swatch: { ...colours(raw.swatch, ['fill', 'border']), ...(style ? { style } : {}) }, label };
  }
  if (isObject(raw.line)) {
    const style = lineStyle(raw.line.style);
    return { line: { ...colours(raw.line, ['color']), ...(style ? { style } : {}) }, label };
  }
  return null;
}

/**
 * A header as the sidecar holds it, or null when there is none. Tolerant, as everything read from a
 * hand-editable file is: a field of the wrong type is ignored rather than failing the view, and
 * `stemma validate` names it.
 */
export function readViewHeader(raw: unknown): ViewHeaderSpec | null {
  if (!isObject(raw)) return null;
  const out: ViewHeaderSpec = {};
  for (const f of ['title', 'message', 'context'] as const) {
    const v = text(raw[f]);
    if (v) out[f] = v;
  }
  if (Array.isArray(raw.legend)) {
    out.legend = raw.legend.map(readLegendEntry).filter((e): e is LegendEntrySpec => e !== null);
  }
  return out;
}

/** Every view's header, keyed by view key (`moduleMap`, `dependencyGraph`, `custom:<id>`). */
export function readViewHeaders(views: Record<string, unknown> | undefined): Record<string, ViewHeaderSpec> {
  const out: Record<string, ViewHeaderSpec> = {};
  for (const [key, view] of Object.entries(views ?? {})) {
    const header = isObject(view) ? readViewHeader(view.header) : null;
    if (header) out[key] = header;
  }
  return out;
}

/** The title a header shows: its own, or the view's name. */
export function headerTitle(header: ViewHeaderSpec, viewName: string): string {
  return header.title ?? viewName;
}

const LINK_LABEL: Record<ArchLinkKind, string> = {
  dataFlow: 'data flow',
  dependency: 'dependency',
  relation: 'relation',
};

function mostCommon<T>(values: T[], key: (v: T) => string): T | undefined {
  const counts = new Map<string, { value: T; n: number }>();
  for (const v of values) {
    const k = key(v);
    const c = counts.get(k);
    if (c) c.n++; else counts.set(k, { value: v, n: 1 });
  }
  let best: { value: T; n: number } | undefined;
  for (const c of counts.values()) if (!best || c.n > best.n) best = c;
  return best?.value;
}

/**
 * How the built-in statuses colour a card that has no style of its own (ArchNodeView). The fills are
 * translucent, as the cards' are, so a swatch matches its cards on a light canvas and a dark one.
 */
const BUILT_IN_STATUS: Record<string, { fill: string; border: string; style: LegendLineStyle }> = {
  target: { fill: 'rgba(99,102,241,0.10)', border: '#6366f1', style: 'solid' },
  'to-be-created': { fill: 'rgba(245,158,11,0.08)', border: '#f59e0b', style: 'dashed' },
  'to-adapt': { fill: 'rgba(245,158,11,0.06)', border: '#f59e0b', style: 'solid' },
  deprecated: { fill: 'rgba(161,161,170,0.15)', border: '#d4d4d8', style: 'solid' },
  proposed: { fill: 'rgba(14,165,233,0.08)', border: '#0ea5e9', style: 'dotted' },
};

function statusOf(tags: Map<string, ArchTagInfo>, id: string): string | null {
  return tags.get(id)?.lifecycle?.status ?? null;
}

/** The swatch for a status: drawn the way most of the view's cards with that status are drawn. */
function statusSwatch(status: string, drawn: DrawnView, tags: Map<string, ArchTagInfo>): Omit<Extract<LegendItem, { kind: 'swatch' }>, 'label' | 'kind'> {
  const styles = drawn.elements
    .filter((e) => statusOf(tags, e.id) === status)
    .map((e) => drawn.nodeStyles[e.id] ?? {});
  // Property by property, as the card does: whatever its own style leaves unset is the status's look.
  const common = mostCommon(styles, (s) => `${s.fillColor ?? ''}|${s.borderColor ?? ''}|${s.borderStyle ?? ''}`) ?? {};
  const builtIn = BUILT_IN_STATUS[status];
  return {
    fill: common.fillColor ?? builtIn?.fill ?? null,
    border: common.borderColor ?? builtIn?.border ?? null,
    style: lineStyle(common.borderStyle) ?? builtIn?.style ?? 'solid',
  };
}

function linkLine(l: ArchLink, edgeStyles: DrawnView['edgeStyles']): { color: string | null; style: LegendLineStyle } {
  const s = edgeStyles[l.id];
  // As the canvas draws it: a solid line style is the default, and a dependency is dashed by default.
  const own = lineStyle(s?.lineStyle);
  const style: LegendLineStyle = own && own !== 'solid' ? own : l.kind === 'dependency' ? 'dashed' : 'solid';
  return { color: s?.color ?? null, style };
}

/**
 * The legend a header draws. Written entries win; an entry that names a status takes its swatch from
 * the view, so restyling the cards restyles the key. Without written entries the legend is computed:
 * each status the view's elements carry, in the order they first appear, then each kind of link.
 */
export function legendItems(header: ViewHeaderSpec, drawn: DrawnView): LegendItem[] {
  const tags = new Map(drawn.tags.map((t) => [t.targetId, t]));
  if (header.legend) {
    return header.legend.map((entry): LegendItem => {
      if ('status' in entry) return { kind: 'swatch', label: entry.label ?? entry.status, ...statusSwatch(entry.status, drawn, tags) };
      if ('swatch' in entry) {
        return { kind: 'swatch', label: entry.label, fill: entry.swatch.fill ?? null, border: entry.swatch.border ?? null, style: entry.swatch.style ?? 'solid' };
      }
      return { kind: 'line', label: entry.label, color: entry.line.color ?? null, style: entry.line.style ?? 'solid' };
    });
  }

  const items: LegendItem[] = [];
  const statuses: string[] = [];
  for (const e of drawn.elements) {
    const s = statusOf(tags, e.id);
    if (s && !statuses.includes(s)) statuses.push(s);
  }
  for (const s of statuses) items.push({ kind: 'swatch', label: s, ...statusSwatch(s, drawn, tags) });

  const kinds: ArchLinkKind[] = [];
  for (const l of drawn.links) if (!kinds.includes(l.kind)) kinds.push(l.kind);
  for (const k of kinds) {
    const lines = drawn.links.filter((l) => l.kind === k).map((l) => linkLine(l, drawn.edgeStyles));
    const line = mostCommon(lines, (x) => `${x.color ?? ''}|${x.style}`)!;
    items.push({ kind: 'line', label: LINK_LABEL[k], ...line });
  }
  return items;
}

/** Legend entries naming a status that no element in the view carries — for `validate` and the editor. */
export function unknownLegendStatuses(header: ViewHeaderSpec, drawn: DrawnView): string[] {
  const carried = new Set(drawn.tags.filter((t) => drawn.elements.some((e) => e.id === t.targetId)).map((t) => t.lifecycle?.status));
  return (header.legend ?? []).flatMap((e) => ('status' in e && !carried.has(e.status) ? [e.status] : []));
}
