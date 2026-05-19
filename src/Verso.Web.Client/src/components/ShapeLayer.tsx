import { useReactFlow, useStore, useViewport, type Node } from '@xyflow/react';
import { useApp } from '@/lib/store';
import {
  type ArrowAnchor, type Shape, type ShapeArrow, type ShapeEllipse, type ShapeImage, type ShapeLabel, type ShapeRect,
  arrowDisplayLabel,
  newArrow, newEllipse, newLabel, newRect, addShape, removeShape, updateShape, saveShapes,
} from '@/lib/shapes';
import { useEffect, useMemo, useRef, useState } from 'react';
import { applyOperation } from '@/lib/signalr';

interface Props {
  viewKey: string;
  workspaceRoot: string;
  enabled: boolean;
}

const EMPTY_SHAPES: readonly Shape[] = Object.freeze([]) as readonly Shape[];

type DraftDrag = { mode: 'draw'; tool: 'rect' | 'ellipse' | 'label' | 'arrow'; startX: number; startY: number; cur: { x: number; y: number } };
type ShapeMoveDrag = { mode: 'move'; shapeId: string; startX: number; startY: number; initial: Shape };
type ShapeResizeDrag = { mode: 'resize'; shapeId: string; handle: ResizeHandle; startX: number; startY: number; initial: Shape };
type ConnectDrag = { mode: 'connect'; from: ArrowAnchor; cursorX: number; cursorY: number };
type DragState = DraftDrag | ShapeMoveDrag | ShapeResizeDrag | ConnectDrag | null;

type ResizeHandle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';

const HANDLE_CURSORS: Record<ResizeHandle, string> = {
  nw: 'nwse-resize', se: 'nwse-resize',
  ne: 'nesw-resize', sw: 'nesw-resize',
  n: 'ns-resize', s: 'ns-resize',
  e: 'ew-resize', w: 'ew-resize',
};

/**
 * SVG layer rendered above React Flow's pane for a custom view. Mirrors the React Flow
 * viewport transform so shapes pan + zoom with the model nodes. Pointer events partition:
 *   - Outer SVG: `pointer-events: none` — empty regions pass through to React Flow.
 *   - Per-shape `<g>`: `pointer-events: auto` — selectable + draggable.
 *   - Hit-test backdrop in shape-draw mode: `pointer-events: all` for click-to-draw.
 *   - Dock dots and resize handles: explicit `pointer-events: all`.
 */
export function ShapeLayer({ viewKey, workspaceRoot, enabled }: Props) {
  const shapesSlot = useApp((s) => s.shapes[viewKey]);
  const shapes: readonly Shape[] = shapesSlot ?? EMPTY_SHAPES;
  const setShapesFor = useApp((s) => s.setShapesFor);
  const canvasMode = useApp((s) => s.canvasMode);
  const selectedShapeId = useApp((s) => s.selectedShapeId);
  const selectShape = useApp((s) => s.selectShape);
  const { screenToFlowPosition } = useReactFlow();
  const viewport = useViewport();

  // We need React Flow's node positions to resolve `kind: 'element'` arrow anchors. `useStore`
  // subscribes us so anchored arrows re-render when the underlying nodes move.
  const nodes = useStore((s) => s.nodes) as Node[];
  const nodeBounds = useMemo(() => {
    const map = new Map<string, { x: number; y: number; w: number; h: number }>();
    for (const n of nodes) {
      const w = n.measured?.width ?? n.width ?? 200;
      const h = n.measured?.height ?? n.height ?? 60;
      map.set(n.id, { x: n.position.x, y: n.position.y, w, h });
    }
    return map;
  }, [nodes]);

  const [drag, setDrag] = useState<DragState>(null);
  const [hoverNodeId, setHoverNodeId] = useState<string | null>(null);
  const dragRef = useRef<DragState>(null);
  dragRef.current = drag;

  // Track which model node the pointer is currently over so we can show docking dots.
  // We can't just use React Flow's hover events because the dots live in our SVG layer.
  useEffect(() => {
    if (!enabled) return;
    function onPointerOver(e: PointerEvent) {
      // Skip while a drag is in progress — onMove already maintains hoverNodeId during connect drags.
      if (dragRef.current?.mode === 'connect') return;
      const target = e.target as Element | null;
      const nodeEl = target?.closest?.('.react-flow__node') as HTMLElement | null;
      const id = nodeEl?.dataset.id ?? null;
      setHoverNodeId((prev) => prev === id ? prev : id);
    }
    window.addEventListener('pointermove', onPointerOver);
    return () => window.removeEventListener('pointermove', onPointerOver);
  }, [enabled]);

  // Delete key removes selected shape (Delete or Backspace, ignoring inputs).
  useEffect(() => {
    if (!enabled) return;
    function onKey(e: KeyboardEvent) {
      if (e.key !== 'Delete' && e.key !== 'Backspace') return;
      const id = useApp.getState().selectedShapeId;
      if (!id) return;
      const ae = document.activeElement as HTMLElement | null;
      if (ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' || ae.isContentEditable)) return;
      const cur = useApp.getState().shapes[viewKey] ?? [];
      if (!cur.some((s) => s.id === id)) return;
      const next = removeShape(cur, id);
      setShapesFor(viewKey, next);
      saveShapes(workspaceRoot, viewKey, next);
      selectShape(null);
      e.preventDefault();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [enabled, viewKey, workspaceRoot, setShapesFor, selectShape]);

  // Window-level pointermove / pointerup so a drag survives the pointer leaving any small element.
  useEffect(() => {
    if (!enabled) return;
    function onMove(e: PointerEvent) {
      const d = dragRef.current;
      if (!d) return;
      const flow = screenToFlowPosition({ x: e.clientX, y: e.clientY });
      if (d.mode === 'draw') {
        setDrag({ ...d, cur: flow });
        return;
      }
      if (d.mode === 'move') {
        const dx = flow.x - d.startX;
        const dy = flow.y - d.startY;
        const updated = translateShape(d.initial, dx, dy);
        const cur = useApp.getState().shapes[viewKey] ?? [];
        setShapesFor(viewKey, updateShape(cur, d.shapeId, updated));
        return;
      }
      if (d.mode === 'resize') {
        const dx = flow.x - d.startX;
        const dy = flow.y - d.startY;
        const updated = resizeShape(d.initial, d.handle, dx, dy);
        if (!updated) return;
        const cur = useApp.getState().shapes[viewKey] ?? [];
        setShapesFor(viewKey, updateShape(cur, d.shapeId, updated));
        return;
      }
      if (d.mode === 'connect') {
        setDrag({ ...d, cursorX: flow.x, cursorY: flow.y });
        // Hover hit-testing: which model node (if any) is under the pointer?
        const hit = findNodeUnder(flow.x, flow.y, nodeBounds);
        setHoverNodeId(hit);
        return;
      }
    }
    function onUp(e: PointerEvent) {
      const d = dragRef.current;
      if (!d) return;
      if (d.mode === 'draw') {
        const dx = d.cur.x - d.startX;
        const dy = d.cur.y - d.startY;
        const x = Math.min(d.startX, d.cur.x);
        const y = Math.min(d.startY, d.cur.y);
        const w = Math.max(40, Math.abs(dx));
        const h = Math.max(30, Math.abs(dy));
        let s: Shape | null = null;
        switch (d.tool) {
          case 'rect':    s = newRect(x, y, w, h); break;
          case 'ellipse': s = newEllipse(x, y, w, h); break;
          case 'arrow':   s = newArrow(d.startX, d.startY, d.cur.x, d.cur.y); break;
          case 'label':   s = newLabel(d.startX, d.startY, 'Label'); break;
        }
        if (s) commitNew(s);
      } else if (d.mode === 'move' || d.mode === 'resize') {
        saveShapes(workspaceRoot, viewKey, useApp.getState().shapes[viewKey] ?? []);
      } else if (d.mode === 'connect') {
        const flow = screenToFlowPosition({ x: e.clientX, y: e.clientY });
        const targetNode = findNodeUnder(flow.x, flow.y, nodeBounds);
        const targetShape = findShapeUnder(flow.x, flow.y, useApp.getState().shapes[viewKey] ?? []);

        // ----- Element ↔ Element: route to the real model link op so the relationship lives
        //       in Architecture.cs alongside hand-written links.
        if (d.from.kind === 'element' && targetNode && targetNode !== d.from.id) {
          applyOperation({
            kind: 'AddLink', opId: `op_${Date.now()}`,
            linkKind: 'dataFlow', fromId: d.from.id, toId: targetNode,
            payload: 'Event', dependencyKind: null,
          }).catch((err: unknown) => {
            useApp.getState().setToast({ kind: 'error', text: `Add link failed: ${(err as Error).message}` });
          });
          // No shape arrow created; existing model edge will appear via SignalR refresh.
        } else {
          // ----- Shape involved on at least one end: stays in the layout sidecar as a ShapeArrow.
          let toAnchor: ArrowAnchor;
          let toX = flow.x, toY = flow.y;
          if (targetNode) {
            toAnchor = { kind: 'element', id: targetNode };
            const b = nodeBounds.get(targetNode)!;
            toX = b.x + b.w / 2; toY = b.y + b.h / 2;
          } else if (targetShape && (d.from.kind !== 'shape' || d.from.id !== targetShape.id)) {
            toAnchor = { kind: 'shape', id: targetShape.id };
            const c = shapeCenter(targetShape);
            toX = c.x; toY = c.y;
          } else {
            toAnchor = { kind: 'free', x: flow.x, y: flow.y };
          }
          const startPt = anchorPoint(d.from, nodeBounds, useApp.getState().shapes[viewKey] ?? []);
          const arrow = newArrow(startPt.x, startPt.y, toX, toY, d.from, toAnchor);
          commitNew(arrow);
        }
      }
      setHoverNodeId(null);
      setDrag(null);
    }
    function commitNew(s: Shape) {
      try {
        const cur = useApp.getState().shapes[viewKey] ?? [];
        const next = addShape(cur, s);
        setShapesFor(viewKey, next);
        saveShapes(workspaceRoot, viewKey, next);
        selectShape(s.id);
      } catch (err) {
        useApp.getState().setToast({ kind: 'error', text: (err as Error).message });
      }
    }
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, [enabled, viewKey, workspaceRoot, setShapesFor, selectShape, screenToFlowPosition, nodeBounds]);

  if (!enabled) return null;

  const sortedShapes = [...shapes].sort((a, b) => a.z - b.z);
  const shapeMode = canvasMode.kind === 'shape';

  function onBackdropPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    if (!shapeMode || canvasMode.kind !== 'shape') return;
    if (canvasMode.tool === 'image') return;
    const flow = screenToFlowPosition({ x: e.clientX, y: e.clientY });
    setDrag({ mode: 'draw', tool: canvasMode.tool, startX: flow.x, startY: flow.y, cur: flow });
    e.stopPropagation();
  }

  function onShapePointerDown(e: React.PointerEvent<SVGGElement>, shape: Shape) {
    if (canvasMode.kind === 'shape') return;
    e.stopPropagation();
    selectShape(shape.id);
    const flow = screenToFlowPosition({ x: e.clientX, y: e.clientY });
    setDrag({ mode: 'move', shapeId: shape.id, startX: flow.x, startY: flow.y, initial: shape });
  }

  function onResizeHandlePointerDown(e: React.PointerEvent, shape: Shape, handle: ResizeHandle) {
    e.stopPropagation();
    const flow = screenToFlowPosition({ x: e.clientX, y: e.clientY });
    setDrag({ mode: 'resize', shapeId: shape.id, handle, startX: flow.x, startY: flow.y, initial: shape });
  }

  function onDockPointerDown(e: React.PointerEvent, anchor: ArrowAnchor, fromX: number, fromY: number) {
    e.stopPropagation();
    setDrag({ mode: 'connect', from: anchor, cursorX: fromX, cursorY: fromY });
    selectShape(null);
  }

  function onSelectModeBackdropClick() {
    if (!shapeMode) selectShape(null);
  }

  // Compute dock dots for every model node (when arrow tool active OR shape selected with arrow nearby).
  // For simplicity: show docks on hover of any node when in select mode.
  const showElementDocks = canvasMode.kind === 'select';

  return (
    <div
      data-shape-overlay="true"
      className="absolute inset-0 pointer-events-none"
      style={{ zIndex: 5 }}
      onClick={onSelectModeBackdropClick}
    >
      {/* Shape-draw backdrop. A screen-space div (NOT a giant SVG rect inside the
          viewport-transformed SVG) so it never overlaps the floating CanvasToolbar
          (top-3, ~44px tall — we leave 60px of headroom). The previous 200000×200000
          SVG rect with pointer-events:'all' captured clicks across the entire stacking
          context, including over the toolbar. */}
      {shapeMode && (
        <div
          className="absolute inset-x-0 bottom-0"
          style={{ top: 60, pointerEvents: 'all', cursor: 'crosshair' }}
          onPointerDown={onBackdropPointerDown}
        />
      )}

      <svg
        className="absolute inset-0 w-full h-full overflow-visible"
        style={{
          transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.zoom})`,
          transformOrigin: '0 0',
          pointerEvents: 'none',
          cursor: shapeMode ? 'crosshair' : (drag?.mode === 'connect' ? 'crosshair' : 'default'),
        }}
      >
        {sortedShapes.map((s) => (
          <ShapeRenderer
            key={s.id}
            shape={s}
            selected={s.id === selectedShapeId}
            interactive={canvasMode.kind === 'select'}
            nodeBounds={nodeBounds}
            allShapes={shapes}
            onPointerDown={(e) => onShapePointerDown(e, s)}
            onResizePointerDown={(e, handle) => onResizeHandlePointerDown(e, s, handle)}
            onDockPointerDown={onDockPointerDown}
          />
        ))}

        {/* Element dock dots: show on the node the pointer is currently over (or every node
            during a connect drag, so the user can clearly see drop targets). */}
        {showElementDocks && nodes.map((n) => {
          const isVisible = drag?.mode === 'connect' || hoverNodeId === n.id;
          if (!isVisible) return null;
          return (
            <ElementDocks
              key={n.id}
              nodeId={n.id}
              bounds={nodeBounds.get(n.id)}
              onDockPointerDown={onDockPointerDown}
            />
          );
        })}

        {drag?.mode === 'draw' && <DragPreview drag={drag} />}
        {drag?.mode === 'connect' && (
          <line x1={anchorPoint(drag.from, nodeBounds, shapes).x}
                y1={anchorPoint(drag.from, nodeBounds, shapes).y}
                x2={drag.cursorX} y2={drag.cursorY}
                stroke="rgb(99 102 241)" strokeWidth={2} strokeDasharray="4 4" />
        )}
      </svg>
    </div>
  );
}

// ---------- Geometry helpers ----------

export function translateShape(s: Shape, dx: number, dy: number): Shape {
  switch (s.kind) {
    case 'rect': case 'ellipse': case 'image':
      return { ...s, x: s.x + dx, y: s.y + dy } as Shape;
    case 'label':
      return { ...s, x: s.x + dx, y: s.y + dy } as Shape;
    case 'arrow':
      return {
        ...s,
        fromX: s.fromX + dx, fromY: s.fromY + dy,
        toX: s.toX + dx, toY: s.toY + dy,
        // An anchored arrow that is dragged loses its anchors and becomes a free-coord arrow.
        fromAnchor: s.fromAnchor?.kind === 'free' ? { kind: 'free', x: s.fromX + dx, y: s.fromY + dy } : s.fromAnchor,
        toAnchor: s.toAnchor?.kind === 'free' ? { kind: 'free', x: s.toX + dx, y: s.toY + dy } : s.toAnchor,
      } as Shape;
  }
}

export function resizeShape(s: Shape, handle: ResizeHandle, dx: number, dy: number): Shape | null {
  if (s.kind === 'arrow' || s.kind === 'label') return null;
  const r = s as ShapeRect | ShapeEllipse | ShapeImage;
  let { x, y, w, h } = r;
  const minW = 20, minH = 20;
  if (handle.includes('w')) { x = r.x + dx; w = r.w - dx; }
  if (handle.includes('e')) { w = r.w + dx; }
  if (handle.includes('n')) { y = r.y + dy; h = r.h - dy; }
  if (handle.includes('s')) { h = r.h + dy; }
  if (w < minW) { if (handle.includes('w')) x -= minW - w; w = minW; }
  if (h < minH) { if (handle.includes('n')) y -= minH - h; h = minH; }
  return { ...r, x, y, w, h } as Shape;
}

function findNodeUnder(x: number, y: number, bounds: Map<string, { x: number; y: number; w: number; h: number }>): string | null {
  for (const [id, b] of bounds) {
    if (x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) return id;
  }
  return null;
}

function findShapeUnder(x: number, y: number, shapes: readonly Shape[]): Shape | null {
  for (let i = shapes.length - 1; i >= 0; i--) {
    const s = shapes[i];
    if (s.kind === 'rect' || s.kind === 'ellipse' || s.kind === 'image') {
      const r = s as ShapeRect | ShapeEllipse | ShapeImage;
      if (x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) return s;
    }
  }
  return null;
}

function shapeCenter(s: Shape): { x: number; y: number } {
  switch (s.kind) {
    case 'rect': case 'ellipse': case 'image':
      return { x: (s as ShapeRect).x + (s as ShapeRect).w / 2, y: (s as ShapeRect).y + (s as ShapeRect).h / 2 };
    case 'label':
      return { x: (s as ShapeLabel).x, y: (s as ShapeLabel).y };
    case 'arrow':
      return { x: ((s as ShapeArrow).fromX + (s as ShapeArrow).toX) / 2,
               y: ((s as ShapeArrow).fromY + (s as ShapeArrow).toY) / 2 };
  }
}

function anchorPoint(
  a: ArrowAnchor,
  nodeBounds: Map<string, { x: number; y: number; w: number; h: number }>,
  shapes: readonly Shape[],
): { x: number; y: number } {
  if (a.kind === 'free') return { x: a.x, y: a.y };
  if (a.kind === 'element') {
    const b = nodeBounds.get(a.id);
    if (!b) return { x: 0, y: 0 };
    return { x: b.x + b.w / 2, y: b.y + b.h / 2 };
  }
  // shape
  const s = shapes.find((x) => x.id === a.id);
  if (!s) return { x: 0, y: 0 };
  return shapeCenter(s);
}

/** Compute the closest edge intersection on a rectangle so an arrow ends at the border, not the centre. */
function edgePoint(box: { x: number; y: number; w: number; h: number }, towardX: number, towardY: number): { x: number; y: number } {
  const cx = box.x + box.w / 2;
  const cy = box.y + box.h / 2;
  const dx = towardX - cx;
  const dy = towardY - cy;
  if (dx === 0 && dy === 0) return { x: cx, y: cy };
  const tx = dx === 0 ? Infinity : (box.w / 2) / Math.abs(dx);
  const ty = dy === 0 ? Infinity : (box.h / 2) / Math.abs(dy);
  const t = Math.min(tx, ty);
  return { x: cx + dx * t, y: cy + dy * t };
}

// ---------- Renderers ----------

interface ShapeRendererProps {
  shape: Shape;
  selected: boolean;
  interactive: boolean;
  nodeBounds: Map<string, { x: number; y: number; w: number; h: number }>;
  allShapes: readonly Shape[];
  onPointerDown: (e: React.PointerEvent<SVGGElement>) => void;
  onResizePointerDown: (e: React.PointerEvent, handle: ResizeHandle) => void;
  onDockPointerDown: (e: React.PointerEvent, anchor: ArrowAnchor, fromX: number, fromY: number) => void;
}

function ShapeRenderer({ shape, selected, interactive, nodeBounds, allShapes, onPointerDown, onResizePointerDown, onDockPointerDown }: ShapeRendererProps) {
  const stroke = (s: { strokeStyle?: 'solid' | 'dashed' | 'dotted' }) => {
    switch (s.strokeStyle) {
      case 'dashed': return '6 6';
      case 'dotted': return '1 4';
      default: return undefined;
    }
  };
  const cursor = interactive ? 'move' : 'default';
  const handler = interactive ? onPointerDown : undefined;

  switch (shape.kind) {
    case 'rect': {
      const r = shape as ShapeRect;
      return (
        <g style={{ cursor }}>
          <g onPointerDown={handler} style={{ pointerEvents: 'auto' }}>
            <rect x={r.x} y={r.y} width={r.w} height={r.h}
              rx={r.rounded ? 12 : 0} ry={r.rounded ? 12 : 0}
              fill={r.fill} stroke={r.stroke} strokeWidth={r.strokeWidth}
              strokeDasharray={stroke(r)} />
            {r.label && <text x={r.x + 8} y={r.y + 18} fontSize="12" fill={r.stroke} style={{ userSelect: 'none' }}>{r.label}</text>}
          </g>
          {selected && interactive && <SelectionFrame x={r.x} y={r.y} w={r.w} h={r.h} onResize={onResizePointerDown} />}
          {selected && interactive && <ShapeDocks shape={r} onDockPointerDown={onDockPointerDown} />}
        </g>
      );
    }
    case 'ellipse': {
      const e = shape as ShapeEllipse;
      return (
        <g style={{ cursor }}>
          <g onPointerDown={handler} style={{ pointerEvents: 'auto' }}>
            <ellipse cx={e.x + e.w / 2} cy={e.y + e.h / 2} rx={e.w / 2} ry={e.h / 2}
              fill={e.fill} stroke={e.stroke} strokeWidth={e.strokeWidth}
              strokeDasharray={stroke(e)} />
            {e.label && <text x={e.x + e.w / 2} y={e.y + e.h / 2} textAnchor="middle" fontSize="12" fill={e.stroke} style={{ userSelect: 'none' }}>{e.label}</text>}
          </g>
          {selected && interactive && <SelectionFrame x={e.x} y={e.y} w={e.w} h={e.h} onResize={onResizePointerDown} />}
          {selected && interactive && <ShapeDocks shape={e} onDockPointerDown={onDockPointerDown} />}
        </g>
      );
    }
    case 'label': {
      const l = shape as ShapeLabel;
      const approxW = Math.max(40, l.text.length * (l.fontSize * 0.6));
      const approxH = l.fontSize * 1.4;
      return (
        <g style={{ cursor }}>
          <g onPointerDown={handler} style={{ pointerEvents: 'auto' }}>
            <rect x={l.x - 4} y={l.y - approxH * 0.8} width={approxW + 8} height={approxH} fill="transparent" />
            <text x={l.x} y={l.y} fontSize={l.fontSize} fill={l.color} style={{ userSelect: 'none' }}>{l.text}</text>
          </g>
          {selected && interactive && <SelectionFrame x={l.x - 4} y={l.y - approxH * 0.8} w={approxW + 8} h={approxH} />}
        </g>
      );
    }
    case 'arrow': {
      const a = shape as ShapeArrow;
      // Resolve anchor positions; fall back to the snapshot coords if the target is missing.
      let fromPt = a.fromAnchor ? anchorPointResolved(a.fromAnchor, nodeBounds, allShapes, { x: a.fromX, y: a.fromY }) : { x: a.fromX, y: a.fromY };
      let toPt = a.toAnchor ? anchorPointResolved(a.toAnchor, nodeBounds, allShapes, { x: a.toX, y: a.toY }) : { x: a.toX, y: a.toY };
      // Pull endpoints to the bounding-box edge so arrows don't cross into the target.
      const fromAnchor = a.fromAnchor;
      if (fromAnchor?.kind === 'element') {
        const b = nodeBounds.get(fromAnchor.id);
        if (b) fromPt = edgePoint(b, toPt.x, toPt.y);
      } else if (fromAnchor?.kind === 'shape') {
        const s = allShapes.find((x) => x.id === fromAnchor.id);
        if (s && (s.kind === 'rect' || s.kind === 'ellipse' || s.kind === 'image')) {
          fromPt = edgePoint(s as ShapeRect, toPt.x, toPt.y);
        }
      }
      const toAnchor = a.toAnchor;
      if (toAnchor?.kind === 'element') {
        const b = nodeBounds.get(toAnchor.id);
        if (b) toPt = edgePoint(b, fromPt.x, fromPt.y);
      } else if (toAnchor?.kind === 'shape') {
        const s = allShapes.find((x) => x.id === toAnchor.id);
        if (s && (s.kind === 'rect' || s.kind === 'ellipse' || s.kind === 'image')) {
          toPt = edgePoint(s as ShapeRect, fromPt.x, fromPt.y);
        }
      }

      const arrowSize = 8 + a.strokeWidth;
      const dx = toPt.x - fromPt.x;
      const dy = toPt.y - fromPt.y;
      const ang = Math.atan2(dy, dx);
      const tipX = toPt.x, tipY = toPt.y;
      const baseX = tipX - Math.cos(ang) * arrowSize;
      const baseY = tipY - Math.sin(ang) * arrowSize;
      const p1x = baseX + Math.cos(ang + Math.PI / 2) * (arrowSize / 2);
      const p1y = baseY + Math.sin(ang + Math.PI / 2) * (arrowSize / 2);
      const p2x = baseX - Math.cos(ang + Math.PI / 2) * (arrowSize / 2);
      const p2y = baseY - Math.sin(ang + Math.PI / 2) * (arrowSize / 2);
      return (
        <g style={{ cursor }}>
          <g onPointerDown={handler} style={{ pointerEvents: 'auto' }}>
            <line x1={fromPt.x} y1={fromPt.y} x2={toPt.x} y2={toPt.y}
              stroke="transparent" strokeWidth={Math.max(12, a.strokeWidth + 8)} />
            <line x1={fromPt.x} y1={fromPt.y} x2={toPt.x} y2={toPt.y}
              stroke={a.stroke} strokeWidth={a.strokeWidth} strokeDasharray={stroke(a)} />
            <polygon points={`${tipX},${tipY} ${p1x},${p1y} ${p2x},${p2y}`} fill={a.stroke} />
            {(() => {
              const label = arrowDisplayLabel(a);
              return label ? (
                <text x={(fromPt.x + toPt.x) / 2} y={(fromPt.y + toPt.y) / 2 - 6}
                  textAnchor="middle" fontSize="11" fill={a.stroke} style={{ userSelect: 'none' }}>{label}</text>
              ) : null;
            })()}
          </g>
          {selected && interactive && (
            <>
              <circle cx={fromPt.x} cy={fromPt.y} r={4} fill="rgb(99 102 241)" />
              <circle cx={toPt.x} cy={toPt.y} r={4} fill="rgb(99 102 241)" />
            </>
          )}
        </g>
      );
    }
    case 'image': {
      const im = shape as ShapeImage;
      return (
        <g style={{ cursor }}>
          <g onPointerDown={handler} style={{ pointerEvents: 'auto' }}>
            <rect x={im.x} y={im.y} width={im.w} height={im.h} fill="transparent" />
            <image href={im.src} x={im.x} y={im.y} width={im.w} height={im.h} style={{ pointerEvents: 'none' }} />
            {im.label && <text x={im.x + im.w / 2} y={im.y + im.h + 14} textAnchor="middle" fontSize="11" fill="rgb(63,63,70)" style={{ userSelect: 'none' }}>{im.label}</text>}
          </g>
          {selected && interactive && <SelectionFrame x={im.x} y={im.y} w={im.w} h={im.h} onResize={onResizePointerDown} />}
          {selected && interactive && <ShapeDocks shape={im} onDockPointerDown={onDockPointerDown} />}
        </g>
      );
    }
  }
}

function anchorPointResolved(
  a: ArrowAnchor,
  nodeBounds: Map<string, { x: number; y: number; w: number; h: number }>,
  shapes: readonly Shape[],
  fallback: { x: number; y: number },
): { x: number; y: number } {
  if (a.kind === 'free') return { x: a.x, y: a.y };
  if (a.kind === 'element') {
    const b = nodeBounds.get(a.id);
    return b ? { x: b.x + b.w / 2, y: b.y + b.h / 2 } : fallback;
  }
  const s = shapes.find((x) => x.id === a.id);
  return s ? shapeCenter(s) : fallback;
}

function SelectionFrame({ x, y, w, h, onResize }: {
  x: number; y: number; w: number; h: number;
  onResize?: (e: React.PointerEvent, handle: ResizeHandle) => void;
}) {
  const handles: Array<{ id: ResizeHandle; cx: number; cy: number }> = [
    { id: 'nw', cx: x, cy: y },
    { id: 'n',  cx: x + w / 2, cy: y },
    { id: 'ne', cx: x + w, cy: y },
    { id: 'e',  cx: x + w, cy: y + h / 2 },
    { id: 'se', cx: x + w, cy: y + h },
    { id: 's',  cx: x + w / 2, cy: y + h },
    { id: 'sw', cx: x, cy: y + h },
    { id: 'w',  cx: x, cy: y + h / 2 },
  ];
  return (
    <>
      <rect x={x - 3} y={y - 3} width={w + 6} height={h + 6}
        fill="none" stroke="rgb(99 102 241)" strokeWidth={1.5} strokeDasharray="4 4"
        style={{ pointerEvents: 'none' }} />
      {onResize && handles.map((h) => (
        <rect
          key={h.id}
          x={h.cx - 4} y={h.cy - 4} width={8} height={8}
          fill="white"
          stroke="rgb(99 102 241)"
          strokeWidth={1.5}
          style={{ pointerEvents: 'all', cursor: HANDLE_CURSORS[h.id] }}
          onPointerDown={(e) => onResize(e, h.id)}
        />
      ))}
    </>
  );
}

/** Four small dots on the midpoints of a shape — drag any one to start a connection. */
function ShapeDocks({ shape, onDockPointerDown }: {
  shape: ShapeRect | ShapeEllipse | ShapeImage;
  onDockPointerDown: (e: React.PointerEvent, anchor: ArrowAnchor, fromX: number, fromY: number) => void;
}) {
  const ds = [
    { side: 'top',    cx: shape.x + shape.w / 2, cy: shape.y },
    { side: 'right',  cx: shape.x + shape.w,     cy: shape.y + shape.h / 2 },
    { side: 'bottom', cx: shape.x + shape.w / 2, cy: shape.y + shape.h },
    { side: 'left',   cx: shape.x,               cy: shape.y + shape.h / 2 },
  ];
  return (
    <>
      {ds.map((d) => (
        <circle key={d.side} cx={d.cx} cy={d.cy} r={6}
          fill="rgb(99 102 241)" stroke="white" strokeWidth={1.5}
          style={{ pointerEvents: 'all', cursor: 'crosshair' }}
          onPointerDown={(e) => { e.stopPropagation(); onDockPointerDown(e, { kind: 'shape', id: shape.id }, d.cx, d.cy); }}
        />
      ))}
    </>
  );
}

/** Dock dots overlaid on a model element. Same visual language as shape docks
 *  (indigo) — there's only one way to start a relationship. */
function ElementDocks({ nodeId, bounds, onDockPointerDown }: {
  nodeId: string;
  bounds: { x: number; y: number; w: number; h: number } | undefined;
  onDockPointerDown: (e: React.PointerEvent, anchor: ArrowAnchor, fromX: number, fromY: number) => void;
}) {
  if (!bounds) return null;
  const ds = [
    { side: 'top',    cx: bounds.x + bounds.w / 2, cy: bounds.y },
    { side: 'right',  cx: bounds.x + bounds.w,     cy: bounds.y + bounds.h / 2 },
    { side: 'bottom', cx: bounds.x + bounds.w / 2, cy: bounds.y + bounds.h },
    { side: 'left',   cx: bounds.x,                cy: bounds.y + bounds.h / 2 },
  ];
  return (
    <>
      {ds.map((d) => (
        <circle key={d.side} cx={d.cx} cy={d.cy} r={5}
          fill="rgb(99 102 241)" stroke="white" strokeWidth={1.5}
          style={{ pointerEvents: 'all', cursor: 'crosshair', opacity: 0.85 }}
          onPointerDown={(e) => { e.stopPropagation(); onDockPointerDown(e, { kind: 'element', id: nodeId }, d.cx, d.cy); }}
        />
      ))}
    </>
  );
}

function DragPreview({ drag }: { drag: DraftDrag }) {
  const x = Math.min(drag.startX, drag.cur.x);
  const y = Math.min(drag.startY, drag.cur.y);
  const w = Math.abs(drag.cur.x - drag.startX);
  const h = Math.abs(drag.cur.y - drag.startY);
  if (drag.tool === 'rect') return <rect x={x} y={y} width={w} height={h} fill="rgba(99,102,241,0.05)" stroke="rgb(99 102 241)" strokeDasharray="4 4" rx={12} />;
  if (drag.tool === 'ellipse') return <ellipse cx={x + w / 2} cy={y + h / 2} rx={w / 2} ry={h / 2} fill="rgba(244,114,182,0.05)" stroke="rgb(244 114 182)" strokeDasharray="4 4" />;
  if (drag.tool === 'arrow') return <line x1={drag.startX} y1={drag.startY} x2={drag.cur.x} y2={drag.cur.y} stroke="rgb(63 63 70)" strokeWidth={2} strokeDasharray="4 4" />;
  return null;
}
