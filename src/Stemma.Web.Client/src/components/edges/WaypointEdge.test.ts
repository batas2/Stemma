import { describe, it, expect } from 'vitest';
import { Position } from '@xyflow/react';
import { buildEdgePath, routePath } from './WaypointEdge';

const S = { sx: 0, sy: 0, tx: 100, ty: 60 };

describe('buildEdgePath', () => {
  it('straight routing is a polyline (M…L), no curve', () => {
    const d = buildEdgePath('straight', S.sx, S.sy, S.tx, S.ty, Position.Right, Position.Left, []);
    expect(d.startsWith('M')).toBe(true);
    expect(d).toContain('L');
    expect(d).not.toContain('C');
  });

  it('bezier routing emits a cubic curve', () => {
    const d = buildEdgePath('bezier', S.sx, S.sy, S.tx, S.ty, Position.Right, Position.Left, []);
    expect(d).toContain('C');
  });

  it('step / smoothstep routings are orthogonal (contain straight segments)', () => {
    expect(buildEdgePath('step', S.sx, S.sy, S.tx, S.ty, Position.Right, Position.Left, [])).toContain('L');
    expect(buildEdgePath('smoothstep', S.sx, S.sy, S.tx, S.ty, Position.Right, Position.Left, [])).toContain('L');
  });

  it('starts at the source dock and reaches the target dock', () => {
    const d = buildEdgePath('straight', S.sx, S.sy, S.tx, S.ty, Position.Right, Position.Left, []).replace(/\s/g, '');
    expect(d.startsWith('M0,0')).toBe(true);
    expect(d).toContain('100,60');
  });

  it('routes through intermediate waypoints', () => {
    const d = buildEdgePath('straight', S.sx, S.sy, S.tx, S.ty, Position.Right, Position.Left, [{ x: 50, y: -40 }]);
    expect(d.replace(/\s/g, '')).toContain('50,-40');
  });
});

describe('routePath', () => {
  it('starts and ends where the planned route does', () => {
    const d = routePath([{ x: 0, y: 0 }, { x: 0, y: 40 }, { x: 80, y: 40 }]).replace(/\s+/g, ' ');
    expect(d.startsWith('M 0,0')).toBe(true);
    expect(d.endsWith('L 80,40')).toBe(true);
  });

  it('rounds a corner, never by more than half the shorter run', () => {
    const d = routePath([{ x: 0, y: 0 }, { x: 0, y: 4 }, { x: 80, y: 4 }]);
    // The vertical run is 4 long: the curve may start no earlier than 2 before the corner.
    expect(d).toContain('L 0,2 Q 0,4 2,4');
  });

  it('draws a straight route as one line', () => {
    expect(routePath([{ x: 0, y: 0 }, { x: 50, y: 0 }])).toBe('M 0,0 L 50,0');
  });
});
