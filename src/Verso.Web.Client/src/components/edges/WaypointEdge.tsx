import { useMemo } from 'react';
import {
  BaseEdge, EdgeLabelRenderer, type EdgeProps, getStraightPath,
  type InternalNode, useInternalNode, useReactFlow,
} from '@xyflow/react';
import type { SavedPosition } from '@/lib/layout';

export interface WaypointEdgeData extends Record<string, unknown> {
  waypoints?: SavedPosition[];
  onAddWaypoint?: (edgeId: string, point: SavedPosition) => void;
  onRemoveWaypoint?: (edgeId: string, index: number) => void;
}

interface Box { cx: number; cy: number; hw: number; hh: number; }

function nodeBox(n: InternalNode): Box {
  const w = n.measured?.width ?? n.width ?? 200;
  const h = n.measured?.height ?? n.height ?? 60;
  const x = n.internals.positionAbsolute.x;
  const y = n.internals.positionAbsolute.y;
  return { cx: x + w / 2, cy: y + h / 2, hw: w / 2, hh: h / 2 };
}

/**
 * Where the ray from a box centre toward `toward` exits the box rectangle. This is the
 * "floating edge" endpoint: edges dock on the box BOUNDARY (where the handle circles sit)
 * instead of a fixed handle, so the arrowhead always lands on the visible edge of the box
 * and never disappears behind it.
 */
function boundaryPoint(box: Box, toward: { x: number; y: number }): SavedPosition {
  const dx = toward.x - box.cx;
  const dy = toward.y - box.cy;
  if (dx === 0 && dy === 0) return { x: box.cx, y: box.cy };
  const scale = Math.min(
    dx !== 0 ? box.hw / Math.abs(dx) : Infinity,
    dy !== 0 ? box.hh / Math.abs(dy) : Infinity,
  );
  return { x: box.cx + dx * scale, y: box.cy + dy * scale };
}

/** Straight polyline source → waypoints → target. Floating endpoints already sit on the boxes'
 *  boundaries, so a straight line keeps the arrowhead pointing cleanly into the box. */
function buildPath(sx: number, sy: number, tx: number, ty: number, waypoints: SavedPosition[]): string {
  if (waypoints.length === 0) {
    const [p] = getStraightPath({ sourceX: sx, sourceY: sy, targetX: tx, targetY: ty });
    return p;
  }
  const stops = [{ x: sx, y: sy }, ...waypoints, { x: tx, y: ty }];
  return stops.map((s, i) => `${i === 0 ? 'M' : 'L'}${s.x},${s.y}`).join(' ');
}

export function WaypointEdge({
  id, source, target,
  sourceX, sourceY, targetX, targetY,
  label, style, data, markerStart, markerEnd, selected,
}: EdgeProps & { data?: WaypointEdgeData }) {
  const { screenToFlowPosition } = useReactFlow();
  const sourceNode = useInternalNode(source);
  const targetNode = useInternalNode(target);
  const waypoints = data?.waypoints ?? [];

  // Floating dock points on each box boundary. Fall back to React Flow's handle coords if a
  // node hasn't been measured yet.
  const { sx, sy, tx, ty } = useMemo(() => {
    if (!sourceNode || !targetNode) return { sx: sourceX, sy: sourceY, tx: targetX, ty: targetY };
    const sBox = nodeBox(sourceNode);
    const tBox = nodeBox(targetNode);
    const sp = boundaryPoint(sBox, waypoints[0] ?? { x: tBox.cx, y: tBox.cy });
    const tp = boundaryPoint(tBox, waypoints[waypoints.length - 1] ?? { x: sBox.cx, y: sBox.cy });
    return { sx: sp.x, sy: sp.y, tx: tp.x, ty: tp.y };
  }, [sourceNode, targetNode, sourceX, sourceY, targetX, targetY, waypoints]);

  const path = useMemo(() => buildPath(sx, sy, tx, ty, waypoints), [sx, sy, tx, ty, waypoints]);

  const labelMid = waypoints[Math.floor(waypoints.length / 2)] ?? { x: (sx + tx) / 2, y: (sy + ty) / 2 };
  const dockColor = (style?.stroke as string) ?? '#94a3b8';

  function onPathDoubleClick(ev: React.MouseEvent<SVGPathElement>) {
    if (!ev.shiftKey || !data?.onAddWaypoint) return;
    const pt = screenToFlowPosition({ x: ev.clientX, y: ev.clientY });
    data.onAddWaypoint(id, { x: pt.x, y: pt.y });
    ev.stopPropagation();
  }

  return (
    <>
      {/* Dock markers — small rings on each box boundary so it's visible where the relationship
          connects (the arrowhead, drawn by BaseEdge below, overlays the target dock). */}
      <circle cx={sx} cy={sy} r={selected ? 4.5 : 3.5} fill={dockColor} stroke="white" strokeWidth={1.25} />
      <circle cx={tx} cy={ty} r={selected ? 4.5 : 3.5} fill="none" stroke={dockColor} strokeWidth={1.5} />
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
