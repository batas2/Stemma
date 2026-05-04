import { useMemo } from 'react';
import {
  EdgeLabelRenderer, type EdgeProps, getSmoothStepPath, useReactFlow,
} from '@xyflow/react';
import type { SavedPosition } from '@/lib/layout';

export interface WaypointEdgeData extends Record<string, unknown> {
  waypoints?: SavedPosition[];
  onAddWaypoint?: (edgeId: string, point: SavedPosition) => void;
  onRemoveWaypoint?: (edgeId: string, index: number) => void;
}

/**
 * SVG path through (sourceX, sourceY) → waypoints → (targetX, targetY) using
 * `getSmoothStepPath` between each successive pair so the line keeps the rest of
 * the canvas's smoothstep aesthetic.
 */
function buildPath(
  sourceX: number, sourceY: number,
  targetX: number, targetY: number,
  waypoints: SavedPosition[]
): string {
  if (waypoints.length === 0) {
    const [path] = getSmoothStepPath({ sourceX, sourceY, targetX, targetY });
    return path;
  }
  const stops = [
    { x: sourceX, y: sourceY },
    ...waypoints,
    { x: targetX, y: targetY },
  ];
  let d = '';
  for (let i = 0; i < stops.length - 1; i++) {
    const [seg] = getSmoothStepPath({
      sourceX: stops[i].x, sourceY: stops[i].y,
      targetX: stops[i + 1].x, targetY: stops[i + 1].y,
    });
    d += (i === 0 ? seg : seg.replace(/^M[^L]*/, ''));
  }
  return d;
}

export function WaypointEdge({
  id, sourceX, sourceY, targetX, targetY, label, style, data, selected,
}: EdgeProps & { data?: WaypointEdgeData }) {
  const { screenToFlowPosition } = useReactFlow();
  const waypoints = data?.waypoints ?? [];
  const path = useMemo(() => buildPath(sourceX, sourceY, targetX, targetY, waypoints), [sourceX, sourceY, targetX, targetY, waypoints]);

  const labelMid = waypoints[Math.floor(waypoints.length / 2)] ?? { x: (sourceX + targetX) / 2, y: (sourceY + targetY) / 2 };

  function onPathDoubleClick(ev: React.MouseEvent<SVGPathElement>) {
    if (!ev.shiftKey || !data?.onAddWaypoint) return;
    const pt = screenToFlowPosition({ x: ev.clientX, y: ev.clientY });
    data.onAddWaypoint(id, { x: pt.x, y: pt.y });
    ev.stopPropagation();
  }

  return (
    <>
      <path
        id={id}
        d={path}
        style={{ ...style, fill: 'none' }}
        className={selected ? 'react-flow__edge-path' : 'react-flow__edge-path'}
        markerEnd="url(#xy-edge__arrowclosed)"
        onDoubleClick={onPathDoubleClick}
      />
      {/* Invisible wider hit-target so shift+double-click is easy. */}
      <path
        d={path}
        style={{ stroke: 'transparent', strokeWidth: 16, fill: 'none', cursor: 'crosshair' }}
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
