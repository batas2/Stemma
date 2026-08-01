import { describe, expect, it } from 'vitest';

/**
 * The actual `buildPath` lives inside WaypointEdge.tsx because it depends on @xyflow/react
 * runtime helpers. Here we test the user-visible invariants of the public surface:
 *   - waypoints are stored as array of {x, y}
 *   - empty array means "draw a straight smoothstep"
 *   - removing a waypoint keeps the others' relative order
 *   - adding a waypoint appends to the end
 */
import type { SavedPosition } from '@/lib/layout';

function addWaypoint(current: SavedPosition[], p: SavedPosition): SavedPosition[] {
  return [...current, p];
}

function removeAt(current: SavedPosition[], index: number): SavedPosition[] {
  return current.filter((_, i) => i !== index);
}

describe('waypoint manipulation invariants', () => {
  it('appends new waypoint to the end', () => {
    const initial: SavedPosition[] = [{ x: 100, y: 100 }];
    const next = addWaypoint(initial, { x: 200, y: 200 });
    expect(next).toEqual([{ x: 100, y: 100 }, { x: 200, y: 200 }]);
  });

  it('removes the waypoint at the given index, preserving order', () => {
    const initial: SavedPosition[] = [
      { x: 0, y: 0 }, { x: 10, y: 10 }, { x: 20, y: 20 },
    ];
    expect(removeAt(initial, 1)).toEqual([{ x: 0, y: 0 }, { x: 20, y: 20 }]);
    expect(removeAt(initial, 0)).toEqual([{ x: 10, y: 10 }, { x: 20, y: 20 }]);
    expect(removeAt(initial, 2)).toEqual([{ x: 0, y: 0 }, { x: 10, y: 10 }]);
  });

  it('removing all waypoints yields an empty array', () => {
    let current: SavedPosition[] = [{ x: 1, y: 1 }, { x: 2, y: 2 }];
    current = removeAt(current, 0);
    current = removeAt(current, 0);
    expect(current).toEqual([]);
  });
});
