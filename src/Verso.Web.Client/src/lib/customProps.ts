// Free-form key/value properties attached to elements on the canvas.
// Persisted client-side in localStorage; the engine doesn't know about them.
// If we ever lift these into the model, swap the storage backend without
// touching callers — the public API is small on purpose.

import { sidecarMap, sidecarSet } from './layout';

export type CustomProps = Record<string, string>;

const KEY_PREFIX = 'verso.customProps';

function key(rootPath: string): string { return `${KEY_PREFIX}:${rootPath}`; }

export function loadCustomProps(rootPath: string): Record<string, CustomProps> {
  if (typeof window === 'undefined') return {};
  let local: Record<string, CustomProps> = {};
  try { const raw = localStorage.getItem(key(rootPath)); local = raw ? JSON.parse(raw) : {}; } catch { /* ignore */ }
  const committed = sidecarMap<CustomProps>(rootPath, 'customProps');
  return committed ? { ...local, ...committed } : local;
}

/** Mirror a node's whole custom-prop map into the committed sidecar (or delete when empty). */
function commitProps(rootPath: string, all: Record<string, CustomProps>, nodeId: string): void {
  const entry = all[nodeId];
  sidecarSet(rootPath, 'customProps', nodeId, entry && Object.keys(entry).length > 0 ? entry : undefined);
}

export function saveCustomProps(rootPath: string, all: Record<string, CustomProps>): void {
  if (typeof window === 'undefined') return;
  try { localStorage.setItem(key(rootPath), JSON.stringify(all)); } catch { /* ignore */ }
}

export function setCustomProp(
  rootPath: string,
  nodeId: string,
  propKey: string,
  value: string,
): Record<string, CustomProps> {
  const all = loadCustomProps(rootPath);
  const current = all[nodeId] ?? {};
  all[nodeId] = { ...current, [propKey]: value };
  saveCustomProps(rootPath, all);
  commitProps(rootPath, all, nodeId);
  return all;
}

export function removeCustomProp(
  rootPath: string,
  nodeId: string,
  propKey: string,
): Record<string, CustomProps> {
  const all = loadCustomProps(rootPath);
  const current = all[nodeId];
  if (!current) return all;
  const next = { ...current };
  delete next[propKey];
  if (Object.keys(next).length === 0) delete all[nodeId];
  else all[nodeId] = next;
  saveCustomProps(rootPath, all);
  commitProps(rootPath, all, nodeId);
  return all;
}

export function renameCustomProp(
  rootPath: string,
  nodeId: string,
  oldKey: string,
  newKey: string,
): Record<string, CustomProps> {
  if (oldKey === newKey) return loadCustomProps(rootPath);
  const all = loadCustomProps(rootPath);
  const current = all[nodeId];
  if (!current || !(oldKey in current)) return all;
  const value = current[oldKey];
  const next: CustomProps = { ...current };
  delete next[oldKey];
  next[newKey] = value;
  all[nodeId] = next;
  saveCustomProps(rootPath, all);
  commitProps(rootPath, all, nodeId);
  return all;
}

// Reserved keys that match built-in field renderers — can't be used as custom
// prop names so the visible-fields checklist stays unambiguous.
export const RESERVED_KEYS = new Set<string>([
  'kind', 'name', 'id', 'contextId', 'systemId', 'containerKind',
  'squad', 'domain', 'status', 'phase', 'narrativePreview',
]);
