import { KNOCKOUT_MASK_ID, type CardBox } from '@/lib/edgeKnockout';

/**
 * The mask the publication profile applies to every edge path (B-023): white everywhere, each card's
 * box black. In the edges' own user space — flow units — so it moves and scales with the canvas, and
 * it is serialised with the rest of the `defs` into an exported SVG.
 */
export function EdgeKnockout({ rects }: { rects: CardBox[] }) {
  return (
    <svg width="0" height="0" aria-hidden style={{ position: 'absolute' }}>
      <defs>
        <mask id={KNOCKOUT_MASK_ID} maskUnits="userSpaceOnUse" x={-100000} y={-100000} width={200000} height={200000}>
          <rect x={-100000} y={-100000} width={200000} height={200000} fill="white" />
          {rects.map((r) => <rect key={r.id} x={r.x} y={r.y} width={r.w} height={r.h} fill="black" />)}
        </mask>
      </defs>
    </svg>
  );
}
