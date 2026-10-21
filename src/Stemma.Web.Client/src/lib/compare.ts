/**
 * Comparing with another version of the model (F-017, ADR-0024): start and stop a comparison, and the
 * difference itself, recomputed from the model on screen so it follows every edit.
 */

import { useMemo } from 'react';
import { fetchModelAt } from './api';
import { diffModels, type ModelDiff } from './modelDiff';
import { reportFailure, ClientEvent } from './log';
import { useApp } from './store';

/** Compare the canvas with `rev`; `label` is how the bar names it ("the last commit", "v0.1.0"). */
export async function startCompare(rev: string, label: string): Promise<boolean> {
  const st = useApp.getState();
  try {
    const at = await fetchModelAt(rev);
    useApp.getState().setCompare({ rev, label, sha: at.sha, before: at.arch, layout: at.layout });
    return true;
  } catch (error) {
    st.setToast({ kind: 'error', text: (error as Error).message });
    return false;
  }
}

export function stopCompare(): void {
  useApp.getState().setCompare(null);
}

/** Read the model at the last commit again, for the count of uncommitted changes. Quiet when there is no Git. */
export async function refreshHeadModel(): Promise<void> {
  const root = useApp.getState().workspace?.rootPath;
  if (!root) return;
  try {
    const at = await fetchModelAt('HEAD');
    if (useApp.getState().workspace?.rootPath === root) useApp.getState().setHeadModel({ sha: at.sha, arch: at.arch });
  } catch (error) {
    // No repository, or no commit yet: nothing to count against, which the status bar shows as nothing.
    useApp.getState().setHeadModel(null);
    if (!(error instanceof Error)) reportFailure('Api', ClientEvent.RequestFailed, 'Reading the last commit')(error);
  }
}

/** The difference the canvas shows while comparing; null when not comparing. */
export function useCompareDiff(): ModelDiff | null {
  const compare = useApp((s) => s.compare);
  const arch = useApp((s) => s.arch);
  return useMemo(() => (compare && arch ? diffModels(compare.before, arch) : null), [compare, arch]);
}

/** The changes since the last commit, for the status bar; null when there is nothing to compare with. */
export function useUncommittedDiff(): ModelDiff | null {
  const head = useApp((s) => s.headModel);
  const arch = useApp((s) => s.arch);
  return useMemo(() => (head && arch ? diffModels(head.arch, arch) : null), [head, arch]);
}

/** Where each element sat on a view, in a sidecar as it was read from Git — anything else is ignored. */
export function positionsAt(layout: unknown, viewKey: string): Record<string, { x: number; y: number }> {
  const nodes = (layout as { views?: Record<string, { nodes?: Record<string, unknown> }> } | null)?.views?.[viewKey]?.nodes;
  const out: Record<string, { x: number; y: number }> = {};
  if (!nodes || typeof nodes !== 'object') return out;
  for (const [id, p] of Object.entries(nodes)) {
    const pos = p as { x?: unknown; y?: unknown };
    if (typeof pos?.x === 'number' && typeof pos?.y === 'number') out[id] = { x: pos.x, y: pos.y };
  }
  return out;
}

/** How big each card was drawn then, where a size was set. */
export function sizesAt(layout: unknown): Record<string, { w: number; h: number }> {
  const styles = (layout as { nodeStyles?: Record<string, { width?: unknown; height?: unknown }> } | null)?.nodeStyles;
  const out: Record<string, { w: number; h: number }> = {};
  if (!styles || typeof styles !== 'object') return out;
  for (const [id, s] of Object.entries(styles)) {
    if (typeof s?.width === 'number' && typeof s?.height === 'number') out[id] = { w: s.width, h: s.height };
  }
  return out;
}
