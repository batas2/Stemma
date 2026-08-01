// Free-form shape support for custom views (Epic 07 Track B).
// Shapes are pure presentation, persisted in `stemma.layout.json` under
// `views.<viewKey>.shapes[]`. Built-in views never render shapes.
//
// Per ADR-0009, shapes are not part of the canonical model. They never mutate
// `Architecture.cs`. Deleting them is safe.

import { loadViewShapes, saveViewShapes, primeLayoutSidecar, setSidecarCacheForTest } from './layout';

export type ShapeKind = 'rect' | 'ellipse' | 'triangle' | 'label' | 'arrow' | 'image';

/** Fields shared by the box-like, text-carrying shapes (rect / ellipse / triangle). Gives shapes
 *  the same appearance vocabulary as element nodes (fill style, shadow, motion). */
export interface ShapeBoxText {
  label?: string;       // bold title line
  text?: string;        // multi-line body (wraps inside the box)
  textColor?: string;
  fontSize?: number;
  radius?: number;      // corner radius (rect)
  fillStyle?: 'solid' | 'gradient';
  shadow?: 'none' | 'soft' | 'raised' | 'glow';
  animation?: 'none' | 'marching' | 'pulse' | 'breathe';
}

export interface ShapeBase {
  id: string;
  kind: ShapeKind;
  z: number;            // z-index inside the shapes layer; default -1 (behind nodes)
}

export interface ShapeRect extends ShapeBase, ShapeBoxText {
  kind: 'rect';
  x: number; y: number; w: number; h: number;
  fill: string;
  stroke: string;
  strokeWidth: number;
  strokeStyle?: 'solid' | 'dashed' | 'dotted';
  rounded?: boolean;
}

export interface ShapeEllipse extends ShapeBase, ShapeBoxText {
  kind: 'ellipse';
  x: number; y: number; w: number; h: number;
  fill: string;
  stroke: string;
  strokeWidth: number;
  strokeStyle?: 'solid' | 'dashed' | 'dotted';
}

export interface ShapeTriangle extends ShapeBase, ShapeBoxText {
  kind: 'triangle';
  x: number; y: number; w: number; h: number;
  fill: string;
  stroke: string;
  strokeWidth: number;
  strokeStyle?: 'solid' | 'dashed' | 'dotted';
}

export interface ShapeLabel extends ShapeBase {
  kind: 'label';
  x: number; y: number;
  text: string;
  fontSize: number;
  color: string;
}

/** Where an arrow endpoint lives. Anchored endpoints follow their target across pan / move. */
export type ArrowAnchor =
  | { kind: 'free'; x: number; y: number }
  | { kind: 'element'; id: string }
  | { kind: 'shape'; id: string };

/** Relationship taxonomy mirroring the model link kinds (Stemma.Model). Shape arrows use
 *  the same vocabulary so an architect's mental model is consistent across model-bound
 *  links and sidecar-only annotations. */
export type ShapeLinkKind = 'dataFlow' | 'dependency';
export type ShapeDependencySubKind = 'uses' | 'calls' | 'consumes' | 'publishes' | 'reads' | 'subscribes' | 'invokes' | 'composes' | 'inherits' | 'implements' | 'governs' | 'triggers';

export interface ShapeArrow extends ShapeBase {
  kind: 'arrow';
  /** Snapshot endpoints; used as a fallback when an anchor target is missing. */
  fromX: number; fromY: number;
  toX: number; toY: number;
  /** Optional anchored endpoints. When present, endpoints follow the target's bounding box. */
  fromAnchor?: ArrowAnchor;
  toAnchor?: ArrowAnchor;
  stroke: string;
  strokeWidth: number;
  strokeStyle?: 'solid' | 'dashed' | 'dotted';
  label?: string;
  /** Mirrors ArchLink.kind. Defaults to 'dataFlow' for backwards-compatibility. */
  linkKind?: ShapeLinkKind;
  /** For 'dependency' kind: the verb (uses / calls / publishes / …). Free text. */
  linkSubKind?: string;
  /** For 'dataFlow' kind: the payload label (e.g. "InvoiceCreated"). */
  payload?: string;
}

/** Default the visual style for an arrow from its relationship kind. */
export function styleForLinkKind(linkKind?: ShapeLinkKind): { strokeStyle: 'solid' | 'dashed' | 'dotted' } {
  if (linkKind === 'dependency') return { strokeStyle: 'dashed' };
  return { strokeStyle: 'solid' };
}

/** Render label: prefer explicit label, else payload (dataFlow), else subKind (dependency). */
export function arrowDisplayLabel(a: ShapeArrow): string | undefined {
  if (a.label && a.label.length > 0) return a.label;
  if (a.linkKind === 'dataFlow') return a.payload && a.payload.length > 0 ? a.payload : undefined;
  if (a.linkKind === 'dependency') return a.linkSubKind && a.linkSubKind.length > 0 ? a.linkSubKind : undefined;
  return undefined;
}

export interface ShapeImage extends ShapeBase {
  kind: 'image';
  x: number; y: number; w: number; h: number;
  src: string;        // built-in stencil id like "stencil:database" or a data:URL
  label?: string;
}

export type Shape = ShapeRect | ShapeEllipse | ShapeTriangle | ShapeLabel | ShapeArrow | ShapeImage;

export const MAX_SHAPES_PER_VIEW = 256;
export const SHAPES_WARN_THRESHOLD = 100;

// ---------- Persistence ----------

// Shapes share the one committed sidecar cache owned by ./layout (so style/note/position writes
// never clobber shape writes and vice-versa). These are thin adapters over that cache.

/** Returns the shapes for a view, or [] if none. Reads from the shared sidecar cache. */
export function loadShapes(workspaceRoot: string, viewKey: string): Shape[] {
  return loadViewShapes<Shape>(workspaceRoot, viewKey);
}

/** Replace the shapes array for a view; debounced PUT of the full sidecar. */
export function saveShapes(workspaceRoot: string, viewKey: string, shapes: Shape[]): void {
  saveViewShapes(workspaceRoot, viewKey, shapes);
}

/** Prime the shared sidecar cache. Call once at workspace open. */
export async function primeShapeCache(workspaceRoot: string): Promise<void> {
  await primeLayoutSidecar(workspaceRoot);
}

/** Test seam: inject the shared sidecar cache without going through fetch. */
export function setShapeCacheForTest(rootPath: string, sidecar: unknown): void {
  setSidecarCacheForTest(rootPath, sidecar);
}

// ---------- CRUD helpers (pure; callers persist via saveShapes) ----------

export function addShape(shapes: Shape[], shape: Shape): Shape[] {
  if (shapes.length >= MAX_SHAPES_PER_VIEW) {
    throw new Error(`Cannot add shape: this view already has ${MAX_SHAPES_PER_VIEW} shapes (the maximum). Split into another custom view first.`);
  }
  return [...shapes, shape];
}

export function updateShape(shapes: Shape[], id: string, patch: Partial<Shape>): Shape[] {
  return shapes.map((s) => s.id === id ? ({ ...s, ...patch } as Shape) : s);
}

export function removeShape(shapes: Shape[], id: string): Shape[] {
  return shapes.filter((s) => s.id !== id);
}

export function setShapeOrder(shapes: Shape[], id: string, z: number): Shape[] {
  return shapes.map((s) => s.id === id ? ({ ...s, z } as Shape) : s);
}

// ---------- Factories ----------

const newId = (kind: ShapeKind): string =>
  `shp_${kind[0]}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 5)}`;

export function newRect(x: number, y: number, w = 240, h = 160): ShapeRect {
  return {
    id: newId('rect'), kind: 'rect', z: -1,
    x, y, w, h,
    fill: 'rgba(99, 102, 241, 0.06)',
    stroke: 'rgb(99, 102, 241)',
    strokeWidth: 2,
    strokeStyle: 'solid',
    rounded: true,
  };
}

export function newEllipse(x: number, y: number, w = 200, h = 120): ShapeEllipse {
  return {
    id: newId('ellipse'), kind: 'ellipse', z: -1,
    x, y, w, h,
    fill: 'rgba(244, 114, 182, 0.06)',
    stroke: 'rgb(244, 114, 182)',
    strokeWidth: 2,
    strokeStyle: 'solid',
  };
}

export function newTriangle(x: number, y: number, w = 200, h = 160): ShapeTriangle {
  return {
    id: newId('triangle'), kind: 'triangle', z: -1,
    x, y, w, h,
    fill: 'rgba(16, 185, 129, 0.06)',
    stroke: 'rgb(16, 185, 129)',
    strokeWidth: 2,
    strokeStyle: 'solid',
  };
}

export function newLabel(x: number, y: number, text = 'Label'): ShapeLabel {
  return {
    id: newId('label'), kind: 'label', z: 1,
    x, y, text, fontSize: 14, color: 'rgb(63, 63, 70)',
  };
}

export function newArrow(
  fromX: number, fromY: number, toX: number, toY: number,
  fromAnchor?: ArrowAnchor, toAnchor?: ArrowAnchor,
  linkKind: ShapeLinkKind = 'dataFlow',
): ShapeArrow {
  const style = styleForLinkKind(linkKind);
  return {
    id: newId('arrow'), kind: 'arrow', z: 0,
    fromX, fromY, toX, toY,
    fromAnchor, toAnchor,
    stroke: 'rgb(63, 63, 70)',
    strokeWidth: 2,
    strokeStyle: style.strokeStyle,
    linkKind,
  };
}

export function newImage(x: number, y: number, src: string, w = 64, h = 64): ShapeImage {
  return { id: newId('image'), kind: 'image', z: 0, x, y, w, h, src };
}

// ---------- View-key helpers ----------

/** Shapes only render on custom views. The view-key encodes that. */
export function isCustomViewKey(key: string): boolean {
  return key.startsWith('custom:');
}
