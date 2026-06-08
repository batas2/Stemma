import { useMemo } from 'react';
import {
  BaseEdge, EdgeLabelRenderer, type EdgeProps, getBezierPath, getSmoothStepPath, getStraightPath,
  Position, useReactFlow,
} from '@xyflow/react';
import type { SavedPosition } from '@/lib/layout';
import { DEFAULT_EDGE_ROUTING, type EdgeRouting } from '@/lib/edgeStyles';

export interface WaypointEdgeData extends Record<string, unknown> {
  waypoints?: SavedPosition[];
  routing?: EdgeRouting;
  onAddWaypoint?: (edgeId: string, point: SavedPosition) => void;
  onRemoveWaypoint?: (edgeId: string, index: number) => void;
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

export function WaypointEdge({
  id,
  sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition,
  label, style, data, markerStart, markerEnd,
}: EdgeProps & { data?: WaypointEdgeData }) {
  const { screenToFlowPosition } = useReactFlow();
  const waypoints = data?.waypoints ?? [];
  const routing = data?.routing ?? DEFAULT_EDGE_ROUTING;
  const sPos = sourcePosition ?? Position.Bottom;
  const tPos = targetPosition ?? Position.Top;

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
      {/* BaseEdge draws the visible path + per-edge markers; interactionWidth widens the hit-area. */}
      <BaseEdge
        id={id}
        path={path}
        style={{ ...style, fill: 'none' }}
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
      <EdgeLabelRenderer>
        {label ? (
          <div
            style={{
              position: 'absolute', transform: `translate(-50%, -50%) translate(${labelMid.x}px, ${labelMid.y}px)`,
              pointerEvents: 'none', fontSize: 10, padding: '1px 4px',
              background: 'rgba(255,255,255,0.85)', border: '1px solid rgba(0,0,0,0.08)', borderRadius: 3,
            }}
            className="dark:!bg-zinc-900/85 dark:!text-zinc-200 dark:!border-zinc-700"
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
