import type { ArchLink, ArchLinkKind } from './types';

/**
 * What an edge is labelled with, and which attribute an edit writes back to.
 *
 * Each link kind keeps its meaning in a different attribute — a data flow in `payload`, a
 * dependency in `kind`, a relation in `label` — and three call sites had grown their own
 * `isDataFlow ? … : …` version of that mapping. Adding a third kind is exactly the change that
 * turns a two-way ternary into a silent wrong answer, so the mapping lives in one place.
 */
export const LINK_LABEL_FIELD: Record<ArchLinkKind, 'payload' | 'kind' | 'label'> = {
  dataFlow: 'payload',
  dependency: 'kind',
  relation: 'label',
};

/** The default a kind falls back to when its attribute is unset. A relation has none: an unlabelled
 *  arrow is a legitimate thing to draw, whereas an unlabelled dependency is just "uses". */
const LINK_LABEL_FALLBACK: Record<ArchLinkKind, string> = {
  dataFlow: '',
  dependency: 'uses',
  relation: '',
};

export function linkLabelField(kind: ArchLinkKind): 'payload' | 'kind' | 'label' {
  return LINK_LABEL_FIELD[kind] ?? 'kind';
}

/** The text drawn on the edge. */
export function linkLabel(link: Pick<ArchLink, 'kind' | 'attributes'>): string {
  const field = linkLabelField(link.kind);
  return link.attributes[field] ?? LINK_LABEL_FALLBACK[link.kind] ?? '';
}

/**
 * What the edge says on the canvas: its label, and for a data flow its technology in brackets —
 * C4's "places orders [HTTPS/JSON]" (ADR-0027). `linkLabel` stays the editable value: an inline edit
 * must never write the technology into the payload.
 */
export function linkCaption(link: Pick<ArchLink, 'kind' | 'attributes'>): string {
  const label = linkLabel(link);
  const tech = link.kind === 'dataFlow' ? link.attributes.technology : null;
  if (!tech) return label;
  return label ? `${label} [${tech}]` : `[${tech}]`;
}

/**
 * The caption of an implied relationship: what the relationships it stands for say, each once — two
 * in full, then a count, so a busy system boundary does not grow a paragraph on one arrow.
 */
export function impliedCaption(links: Pick<ArchLink, 'kind' | 'attributes'>[]): string {
  const said = [...new Set(links.map(linkCaption).filter(Boolean))];
  return said.length <= 2 ? said.join(' · ') : `${said.slice(0, 2).join(' · ')} +${said.length - 2}`;
}

/**
 * Whether the edge is drawn dashed by default.
 *
 * Line style rather than colour, so the distinction survives greyscale — a dependency is a claim
 * about coupling and reads as one; a flow and a plain relation are solid.
 */
export function linkIsDashedByDefault(kind: ArchLinkKind): boolean {
  return kind === 'dependency';
}

/** How the label field is named in a toast or an inspector row. */
export const LINK_FIELD_LABEL: Record<'payload' | 'kind' | 'label', string> = {
  payload: 'Payload',
  kind: 'Kind',
  label: 'Label',
};
