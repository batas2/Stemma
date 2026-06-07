import type { ArchElementKind } from './types';

/** A property that makes sense for an element kind — surfaced as a hashtag suggestion in the
 *  notes editor and as a quick-add chip. Typing `#<key>: value` in an element's notes sets the
 *  matching custom property. */
export interface PropDef {
  key: string;
  label: string;
  hint?: string;
}

/** Sensible, upfront-defined properties per element kind. Not a closed set — users can add any
 *  `#tag` they like; these are the suggested ones. */
export const PROPERTY_SCHEMA: Partial<Record<ArchElementKind, PropDef[]>> = {
  module: [
    { key: 'owner', label: 'Owner', hint: 'team or person' },
    { key: 'status', label: 'Status', hint: 'current / target / deprecated' },
    { key: 'tech', label: 'Tech', hint: 'language / framework' },
    { key: 'sla', label: 'SLA' },
  ],
  boundedContext: [
    { key: 'owner', label: 'Owner' },
    { key: 'team', label: 'Team' },
    { key: 'domain', label: 'Domain' },
  ],
  softwareSystem: [
    { key: 'owner', label: 'Owner' },
    { key: 'hosting', label: 'Hosting' },
    { key: 'status', label: 'Status' },
  ],
  container: [
    { key: 'tech', label: 'Tech' },
    { key: 'port', label: 'Port' },
  ],
  capability: [
    { key: 'owner', label: 'Owner' },
    { key: 'maturity', label: 'Maturity', hint: 'idea / building / live' },
  ],
  person: [
    { key: 'role', label: 'Role' },
    { key: 'team', label: 'Team' },
  ],
  useCase: [
    { key: 'actor', label: 'Actor' },
    { key: 'priority', label: 'Priority', hint: 'low / medium / high' },
  ],
  risk: [
    { key: 'Impact', label: 'Impact', hint: 'low / medium / high' },
    { key: 'Likelihood', label: 'Likelihood', hint: 'low / medium / high' },
    { key: 'Mitigation', label: 'Mitigation' },
    { key: 'State', label: 'State', hint: 'open / mitigated / accepted' },
    { key: 'Owner', label: 'Owner' },
  ],
  question: [
    { key: 'Owner', label: 'Owner' },
    { key: 'Answer', label: 'Answer' },
    { key: 'Status', label: 'Status', hint: 'open / answered' },
  ],
  assumption: [
    { key: 'Owner', label: 'Owner' },
    { key: 'Confidence', label: 'Confidence', hint: 'low / medium / high' },
    { key: 'Validated', label: 'Validated', hint: 'yes / no' },
  ],
};

export function schemaFor(kind: ArchElementKind): PropDef[] {
  return PROPERTY_SCHEMA[kind] ?? [];
}
