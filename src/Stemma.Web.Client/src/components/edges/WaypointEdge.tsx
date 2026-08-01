import { useMemo, useState } from 'react';
import {
  BaseEdge, EdgeLabelRenderer, type EdgeProps, getBezierPath, getSmoothStepPath, getStraightPath,
  Position, useReactFlow,
} from '@xyflow/react';
import { ArrowLeft, ArrowRight, ChevronDown } from 'lucide-react';
import clsx from 'clsx';
import type { SavedPosition } from '@/lib/layout';
import { DEFAULT_EDGE_ROUTING, type EdgeRouting } from '@/lib/edgeStyles';
import { RELATIONSHIP_TYPES, type RelationshipType } from '@/lib/relationshipTypes';

export interface WaypointEdgeData extends Record<string, unknown> {
  waypoints?: SavedPosition[];
  routing?: EdgeRouting;
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

const SELECT_COLOR = 'rgb(99 102 241)';

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

  const path = useMemo(
    () => buildEdgePath(routing, sourceX, sourceY, targetX, targetY, sPos, tPos, waypoints),
    [routing, sourceX, sourceY, targetX, targetY, sPos, tPos, waypoints],
  );

  const labelMid = waypoints[Math.floor(waypoints.length / 2)] ?? { x: (sourceX + targetX) / 2, y: (sourceY + targetY) / 2 };

  function onPathDoubleClick(ev: React.MouseEvent<SVGPathElement>) {
    if (!ev.shiftKey || !data?.onAddWaypoint) return;
    const pt = screenToFlowPosition({ x: ev.clientX, y: ev.clientY });
    data.onAddWaypoint(id, { x: pt.x, y: pt.y });
    ev.stopPropagation();
  }

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
          <circle cx={sourceX} cy={sourceY} r={4.5} fill={SELECT_COLOR} stroke="white" strokeWidth={1.5} style={{ pointerEvents: 'none' }} />
          <circle cx={targetX} cy={targetY} r={4.5} fill={SELECT_COLOR} stroke="white" strokeWidth={1.5} style={{ pointerEvents: 'none' }} />
        </>
      )}
      <EdgeLabelRenderer>
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
              position: 'absolute', transform: `translate(-50%, -50%) translate(${labelMid.x}px, ${labelMid.y}px)`,
              pointerEvents: data?.onEditStart ? 'all' : 'none',
              cursor: data?.onEditStart ? 'text' : undefined,
              fontSize: 10, padding: '1px 4px',
              background: selected ? 'rgba(99,102,241,0.12)' : 'rgba(255,255,255,0.85)',
              border: `1px solid ${selected ? SELECT_COLOR : 'rgba(0,0,0,0.08)'}`, borderRadius: 3,
              color: selected ? SELECT_COLOR : undefined, fontWeight: selected ? 600 : undefined,
            }}
            className="dark:!bg-zinc-900/85 dark:!text-zinc-200 dark:!border-zinc-700"
            title={data?.onEditStart ? 'Double-click to edit' : undefined}
            onDoubleClick={data?.onEditStart ? (ev) => { ev.stopPropagation(); data.onEditStart?.(id); } : undefined}
          >
            {label}
          </div>
        ) : null}
        {waypoints.map((w, i) => (
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
      </EdgeLabelRenderer>
    </>
  );
}
