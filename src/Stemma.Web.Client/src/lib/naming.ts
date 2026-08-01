import type { ArchElement, ArchElementKind } from './types';

const DEFAULT_NAMES: Record<ArchElementKind, string> = {
  module: 'Module',
  boundedContext: 'Bounded Context',
  softwareSystem: 'Software System',
  container: 'Container',
  person: 'Person',
  useCase: 'Use Case',
  capability: 'Capability',
  question: 'Question',
  assumption: 'Assumption',
  risk: 'Risk',
};

// Auto-generate a fresh, sensible name for a new element of the given kind.
// Looks at existing element names in the model and picks "<Default> N" with the
// smallest N that doesn't collide. Keeps drag-to-canvas friction-free — users
// rename inline afterwards if they care.
export function suggestElementName(kind: ArchElementKind, existing: ArchElement[]): string {
  const base = DEFAULT_NAMES[kind] ?? 'Element';
  const sameKind = existing.filter((e) => e.kind === kind);
  if (sameKind.length === 0) return base;
  const taken = new Set(existing.map((e) => e.name));
  if (!taken.has(base)) return base;
  for (let n = 2; n < 1000; n++) {
    const candidate = `${base} ${n}`;
    if (!taken.has(candidate)) return candidate;
  }
  return `${base} ${Date.now()}`;
}

export function suggestViewName(existing: { name: string }[]): string {
  const base = 'New View';
  const taken = new Set(existing.map((v) => v.name));
  if (!taken.has(base)) return base;
  for (let n = 2; n < 1000; n++) {
    const candidate = `${base} ${n}`;
    if (!taken.has(candidate)) return candidate;
  }
  return `${base} ${Date.now()}`;
}
