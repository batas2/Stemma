/**
 * Named export palettes.
 *
 * A palette is a *render argument*, not workspace state — the same category as `--scale 2`. It is
 * deliberately not a section duplicated into every workspace: a site's diagrams live in dozens of
 * per-post workspaces, and a palette copied into each of them drifts from the site exactly the way
 * a diagram drifts from the code. The workspace may name one; it does not own one.
 *
 * What ships here is the *technique*, never a brand. The interesting constraint behind a
 * publication palette is general: when a diagram is exported with a transparent background, the
 * author does not control the page it lands on, so one ink has to stay legible on both a light and
 * a dark ground. No colour clears 4.5:1 against both ends of that range; the balanced optimum sits
 * near 4.3:1, and `dual-theme` is that optimum. A site with its own accent overrides the accent.
 */

export interface Palette {
  name: string;
  description: string;
  /** Lines, borders and body text. */
  stroke: string;
  /** Title text. Usually the same as `stroke`; separated so a palette can lift titles. */
  text: string;
  /** The single colour for the one thing the diagram is about. */
  accent: string;
  /** Node fill. `'none'` means outline-only, which is the only fill that survives both grounds. */
  fill: string;
  /** Page background. `null` means transparent. */
  background: string | null;
}

export const PALETTES: Record<string, Palette> = {
  'dual-theme': {
    name: 'dual-theme',
    description:
      'One ink legible on both a light and a dark page. For diagrams exported transparent, where the destination background is unknown.',
    stroke: '#767884',
    text: '#767884',
    accent: '#6366e8',
    fill: 'none',
    background: null,
  },
  print: {
    name: 'print',
    description: 'Dark ink on opaque white. For PDFs and anything that will be physically printed.',
    stroke: '#3f3f46',
    text: '#18181b',
    accent: '#4338ca',
    fill: 'none',
    background: '#ffffff',
  },
  slide: {
    name: 'slide',
    description: 'Heavier strokes and lifted titles, for a diagram read from the back of a room.',
    stroke: '#52525b',
    text: '#18181b',
    accent: '#4f46e5',
    fill: 'none',
    background: null,
  },
};

export const DEFAULT_PALETTE = 'dual-theme';

export function resolvePalette(name: string | null | undefined): Palette {
  return PALETTES[name ?? ''] ?? PALETTES[DEFAULT_PALETTE];
}

/** CSS custom properties the publication stylesheet reads. */
export function paletteCssVars(p: Palette): Record<string, string> {
  return {
    '--pub-stroke': p.stroke,
    '--pub-text': p.text,
    '--pub-accent': p.accent,
    '--pub-fill': p.fill,
  };
}

/**
 * Apply (or clear) a palette on the document root.
 *
 * Returns the resolved palette so a caller can also use its `background` — that one is not a CSS
 * variable because it is the *export's* backdrop, not the page's.
 */
export function applyPalette(name: string | null | undefined): Palette {
  const p = resolvePalette(name);
  if (typeof document !== 'undefined') {
    const style = document.documentElement.style;
    for (const [k, v] of Object.entries(paletteCssVars(p))) style.setProperty(k, v);
  }
  return p;
}
