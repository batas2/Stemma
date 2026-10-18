// F-001 Architecture Report — bundle assembly.
// The report is a *projection*: model from the engine API, presentation from the layout sidecar,
// comments from comments.stemma.json. `buildReportBundle` is pure (unit-tested);
// `collectReportBundle` gathers fresh inputs at export time.

import type { ArchModel, CustomView } from '@/lib/types';
import type { SavedPosition, EdgeHandlePair } from '@/lib/layout';
import type { NodeStyle } from '@/lib/nodeStyles';
import type { EdgeStyle } from '@/lib/edgeStyles';
import type { CustomProps } from '@/lib/customProps';
import type { CommentEntry } from '@/lib/comments';
import { archModel } from '@/lib/api';
import { loadLayout, loadEdgeWaypoints, loadEdgeHandles, loadBooksSection } from '@/lib/layout';
import { readBooks, viewKeyOf, type Book, type BookFrame, type BookOthers } from '@/lib/books';
import { loadNodeStyles } from '@/lib/nodeStyles';
import { loadEdgeStyles } from '@/lib/edgeStyles';
import { loadCustomProps } from '@/lib/customProps';
import { loadNote } from '@/lib/elementNotes';
import { loadViews } from '@/lib/views';
import { fetchComments } from '@/lib/comments';
import { RELATIONSHIP_TYPES } from '@/lib/relationshipTypes';

export interface ReportView {
  key: string;                 // 'moduleMap' | 'dependencyGraph' | 'custom:<id>'
  name: string;
  kind: 'builtin' | 'custom';
  /** Custom views list their member ids; built-ins show everything their lens allows. */
  elementIds: string[] | null;
  baseView: string;            // kind filter applied on top ('all' for none)
}

/** A book as the report walks it (F-013 AC9): each page names the report view it is drawn on. */
export interface ReportBook {
  id: string;
  name: string;
  audience: string | null;
  pages: {
    id: string;
    title: string;
    /** A `ReportView.key` — a view from `Views/` is `custom:<id>`, as everywhere in the report. */
    viewKey: string;
    narrative: string;
    focus: string[];
    frame: BookFrame;
    others: BookOthers;
  }[];
}

export interface ReportBundle {
  meta: { workspace: string; rootPath: string; exportedAt: string; generator: string };
  model: ArchModel;
  views: ReportView[];
  /** viewKey → nodeId → position (from the layout sidecar; the report renders what the canvas shows). */
  positions: Record<string, Record<string, SavedPosition>>;
  waypoints: Record<string, Record<string, SavedPosition[]>>;
  handles: Record<string, Record<string, EdgeHandlePair>>;
  nodeStyles: Record<string, NodeStyle>;
  edgeStyles: Record<string, EdgeStyle>;
  notes: Record<string, string>;
  customProps: Record<string, CustomProps>;
  comments: CommentEntry[];
  relationshipTypes: { value: string; hint: string; style: Partial<EdgeStyle> }[];
  books: ReportBook[];
}

export interface ReportInputs {
  rootPath: string;
  workspaceName: string;
  model: ArchModel;
  customViews: CustomView[];
  comments: CommentEntry[];
  /** Reads presentation per view key — injected so the pure builder is testable. */
  readPositions: (viewKey: string) => Record<string, SavedPosition>;
  readWaypoints: (viewKey: string) => Record<string, SavedPosition[]>;
  readHandles: (viewKey: string) => Record<string, EdgeHandlePair>;
  nodeStyles: Record<string, NodeStyle>;
  edgeStyles: Record<string, EdgeStyle>;
  notes: Record<string, string>;
  customProps: Record<string, CustomProps>;
  books?: Book[];
  now?: Date;
}

export function buildReportBundle(i: ReportInputs): ReportBundle {
  const views: ReportView[] = [
    { key: 'moduleMap', name: 'Module Map', kind: 'builtin', elementIds: null, baseView: 'all' },
    { key: 'dependencyGraph', name: 'Dependencies', kind: 'builtin', elementIds: null, baseView: 'dependencyGraph' },
    ...i.customViews.map((v) => ({
      key: `custom:${v.id}`,
      name: v.name,
      kind: 'custom' as const,
      elementIds: [...v.elementIds],
      baseView: v.baseView ?? 'all',
    })),
  ];
  const positions: ReportBundle['positions'] = {};
  const waypoints: ReportBundle['waypoints'] = {};
  const handles: ReportBundle['handles'] = {};
  for (const v of views) {
    positions[v.key] = i.readPositions(v.key);
    waypoints[v.key] = i.readWaypoints(v.key);
    handles[v.key] = i.readHandles(v.key);
  }
  return {
    meta: {
      workspace: i.workspaceName,
      rootPath: i.rootPath,
      exportedAt: (i.now ?? new Date()).toISOString(),
      generator: 'Stemma',
    },
    model: i.model,
    views,
    positions,
    waypoints,
    handles,
    nodeStyles: i.nodeStyles,
    edgeStyles: i.edgeStyles,
    notes: i.notes,
    customProps: i.customProps,
    comments: i.comments,
    relationshipTypes: RELATIONSHIP_TYPES.map((t) => ({ value: t.value, hint: t.hint, style: t.style })),
    books: (i.books ?? []).map((b) => ({
      id: b.id,
      name: b.name,
      audience: b.audience,
      pages: b.pages.map((p) => ({
        id: p.id, title: p.title, viewKey: viewKeyOf(p.view), narrative: p.narrative, focus: [...p.focus], frame: p.frame, others: p.others,
      })),
    })),
  };
}

/** Gather fresh inputs at export time: model + comments re-fetched from the backend (on-disk
 *  truth), presentation from the sidecar-backed caches the canvas itself renders from. */
export async function collectReportBundle(rootPath: string): Promise<ReportBundle> {
  const [model, sidecar] = await Promise.all([
    archModel(),
    // A file that cannot be read fails the export rather than shipping a report with no comments
    // in it that looks like one nobody commented on (B-018).
    fetchComments(),
  ]);
  if (!model) throw new Error('No architecture model loaded');
  const notes: Record<string, string> = {};
  for (const e of model.elements) {
    const n = loadNote(rootPath, e.id);
    if (n.trim()) notes[e.id] = n;
  }
  const workspaceName = rootPath.replace(/\/+$/, '').split('/').pop() || rootPath;
  return buildReportBundle({
    rootPath,
    workspaceName,
    model,
    customViews: loadViews(rootPath),
    comments: sidecar.comments,
    readPositions: (k) => loadLayout(rootPath, k),
    readWaypoints: (k) => loadEdgeWaypoints(rootPath, k),
    readHandles: (k) => loadEdgeHandles(rootPath, k),
    nodeStyles: loadNodeStyles(rootPath),
    edgeStyles: loadEdgeStyles(rootPath),
    notes,
    customProps: loadCustomProps(rootPath),
    // The same walk as the meeting, for whoever missed it.
    books: readBooks(loadBooksSection(rootPath)),
  });
}
