import type { ArchElementKind, ArchLinkKind } from './types';

/**
 * Starter models, as scripts of operations.
 *
 * A template is deliberately **not** a file format and **not** a stored artefact. It is a list of
 * the same `AddElement` / `AddLink` operations a person would perform by hand, applied in order —
 * so a templated model is indistinguishable from a hand-built one, round-trips through the same
 * rewrites, and needs no second store to describe it. The moment a template becomes a document,
 * something has to migrate it.
 *
 * The three here mirror the shapes the sample workspaces already use, so they stay honest: a C4
 * system with its containers, DDD contexts with capabilities, and a flow between systems. Each
 * stays at or under seven boxes, which is the rule every workspace's own brief teaches.
 */

export interface TemplateElement {
  /** Local handle. Links and parents refer to elements by this, never by a guessed id. */
  ref: string;
  kind: ArchElementKind;
  name: string;
  /** Ref of the bounded context or software system this belongs inside. */
  parent?: string;
  containerKind?: string;
  role?: string;
  x: number;
  y: number;
}

export interface TemplateLink {
  from: string;
  to: string;
  kind: ArchLinkKind;
  payload?: string;
  dependencyKind?: string;
}

export interface WorkspaceTemplate {
  id: string;
  name: string;
  /** One line, shown in the picker. What you get, not what it is called. */
  summary: string;
  elements: TemplateElement[];
  links: TemplateLink[];
}

const COL = 280;
const ROW = 170;

export const TEMPLATES: WorkspaceTemplate[] = [
  {
    id: 'c4-system',
    name: 'A system and its containers',
    summary: 'C4-style: one system, the pieces it deploys, and who uses it.',
    elements: [
      { ref: 'user', kind: 'person', name: 'Customer', role: 'external', x: 0, y: ROW },
      { ref: 'sys', kind: 'softwareSystem', name: 'Booking Platform', x: COL, y: 0 },
      { ref: 'web', kind: 'container', name: 'Web App', parent: 'sys', containerKind: 'spa', x: COL, y: ROW },
      { ref: 'api', kind: 'container', name: 'Booking API', parent: 'sys', containerKind: 'service', x: COL * 2, y: ROW },
      { ref: 'db', kind: 'container', name: 'Booking Store', parent: 'sys', containerKind: 'db', x: COL * 3, y: ROW },
    ],
    links: [
      { from: 'user', to: 'web', kind: 'dataFlow', payload: 'Booking request' },
      { from: 'web', to: 'api', kind: 'dataFlow', payload: 'Booking request' },
      { from: 'api', to: 'db', kind: 'dataFlow', payload: 'Booking' },
    ],
  },
  {
    id: 'ddd-contexts',
    name: 'Bounded contexts and capabilities',
    summary: 'DDD-style: two boundaries, what each is responsible for, and the dependency between them.',
    elements: [
      { ref: 'ordering', kind: 'boundedContext', name: 'Ordering', x: 0, y: 0 },
      { ref: 'place', kind: 'capability', name: 'Place an order', parent: 'ordering', x: 0, y: ROW },
      { ref: 'price', kind: 'capability', name: 'Price a basket', parent: 'ordering', x: 0, y: ROW * 2 },
      { ref: 'fulfilment', kind: 'boundedContext', name: 'Fulfilment', x: COL * 2, y: 0 },
      { ref: 'ship', kind: 'capability', name: 'Ship an order', parent: 'fulfilment', x: COL * 2, y: ROW },
      { ref: 'track', kind: 'capability', name: 'Track a delivery', parent: 'fulfilment', x: COL * 2, y: ROW * 2 },
    ],
    links: [
      { from: 'fulfilment', to: 'ordering', kind: 'dependency', dependencyKind: 'uses' },
    ],
  },
  {
    id: 'data-flow',
    name: 'A flow between systems',
    summary: 'Where the data comes from, what changes it, and where it lands.',
    elements: [
      { ref: 'source', kind: 'softwareSystem', name: 'Source System', x: 0, y: 0 },
      { ref: 'pipeline', kind: 'softwareSystem', name: 'Ingestion', x: COL, y: 0 },
      { ref: 'warehouse', kind: 'softwareSystem', name: 'Warehouse', x: COL * 2, y: 0 },
      { ref: 'analyst', kind: 'person', name: 'Analyst', role: 'internal', x: COL * 3, y: 0 },
    ],
    links: [
      { from: 'source', to: 'pipeline', kind: 'dataFlow', payload: 'Transaction' },
      { from: 'pipeline', to: 'warehouse', kind: 'dataFlow', payload: 'Fact row' },
      { from: 'warehouse', to: 'analyst', kind: 'dataFlow', payload: 'Report' },
    ],
  },
];

export function findTemplate(id: string): WorkspaceTemplate | undefined {
  return TEMPLATES.find((t) => t.id === id);
}

/** How many boxes a template lands on the canvas — shown in the picker, and kept honest by a test. */
export function boxCount(template: WorkspaceTemplate): number {
  return template.elements.length;
}

/**
 * Which argument carries the parent. A container belongs to a software system; a module or a
 * capability belongs to a bounded context. Same relationship on the canvas, different member in the
 * file, and putting the id in the wrong one writes a reference that resolves to nothing.
 */
export function parentSlot(kind: ArchElementKind): 'systemId' | 'contextId' {
  return kind === 'container' ? 'systemId' : 'contextId';
}

/**
 * The impure edge. `applyTemplate` decides *what* happens and in what order; this does it.
 * Splitting them is what lets the ordering, the ref mapping and the failure handling be tested
 * without a backend.
 */
export interface TemplateRunner {
  /** Apply one AddElement. Returns the id the engine assigned, or null if it failed. */
  addElement(element: TemplateElement, parentId: string | undefined): Promise<string | null>;
  /** Apply one AddLink between two ids that already exist. */
  addLink(link: TemplateLink, fromId: string, toId: string): Promise<boolean>;
  /** Commit the arrangement, keyed by the id the engine assigned. */
  place(positions: Record<string, { x: number; y: number }>): void;
}

export interface TemplateOutcome {
  /** Template ref → the id the engine gave it. */
  ids: Record<string, string>;
  elementsAdded: number;
  linksAdded: number;
  /** Refs whose element could not be created; anything depending on them was skipped. */
  failed: string[];
}

/**
 * Run a template.
 *
 * Parents before children, because a container needs its system's real id and the engine assigns
 * ids as it writes. A link is only attempted when both of its endpoints actually exist: half a
 * relationship silently vanishes from the canvas, which is precisely the failure a first-run user
 * cannot diagnose. Positions are committed once at the end rather than per element, so an
 * interrupted run leaves a coherent arrangement instead of a partial one.
 */
export async function applyTemplate(
  template: WorkspaceTemplate,
  runner: TemplateRunner,
): Promise<TemplateOutcome> {
  const ids: Record<string, string> = {};
  const failed: string[] = [];
  const positions: Record<string, { x: number; y: number }> = {};

  for (const element of ordered(template.elements)) {
    if (element.parent && !ids[element.parent]) {
      // Its container never got created, so it would land as an orphan claiming a parent that is
      // not there. Skip it rather than write a dangling reference into the file.
      failed.push(element.ref);
      continue;
    }
    const id = await runner.addElement(element, element.parent ? ids[element.parent] : undefined);
    if (!id) { failed.push(element.ref); continue; }
    ids[element.ref] = id;
    positions[id] = { x: element.x, y: element.y };
  }

  let linksAdded = 0;
  for (const link of template.links) {
    const fromId = ids[link.from];
    const toId = ids[link.to];
    if (!fromId || !toId) continue;
    if (await runner.addLink(link, fromId, toId)) linksAdded++;
  }

  runner.place(positions);

  return { ids, elementsAdded: Object.keys(ids).length, linksAdded, failed };
}

/** Parents first, otherwise a child is created before the id it needs exists. */
function ordered(elements: TemplateElement[]): TemplateElement[] {
  const parents = elements.filter((e) => !e.parent);
  const children = elements.filter((e) => e.parent);
  return [...parents, ...children];
}
