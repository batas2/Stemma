/**
 * Find on this view (F-018): which cards a query matches, the facets worth offering as one-tap
 * filters, and what stays lit.
 *
 * A query is words, all of which must match. A plain word matches anything a card says about itself —
 * its name, id, kind, the context or system it is in, its owner, its status, its notes and custom
 * properties. `key:value` narrows a word to one field (`status:target`, `squad:core`, `kind:module`,
 * `in:payments`, `tag:pci`), `#pci` is `tag:pci`, and "quoted words" are one word. Case is ignored.
 *
 * Pure, so the rules test without a canvas.
 */

import type { ArchElement, ArchTagInfo } from './types';
import type { CustomProps } from './customProps';

export type Field = 'status' | 'phase' | 'squad' | 'domain' | 'kind' | 'in' | 'tag';

export interface Token {
  field: Field | null;
  value: string;
}

const FIELDS: Record<string, Field> = {
  status: 'status', phase: 'phase', squad: 'squad', owner: 'squad', team: 'squad', domain: 'domain',
  kind: 'kind', type: 'kind', in: 'in', context: 'in', system: 'in', tag: 'tag',
};

const KIND_WORDS: Record<string, string> = {
  module: 'module', boundedContext: 'bounded context', softwareSystem: 'software system', container: 'container',
  person: 'person', useCase: 'use case', capability: 'capability', question: 'question', assumption: 'assumption',
  risk: 'risk', concept: 'concept',
};

export function parseQuery(query: string): Token[] {
  const out: Token[] = [];
  const re = /(?:(\w+):)?"([^"]*)"|(\S+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(query)) !== null) {
    if (m[2] !== undefined) {
      const field = m[1] ? FIELDS[m[1].toLowerCase()] ?? null : null;
      if (m[2].trim()) out.push({ field, value: m[2].trim().toLowerCase() });
      continue;
    }
    const word = m[3];
    if (word.startsWith('#') && word.length > 1) { out.push({ field: 'tag', value: word.slice(1).toLowerCase() }); continue; }
    const colon = word.indexOf(':');
    const field = colon > 0 ? FIELDS[word.slice(0, colon).toLowerCase()] : undefined;
    if (field && colon < word.length - 1) out.push({ field, value: word.slice(colon + 1).toLowerCase() });
    else out.push({ field: null, value: word.toLowerCase() });
  }
  return out;
}

export interface CardFacts {
  element: ArchElement;
  tag?: ArchTagInfo;
  /** The name of the context or system it sits in. */
  place?: string | null;
  note?: string;
  props?: CustomProps;
}

function fieldValues(f: CardFacts, field: Field): string[] {
  switch (field) {
    case 'status': return [f.tag?.lifecycle?.status ?? ''];
    case 'phase': return [f.tag?.lifecycle?.phase ?? ''];
    case 'squad': return [f.tag?.ownership?.squad ?? ''];
    case 'domain': return [f.tag?.ownership?.domain ?? ''];
    case 'kind': return [f.element.kind, KIND_WORDS[f.element.kind] ?? ''];
    case 'in': return [f.place ?? ''];
    case 'tag': return Object.keys(f.props ?? {});
  }
}

function allValues(f: CardFacts): string[] {
  return [
    f.element.name, f.element.id,
    ...(['status', 'phase', 'squad', 'domain', 'kind', 'in'] as Field[]).flatMap((k) => fieldValues(f, k)),
    f.note ?? '',
    ...Object.entries(f.props ?? {}).flatMap(([k, v]) => [k, v]),
  ];
}

export function matches(f: CardFacts, tokens: Token[]): boolean {
  if (tokens.length === 0) return false;
  return tokens.every((t) => {
    const values = t.field ? fieldValues(f, t.field) : allValues(f);
    return values.some((v) => v.toLowerCase().includes(t.value));
  });
}

export interface Facet {
  group: 'Status' | 'Squad' | 'Kind';
  label: string;
  /** What tapping it adds to the query. */
  token: string;
  count: number;
}

function quote(v: string): string {
  return /\s/.test(v) ? `"${v}"` : v;
}

/** The statuses, squads and kinds the cards on this view carry, most common first — one tap each. */
export function facets(cards: CardFacts[]): Facet[] {
  const count = (group: Facet['group'], field: string, values: (string | null | undefined)[], label = (v: string) => v) => {
    const by = new Map<string, number>();
    for (const v of values) if (v) by.set(v, (by.get(v) ?? 0) + 1);
    return [...by.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([v, n]): Facet => ({ group, label: label(v), token: `${field}:${quote(field === 'kind' ? v : v.toLowerCase())}`, count: n }));
  };
  return [
    ...count('Status', 'status', cards.map((c) => c.tag?.lifecycle?.status)),
    ...count('Squad', 'squad', cards.map((c) => c.tag?.ownership?.squad)),
    ...count('Kind', 'kind', cards.map((c) => c.element.kind), (k) => KIND_WORDS[k] ?? k),
  ];
}

/** A query with `token` added, or taken out when it is there already — what tapping a facet does. */
export function toggleToken(query: string, token: string): string {
  const words = query.trim() ? query.trim().split(/\s+(?=(?:[^"]*"[^"]*")*[^"]*$)/) : [];
  const at = words.findIndex((w) => w.toLowerCase() === token.toLowerCase());
  if (at >= 0) words.splice(at, 1);
  else words.push(token);
  return words.join(' ');
}

/** What stays lit: the matches, and the bounded contexts they sit in, so a box does not fade round its card. */
export function spotlightLighting(matched: string[], elements: ArchElement[]): Set<string> {
  const lit = new Set(matched);
  const byId = new Map(elements.map((e) => [e.id, e]));
  for (const id of matched) {
    const ctx = byId.get(id)?.attributes.contextId;
    if (ctx) lit.add(ctx);
  }
  return lit;
}
