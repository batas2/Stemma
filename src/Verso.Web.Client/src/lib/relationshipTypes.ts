import type { EdgeStyle } from './edgeStyles';

/** A predefined, architecture-meaningful relationship type. Picking one writes `value` into the
 *  model (the `kind` of a Dependency / the `payload` of a DataFlow via SetLinkAttribute) and
 *  applies `style` to the edge. Free text stays allowed everywhere these are offered — a custom
 *  value simply carries no style preset. */
export interface RelationshipType {
  value: string;
  hint: string;
  style: Partial<EdgeStyle>;
}

export const RELATIONSHIP_TYPES: RelationshipType[] = [
  {
    value: 'uses',
    hint: 'Generic structural dependency',
    style: { color: '#64748b', lineStyle: 'solid', thickness: 1.5, arrowEnd: 'closed', arrowStart: 'none', animated: false },
  },
  {
    value: 'calls',
    hint: 'Synchronous call — API / RPC / query',
    style: { color: '#4f46e5', lineStyle: 'solid', thickness: 2, arrowEnd: 'closed', arrowStart: 'none', animated: false },
  },
  {
    value: 'publishes',
    hint: 'Emits event / message (async)',
    style: { color: '#06b6d4', lineStyle: 'solid', thickness: 2, arrowEnd: 'open', arrowStart: 'none', animated: true, animSpeed: 'normal' },
  },
  {
    value: 'subscribes',
    hint: 'Listens to / consumes events',
    style: { color: '#8b5cf6', lineStyle: 'dashed', thickness: 1.5, arrowEnd: 'open', arrowStart: 'none', animated: true, animSpeed: 'slow' },
  },
  {
    value: 'reads',
    hint: 'Reads data from a store / source',
    style: { color: '#10b981', lineStyle: 'dotted', thickness: 1.5, arrowEnd: 'open', arrowStart: 'none', animated: false },
  },
  {
    value: 'writes',
    hint: 'Writes / persists data',
    style: { color: '#f59e0b', lineStyle: 'solid', thickness: 2, arrowEnd: 'closed', arrowStart: 'none', animated: false },
  },
];

export function relationshipType(value: string | undefined): RelationshipType | undefined {
  return RELATIONSHIP_TYPES.find((t) => t.value === value);
}
