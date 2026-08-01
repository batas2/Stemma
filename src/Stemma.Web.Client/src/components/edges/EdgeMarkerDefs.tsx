export interface CustomMarker { id: string; type: 'circle' | 'diamond' | 'pipe'; color: string; }

export const DEFAULT_MARKER_COLOR = '#94a3b8';

/** Stable marker id per (shape, colour). Colours are baked in (not `context-stroke`, which proved
 *  unreliable) so the markers are always visible and match the edge colour. */
export function customMarkerId(type: CustomMarker['type'], color: string | undefined): string {
  return `stemma-${type}-${(color ?? DEFAULT_MARKER_COLOR).replace(/[^a-z0-9]/gi, '')}`;
}

function MarkerShape({ type, color }: { type: CustomMarker['type']; color: string }) {
  if (type === 'circle') return <circle cx={6} cy={6} r={4.2} fill={color} />;
  if (type === 'diamond') return <path d="M1,6 L6,1 L11,6 L6,11 z" fill={color} />;
  return <path d="M9,1 L9,11" stroke={color} strokeWidth={2.2} fill="none" />; // pipe / bar
}

/** Custom endpoint markers (circle / diamond / bar) for relationships. The common arrow / open
 *  ends use React Flow's own built-in markers. Pass the set of (shape, colour) combos in use. */
export function EdgeMarkerDefs({ markers }: { markers: CustomMarker[] }) {
  return (
    <svg width="0" height="0" aria-hidden style={{ position: 'absolute' }}>
      <defs>
        {markers.map((m) => (
          <marker
            key={m.id}
            id={m.id}
            viewBox="0 0 12 12"
            refX={m.type === 'circle' ? 6 : m.type === 'pipe' ? 9 : 11}
            refY={6}
            markerWidth={12}
            markerHeight={12}
            markerUnits="userSpaceOnUse"
            orient="auto-start-reverse"
          >
            <MarkerShape type={m.type} color={m.color} />
          </marker>
        ))}
      </defs>
    </svg>
  );
}
