import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import {
  BaseEdge, type EdgeProps, getBezierPath, getSmoothStepPath, getStraightPath,
  Position, useReactFlow, useStore,
} from '@xyflow/react';
import { ArrowLeft, ArrowRight, ChevronDown } from 'lucide-react';
import clsx from 'clsx';
import type { SavedPosition } from '@/lib/layout';
import { DEFAULT_EDGE_ROUTING, type EdgeLabelSize, type EdgeRouting } from '@/lib/edgeStyles';
import { RELATIONSHIP_TYPES, type RelationshipType } from '@/lib/relationshipTypes';

export interface WaypointEdgeData extends Record<string, unknown> {
  waypoints?: SavedPosition[];
  routing?: EdgeRouting;
  labelSize?: EdgeLabelSize;
  onAddWaypoint?: (edgeId: string, point: SavedPosition) => void;
  onRemoveWaypoint?: (edgeId: string, index: number) => void;
  // Inline label editing — when `editing` is true the label renders as an input. The draft value
  // lives in the app store so the inspector mirrors every keystroke.
  editing?: boolean;
  editValue?: string;
  onEditStart?: (edgeId: string) => void;
  onEditChange?: (edgeId: string, value: string) => void;
  onEditCommit?: (edgeId: string, value: string) => void;
  onEditCancel?: (edgeId: string) => void;
  // Selection toolbar — per-end arrowhead toggles and the relationship type picker.
  arrowStartActive?: boolean;
  arrowEndActive?: boolean;
  onToggleArrow?: (edgeId: string, end: 'start' | 'end') => void;
  typeValue?: string;
  onSetType?: (edgeId: string, t: RelationshipType) => void;
  /** The step a book page is on (F-020): its label is the one the room should be reading. */
  stepCurrent?: boolean;
  /**
   * A route the layout planned (F-021): every point from where the edge leaves its source to where it
   * meets its target, and the box kept clear for its label. Drawn as given, instead of between the
   * dock handles — the handles are where an unplanned edge attaches, not where a routed one does.
   */
  route?: { points: SavedPosition[]; label?: { x: number; y: number; w: number; h: number } };
  /** Its ends have not been placed yet by the layout; drawn when they are, so nothing jumps. */
  pending?: boolean;
}

/** The label layer of each canvas, found once. */
const labelLayers = new WeakMap<HTMLElement, HTMLElement>();

/**
 * React Flow's EdgeLabelRenderer, without its cost: that one looks the label layer up with
 * querySelector inside a store selector, so every edge searched the whole canvas on every store update
 * — 500 arrows made it the biggest cost of a drag, a keystroke in ⌘F and a rename. Here the layer is
 * found once per canvas, and an edge drawn before the layer exists tries again on the next frame.
 */
function EdgeLabelLayer({ children }: { children: ReactNode }) {
  const domNode = useStore((st) => st.domNode);
  const [, retry] = useState(0);
  let layer: HTMLElement | null = null;
  if (domNode) {
    const known = labelLayers.get(domNode);
    layer = known?.isConnected ? known : domNode.querySelector<HTMLElement>('.react-flow__edgelabel-renderer');
    if (layer) labelLayers.set(domNode, layer);
  }
  useEffect(() => {
    if (layer || !domNode) return;
    const frame = requestAnimationFrame(() => retry((n) => n + 1));
    return () => cancelAnimationFrame(frame);
  }, [layer, domNode]);
  return layer ? createPortal(children, layer) : null;
}

/** Which side of a box a line heading (dx, dy) leaves from — used to give bezier/step waypoint
 *  segments a sensible entry/exit direction. */
function sideOf(dx: number, dy: number): Position {
  return Math.abs(dx) >= Math.abs(dy)
    ? (dx >= 0 ? Position.Right : Position.Left)
    : (dy >= 0 ? Position.Bottom : Position.Top);
}

function segPath(
  routing: EdgeRouting,
  ax: number, ay: number, bx: number, by: number,
  aPos: Position, bPos: Position,
): string {
  const base = { sourceX: ax, sourceY: ay, targetX: bx, targetY: by };
  switch (routing) {
    case 'straight':
      return getStraightPath(base)[0];
    case 'step':
      return getSmoothStepPath({ ...base, sourcePosition: aPos, targetPosition: bPos, borderRadius: 0 })[0];
    case 'smoothstep':
      return getSmoothStepPath({ ...base, sourcePosition: aPos, targetPosition: bPos, borderRadius: 12 })[0];
    case 'bezier':
    default:
      return getBezierPath({ ...base, sourcePosition: aPos, targetPosition: bPos })[0];
  }
}

/**
 * Full edge path: (sx,sy) → waypoints → (tx,ty), each segment drawn with the chosen `routing`.
 * Endpoints are the dock-handle coordinates React Flow provides, so the line starts and ends
 * exactly on the connection dots. Exported for unit testing.
 */
export function buildEdgePath(
  routing: EdgeRouting,
  sx: number, sy: number, tx: number, ty: number,
  sPos: Position, tPos: Position,
  waypoints: SavedPosition[],
): string {
  if (waypoints.length === 0) return segPath(routing, sx, sy, tx, ty, sPos, tPos);
  const stops = [{ x: sx, y: sy }, ...waypoints, { x: tx, y: ty }];
  let d = '';
  for (let i = 0; i < stops.length - 1; i++) {
    const a = stops[i];
    const b = stops[i + 1];
    const aPos = i === 0 ? sPos : sideOf(b.x - a.x, b.y - a.y);
    const bPos = i === stops.length - 2 ? tPos : sideOf(a.x - b.x, a.y - b.y);
    const seg = segPath(routing, a.x, a.y, b.x, b.y, aPos, bPos);
    // Drop the leading "M x,y" of follow-on segments so they continue the current path.
    d += i === 0 ? seg : seg.replace(/^M[\s\d.,-]+/, '');
  }
  return d;
}

/**
 * A planned route as a path: straight runs with the corners rounded a little, so an orthogonal route
 * reads as one line turning rather than as segments meeting. The radius never exceeds half of either
 * run it joins, so a short jog stays a jog. Exported for unit testing.
 */
export function routePath(points: SavedPosition[], radius = 6): string {
  if (points.length === 0) return '';
  let d = `M ${points[0].x},${points[0].y}`;
  for (let i = 1; i < points.length - 1; i++) {
    const prev = points[i - 1], at = points[i], next = points[i + 1];
    const inLen = Math.hypot(at.x - prev.x, at.y - prev.y);
    const outLen = Math.hypot(next.x - at.x, next.y - at.y);
    const r = Math.min(radius, inLen / 2, outLen / 2);
    if (r <= 0.5) { d += ` L ${at.x},${at.y}`; continue; }
    const a = { x: at.x - ((at.x - prev.x) / inLen) * r, y: at.y - ((at.y - prev.y) / inLen) * r };
    const b = { x: at.x + ((next.x - at.x) / outLen) * r, y: at.y + ((next.y - at.y) / outLen) * r };
    d += ` L ${a.x},${a.y} Q ${at.x},${at.y} ${b.x},${b.y}`;
  }
  const last = points[points.length - 1];
  return points.length > 1 ? `${d} L ${last.x},${last.y}` : d;
}

const SELECT_COLOR = 'rgb(99 102 241)';

/** An edge label's size in pixels, by `EdgeStyle.labelSize`. */
export const LABEL_PX: Record<EdgeLabelSize, number> = { sm: 9, base: 10, lg: 13, xl: 16 };

export function WaypointEdge({
  id,
  sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition,
  label, style, data, markerStart, markerEnd, selected,
}: EdgeProps & { data?: WaypointEdgeData }) {
  const { screenToFlowPosition } = useReactFlow();
  const [typeMenuOpen, setTypeMenuOpen] = useState(false);
  const waypoints = data?.waypoints ?? [];
  const routing = data?.routing ?? DEFAULT_EDGE_ROUTING;
  const sPos = sourcePosition ?? Position.Bottom;
  const tPos = targetPosition ?? Position.Top;
  const baseWidth = Number(style?.strokeWidth) || 1.5;

  const route = data?.route;
  const pending = data?.pending === true;
  const path = useMemo(
    () => route && route.points.length > 1
      ? routePath(route.points)
      : buildEdgePath(routing, sourceX, sourceY, targetX, targetY, sPos, tPos, waypoints),
    [route, routing, sourceX, sourceY, targetX, targetY, sPos, tPos, waypoints],
  );
  // Where the ends are actually drawn: a planned route's own ends, otherwise the dock handles.
  const ends = route && route.points.length > 1
    ? { s: route.points[0], t: route.points[route.points.length - 1] }
    : { s: { x: sourceX, y: sourceY }, t: { x: targetX, y: targetY } };

  // Under the publication profile a label has no plate, so a label sitting on its own line reads as
  // struck through. A planned route already keeps its label beside the line; an unplanned one is set
  // beside it here — above a line that runs across, to the right of one that runs down.
  const publication = typeof document !== 'undefined'
    && document.documentElement.getAttribute('data-stemma-profile') === 'publication';
  const across = Math.abs(targetX - sourceX) >= Math.abs(targetY - sourceY);
  const labelAnchor = publication && !route?.label && waypoints.length === 0
    ? (across ? 'translate(-50%, calc(-100% - 3px))' : 'translate(5px, -50%)')
    : 'translate(-50%, -50%)';

  const labelMid = route?.label
    ? { x: route.label.x + route.label.w / 2, y: route.label.y + route.label.h / 2 }
    : waypoints[Math.floor(waypoints.length / 2)] ?? { x: (sourceX + targetX) / 2, y: (sourceY + targetY) / 2 };

  function onPathDoubleClick(ev: React.MouseEvent<SVGPathElement>) {
    if (!ev.shiftKey || !data?.onAddWaypoint) return;
    const pt = screenToFlowPosition({ x: ev.clientX, y: ev.clientY });
    data.onAddWaypoint(id, { x: pt.x, y: pt.y });
    ev.stopPropagation();
  }

  if (pending) return null;

  return (
    <>
      {/* Selection halo — a soft wide indigo stroke behind the line so a selected relationship is
          obvious on the canvas, not just in the inspector. */}
      {selected && (
        <path
          d={path}
          fill="none"
          stroke={SELECT_COLOR}
          strokeOpacity={0.3}
          strokeWidth={baseWidth + 7}
          strokeLinecap="round"
          strokeLinejoin="round"
          style={{ pointerEvents: 'none' }}
        />
      )}
      {/* BaseEdge draws the visible path + per-edge markers; interactionWidth widens the hit-area. */}
      <BaseEdge
        id={id}
        path={path}
        style={{ ...style, fill: 'none', ...(selected ? { strokeWidth: baseWidth + 1 } : {}) }}
        markerStart={markerStart}
        markerEnd={markerEnd}
        interactionWidth={26}
      />
      {/* Extra wide target for shift+double-click waypoint editing. */}
      <path
        d={path}
        style={{ stroke: 'transparent', strokeWidth: 22, fill: 'none', cursor: 'crosshair', pointerEvents: 'stroke' }}
        onDoubleClick={onPathDoubleClick}
      />
      {/* Endpoint pins make the selected relationship's two docked ends pop. */}
      {selected && (
        <>
          <circle cx={ends.s.x} cy={ends.s.y} r={4.5} fill={SELECT_COLOR} stroke="white" strokeWidth={1.5} style={{ pointerEvents: 'none' }} />
          <circle cx={ends.t.x} cy={ends.t.y} r={4.5} fill={SELECT_COLOR} stroke="white" strokeWidth={1.5} style={{ pointerEvents: 'none' }} />
        </>
      )}
      <EdgeLabelLayer>
        {/* Selection toolbar — floats above the label midpoint and follows the line while nodes
            move. ← / → toggle the arrowhead at that end (click again to remove it); the dropdown
            picks a predefined relationship type (writes the model attribute + applies its style). */}
        {selected && !data?.editing && data?.onToggleArrow && (
          <div
            className="nodrag nopan"
            style={{
              position: 'absolute',
              transform: `translate(-50%, -100%) translate(${labelMid.x}px, ${labelMid.y - 14}px)`,
              pointerEvents: 'all', zIndex: 1000,
            }}
            onMouseDown={(ev) => ev.stopPropagation()}
            onClick={(ev) => ev.stopPropagation()}
            onDoubleClick={(ev) => ev.stopPropagation()}
          >
            <div className="flex items-center gap-0.5 rounded-md border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 shadow-md px-0.5 py-0.5">
              <button
                title="Toggle the arrowhead at the source end"
                aria-pressed={!!data.arrowStartActive}
                onClick={() => data.onToggleArrow?.(id, 'start')}
                className={clsx('p-1 rounded transition-colors',
                  data.arrowStartActive
                    ? 'bg-indigo-500/15 text-indigo-600 dark:text-indigo-300'
                    : 'text-zinc-500 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800')}
              >
                <ArrowLeft className="w-3 h-3" />
              </button>
              {data.onSetType && (
                <button
                  title="Relationship type"
                  onClick={() => setTypeMenuOpen((o) => !o)}
                  className={clsx('px-1.5 py-0.5 rounded flex items-center gap-1 text-[10px] font-medium transition-colors max-w-[96px]',
                    typeMenuOpen
                      ? 'bg-indigo-500/15 text-indigo-600 dark:text-indigo-300'
                      : 'text-zinc-600 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800')}
                >
                  <span className="truncate">{data.typeValue || 'type'}</span>
                  <ChevronDown className="w-2.5 h-2.5 shrink-0" />
                </button>
              )}
              <button
                title="Toggle the arrowhead at the target end"
                aria-pressed={!!data.arrowEndActive}
                onClick={() => data.onToggleArrow?.(id, 'end')}
                className={clsx('p-1 rounded transition-colors',
                  data.arrowEndActive
                    ? 'bg-indigo-500/15 text-indigo-600 dark:text-indigo-300'
                    : 'text-zinc-500 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800')}
              >
                <ArrowRight className="w-3 h-3" />
              </button>
            </div>
            {typeMenuOpen && data.onSetType && (
              <div className="absolute left-1/2 -translate-x-1/2 mt-1 w-[200px] rounded-md border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 shadow-lg py-1">
                {RELATIONSHIP_TYPES.map((t) => (
                  <button
                    key={t.value}
                    onClick={() => { setTypeMenuOpen(false); data.onSetType?.(id, t); }}
                    className={clsx('w-full px-2 py-1.5 flex items-center gap-2 text-left hover:bg-zinc-100 dark:hover:bg-zinc-800',
                      data.typeValue === t.value && 'bg-indigo-500/10')}
                  >
                    <span
                      className="block w-7 shrink-0"
                      style={{ borderTop: `${Math.min(t.style.thickness ?? 1.5, 3)}px ${t.style.lineStyle ?? 'solid'} ${t.style.color ?? '#71717a'}` }}
                    />
                    <span className="min-w-0">
                      <span className="block text-[11px] font-medium text-zinc-800 dark:text-zinc-100">{t.value}</span>
                      <span className="block text-[10px] text-zinc-500 dark:text-zinc-400 truncate">{t.hint}</span>
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
        {data?.editing ? (
          <input
            autoFocus
            value={data.editValue ?? ''}
            onFocus={(ev) => ev.currentTarget.select()}
            onChange={(ev) => data.onEditChange?.(id, ev.target.value)}
            onKeyDown={(ev) => {
              ev.stopPropagation();
              if (ev.key === 'Enter') data.onEditCommit?.(id, ev.currentTarget.value);
              else if (ev.key === 'Escape') data.onEditCancel?.(id);
            }}
            onBlur={(ev) => data.onEditCommit?.(id, ev.currentTarget.value)}
            onMouseDown={(ev) => ev.stopPropagation()}
            onClick={(ev) => ev.stopPropagation()}
            onDoubleClick={(ev) => ev.stopPropagation()}
            className="nodrag nopan dark:!bg-zinc-900 dark:!text-zinc-100"
            style={{
              position: 'absolute', transform: `translate(-50%, -50%) translate(${labelMid.x}px, ${labelMid.y}px)`,
              pointerEvents: 'all', fontSize: 10, padding: '1px 4px',
              width: Math.max(64, (data.editValue?.length ?? 0) * 6.5 + 16),
              background: 'white', border: `1px solid ${SELECT_COLOR}`, borderRadius: 3,
              color: SELECT_COLOR, fontWeight: 600, outline: 'none', textAlign: 'center',
              boxShadow: '0 0 0 3px rgba(99,102,241,0.18)',
            }}
          />
        ) : label ? (
          <div
            style={{
              position: 'absolute', transform: `translate(${labelMid.x}px, ${labelMid.y}px) ${labelAnchor}`,
              pointerEvents: data?.onEditStart ? 'all' : 'none',
              cursor: data?.onEditStart ? 'text' : undefined,
              fontSize: LABEL_PX[data?.labelSize ?? 'base'] ?? 10, padding: '1px 4px',
              background: data?.stepCurrent ? '#f59e0b' : selected ? 'rgba(99,102,241,0.12)' : 'rgba(255,255,255,0.85)',
              border: `1px solid ${data?.stepCurrent ? '#d97706' : selected ? SELECT_COLOR : 'rgba(0,0,0,0.08)'}`, borderRadius: 3,
              color: data?.stepCurrent ? '#1c1917' : selected ? SELECT_COLOR : undefined,
              fontWeight: selected || data?.stepCurrent ? 600 : undefined,
              boxShadow: data?.stepCurrent ? '0 0 0 3px rgba(245,158,11,0.25)' : undefined,
              // A faded edge fades its label with it; a label left at full strength reads as lit.
              opacity: style?.opacity,
            }}
            className={data?.stepCurrent ? 'stemma-edge-label' : 'stemma-edge-label dark:!bg-zinc-900/85 dark:!text-zinc-200 dark:!border-zinc-700'}
            data-edge-id={id}
            title={data?.onEditStart ? 'Double-click to edit' : undefined}
            onDoubleClick={data?.onEditStart ? (ev) => { ev.stopPropagation(); data.onEditStart?.(id); } : undefined}
          >
            {label}
          </div>
        ) : null}
        {/* Handles only where they can be used: a read-only canvas shows the route, not its dots. */}
        {data?.onRemoveWaypoint && waypoints.map((w, i) => (
          <button
            key={i}
            onClick={(ev) => { ev.stopPropagation(); data?.onRemoveWaypoint?.(id, i); }}
            title="Click to remove waypoint"
            style={{
              position: 'absolute',
              transform: `translate(-50%, -50%) translate(${w.x}px, ${w.y}px)`,
              width: 10, height: 10, borderRadius: 5,
              background: 'rgb(99 102 241)', border: '2px solid white',
              boxShadow: '0 0 0 1px rgba(0,0,0,0.15)',
              cursor: 'pointer', padding: 0,
            }}
          />
        ))}
      </EdgeLabelLayer>
    </>
  );
}
