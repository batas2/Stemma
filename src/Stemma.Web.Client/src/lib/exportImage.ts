/**
 * Publication options for the canvas image export.
 *
 * These used to be four literals buried in the export handler — an opaque background taken from
 * `document.body`, a fixed 2× pixel ratio, and a fixed 12% padding. That made the one thing the
 * export is for outside the app impossible to ask for: a transparent PNG at a chosen scale, which
 * is what a diagram dropped onto a page whose background colour you do not control needs.
 *
 * They live here rather than inline so the resolution rules are testable without a DOM, and so the
 * headless renderer can reach exactly the same code path the toolbar button does. A second path
 * would be a second truth.
 */

export type ExportFormat = 'png' | 'svg';

/** What the caller asks for. Everything is optional; `resolveExportOptions` fills the gaps. */
export interface ExportRequest {
  format: ExportFormat;
  /** `true` writes no background at all. Omit (or `false`) to bake the page background in. */
  transparent?: boolean;
  /** Device-pixel multiplier. 2 is retina; 3–4 is for slides. Clamped to 1–4. */
  scale?: number;
  /** Padding around the content bounds, as a fraction of the fitted viewport. Clamped to 0–0.5. */
  padding?: number;
  /** Base filename without extension. */
  fileName?: string;
}

/** What the export actually runs with, after defaults and clamping. */
export interface ResolvedExportOptions {
  format: ExportFormat;
  /** `undefined` means "leave it transparent" — `html-to-image` writes no backdrop for it. */
  backgroundColor: string | undefined;
  pixelRatio: number;
  padding: number;
  fileName: string;
}

export const EXPORT_DEFAULTS = {
  /**
   * Opaque, matching what the button has always produced. Transparency is the background a
   * published diagram wants — it is the only one that works on both a light and a dark page, and
   * baking one in cannot be undone by whoever receives the file — but flipping the default would
   * silently change every existing user's export. It is a toggle instead, remembered between
   * sessions, and the publication profile will opt into it explicitly.
   */
  transparent: false,
  scale: 2,
  padding: 0.12,
  fileName: 'stemma',
} as const;

export const SCALE_MIN = 1;
export const SCALE_MAX = 4;
export const PADDING_MAX = 0.5;

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

/** Strip anything that would make a filename awkward on disk or in a URL. */
export function safeFileName(raw: string | undefined, fallback = EXPORT_DEFAULTS.fileName): string {
  const cleaned = (raw ?? '')
    .trim()
    .replace(/[^a-zA-Z0-9-_ ]+/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase();
  return cleaned || fallback;
}

/**
 * Fold a request into the concrete options the exporter runs with.
 *
 * `pageBackground` is what to bake in when the caller asked for an opaque image — normally the
 * computed background of `document.body`. A blank or missing value falls back to white rather than
 * producing an accidentally transparent "opaque" export.
 */
export function resolveExportOptions(req: ExportRequest, pageBackground?: string): ResolvedExportOptions {
  const transparent = req.transparent ?? EXPORT_DEFAULTS.transparent;
  const scale = Number.isFinite(req.scale) ? clamp(req.scale as number, SCALE_MIN, SCALE_MAX) : EXPORT_DEFAULTS.scale;
  const padding = Number.isFinite(req.padding) ? clamp(req.padding as number, 0, PADDING_MAX) : EXPORT_DEFAULTS.padding;

  return {
    format: req.format,
    backgroundColor: transparent ? undefined : (pageBackground?.trim() || '#ffffff'),
    pixelRatio: scale,
    padding,
    fileName: safeFileName(req.fileName),
  };
}

/** `<name>.<ext>`, ready for the download attribute. */
export function exportFileName(opts: ResolvedExportOptions): string {
  return `${opts.fileName}.${opts.format}`;
}
