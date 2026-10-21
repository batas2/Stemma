/**
 * What changed between two versions of the model (F-017), matched by id — the ids are stable, so a
 * rename is a change to one element, not a removal and an addition.
 *
 * Pure: the canvas recomputes it on every edit, which is what makes comparing with the last commit a
 * running answer to "what have I changed". Each change says, in words, what changed about it.
 */

import type { ArchElement, ArchLink, ArchModel, ArchTagInfo } from './types';

export type ChangeKind = 'added' | 'removed' | 'changed';

export interface ElementChange {
  id: string;
  change: ChangeKind;
  /** The element as it is now, or as it was for a removal. */
  element: ArchElement;
  /** What changed about it, one sentence fragment each; empty for an addition or a removal. */
  details: string[];
}

export interface LinkChange {
  id: string;
  change: ChangeKind;
  link: ArchLink;
  details: string[];
}

export interface ModelDiff {
  elements: ElementChange[];
  links: LinkChange[];
  /** By id, for the canvas to mark cards and lines. */
  elementChange: Map<string, ChangeKind>;
  linkChange: Map<string, ChangeKind>;
  counts: { added: number; removed: number; changed: number; total: number };
}

const EMPTY: ArchModel = { filePath: '', elements: [], links: [], tags: [] };

const KIND_LABEL: Record<string, string> = {
  module: 'Module', boundedContext: 'Bounded Context', softwareSystem: 'Software System', container: 'Container',
  person: 'Person', useCase: 'Use Case', capability: 'Capability', question: 'Question', assumption: 'Assumption',
  risk: 'Risk', concept: 'Concept',
};

/** An element kind in words: "Software System". */
export function kindLabel(kind: string): string {
  return KIND_LABEL[kind] ?? kind;
}

function quoted(v: string | null | undefined): string {
  return v ? `“${v}”` : 'none';
}

function tagsOf(model: ArchModel): Map<string, ArchTagInfo> {
  return new Map(model.tags.map((t) => [t.targetId, t]));
}

/** "X → Y", naming referenced elements by name where the model they come from has them. */
function moved(label: string, from: string | null | undefined, to: string | null | undefined, nameBefore: (id: string) => string, nameAfter: (id: string) => string): string {
  if (!from) return `${label} ${nameAfter(to!)}`;
  if (!to) return `No longer in ${nameBefore(from)}`;
  return `${label} ${nameAfter(to)} (was ${nameBefore(from)})`;
}

function tagDetails(before: ArchTagInfo | undefined, after: ArchTagInfo | undefined): string[] {
  const out: string[] = [];
  const pair = (label: string, a: string | null | undefined, b: string | null | undefined) => {
    if ((a ?? null) !== (b ?? null)) out.push(`${label} ${a ?? 'none'} → ${b ?? 'none'}`);
  };
  pair('Status', before?.lifecycle?.status, after?.lifecycle?.status);
  pair('Phase', before?.lifecycle?.phase, after?.lifecycle?.phase);
  pair('Squad', before?.ownership?.squad, after?.ownership?.squad);
  pair('Domain', before?.ownership?.domain, after?.ownership?.domain);
  return out;
}

export function diffModels(beforeModel: ArchModel | null, after: ArchModel): ModelDiff {
  const before = beforeModel ?? EMPTY;
  const beforeById = new Map(before.elements.map((e) => [e.id, e]));
  const afterById = new Map(after.elements.map((e) => [e.id, e]));
  const tagsBefore = tagsOf(before);
  const tagsAfter = tagsOf(after);
  const nameBefore = (id: string) => quoted(beforeById.get(id)?.name ?? id);
  const nameAfter = (id: string) => quoted(afterById.get(id)?.name ?? id);

  const elements: ElementChange[] = [];
  for (const e of after.elements) {
    const was = beforeById.get(e.id);
    if (!was) { elements.push({ id: e.id, change: 'added', element: e, details: [] }); continue; }
    const details: string[] = [];
    if (was.name !== e.name) details.push(`Renamed from ${quoted(was.name)}`);
    if (was.kind !== e.kind) details.push(`Now a ${KIND_LABEL[e.kind] ?? e.kind} (was a ${KIND_LABEL[was.kind] ?? was.kind})`);
    if ((was.attributes.contextId ?? null) !== (e.attributes.contextId ?? null)) {
      details.push(moved('Moved to', was.attributes.contextId, e.attributes.contextId, nameBefore, nameAfter));
    }
    if ((was.attributes.systemId ?? null) !== (e.attributes.systemId ?? null)) {
      details.push(moved('Now part of', was.attributes.systemId, e.attributes.systemId, nameBefore, nameAfter));
    }
    if ((was.attributes.aboutId ?? null) !== (e.attributes.aboutId ?? null)) {
      details.push(moved('Now about', was.attributes.aboutId, e.attributes.aboutId, nameBefore, nameAfter));
    }
    for (const key of ['kind', 'role'] as const) {
      const a = was.attributes[key] ?? null, b = e.attributes[key] ?? null;
      if (a !== b) details.push(`${key === 'kind' ? 'Container kind' : 'Role'} ${a ?? 'none'} → ${b ?? 'none'}`);
    }
    details.push(...tagDetails(tagsBefore.get(e.id), tagsAfter.get(e.id)));
    if (details.length > 0) elements.push({ id: e.id, change: 'changed', element: e, details });
  }
  for (const e of before.elements) {
    if (!afterById.has(e.id)) elements.push({ id: e.id, change: 'removed', element: e, details: [] });
  }

  const linksBefore = new Map(before.links.map((l) => [l.id, l]));
  const linksAfter = new Map(after.links.map((l) => [l.id, l]));
  const links: LinkChange[] = [];
  for (const l of after.links) {
    const was = linksBefore.get(l.id);
    if (!was) { links.push({ id: l.id, change: 'added', link: l, details: [] }); continue; }
    const details: string[] = [];
    if (was.fromId !== l.fromId) details.push(`Now from ${nameAfter(l.fromId)} (was ${nameBefore(was.fromId)})`);
    if (was.toId !== l.toId) details.push(`Now to ${nameAfter(l.toId)} (was ${nameBefore(was.toId)})`);
    for (const key of ['payload', 'kind', 'direction', 'label']) {
      const a = was.attributes[key] ?? null, b = l.attributes[key] ?? null;
      if (a !== b) details.push(`${key[0].toUpperCase()}${key.slice(1)} ${quoted(a)} → ${quoted(b)}`);
    }
    details.push(...tagDetails(tagsBefore.get(l.id), tagsAfter.get(l.id)));
    if (details.length > 0) links.push({ id: l.id, change: 'changed', link: l, details });
  }
  for (const l of before.links) {
    if (!linksAfter.has(l.id)) links.push({ id: l.id, change: 'removed', link: l, details: [] });
  }

  const count = (kind: ChangeKind) => elements.filter((c) => c.change === kind).length + links.filter((c) => c.change === kind).length;
  const counts = { added: count('added'), removed: count('removed'), changed: count('changed'), total: elements.length + links.length };
  return {
    elements,
    links,
    elementChange: new Map(elements.map((c) => [c.id, c.change])),
    linkChange: new Map(links.map((c) => [c.id, c.change])),
    counts,
  };
}

/** One line for a count of changes: "3 added · 1 removed · 2 changed", or "No changes". */
export function describeCounts(c: ModelDiff['counts']): string {
  if (c.total === 0) return 'No changes';
  return [
    c.added ? `${c.added} added` : null,
    c.removed ? `${c.removed} removed` : null,
    c.changed ? `${c.changed} changed` : null,
  ].filter(Boolean).join(' · ');
}

/** A link in words: "Authorise → Settle · Authorised". */
export function describeLink(l: ArchLink, names: (id: string) => string): string {
  const label = l.attributes.payload ?? l.attributes.label ?? l.attributes.kind ?? '';
  return `${names(l.fromId)} → ${names(l.toId)}${label ? ` · ${label}` : ''}`;
}
