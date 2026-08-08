/**
 * The readiness contract between the canvas and whatever is capturing it.
 *
 * The previous approach — the capture script sleeping for a fixed number of milliseconds after each
 * step — is not a contract, it is a guess that happens to hold on one machine on one day. Eight
 * such guesses is how a render pipeline becomes flaky.
 *
 * Instead the page publishes its state on the root element, and the renderer waits for a value:
 *
 *     <html data-stemma-render="loading">   still settling
 *     <html data-stemma-render="ready">     nodes measured, fonts loaded, safe to capture
 *     <html data-stemma-render="empty">     nothing to draw — a real outcome, not a timeout
 *     <html data-stemma-render="error">     gave up; `data-stemma-render-error` says why
 *
 * `empty` matters as much as `ready`. Without it, "the view resolved to zero nodes" and "the page
 * never finished loading" look identical from outside, and the renderer has to wait for a timeout
 * to tell them apart — then usually guesses wrong.
 */

export type RenderState = 'loading' | 'ready' | 'empty' | 'error';

export const RENDER_STATE_ATTR = 'data-stemma-render';
export const RENDER_ERROR_ATTR = 'data-stemma-render-error';

/** Everything the canvas must be able to answer "yes" to before a capture is meaningful. */
export interface ReadinessInputs {
  /** A workspace is open. */
  workspaceOpen: boolean;
  /** The model has been read off disk. */
  archLoaded: boolean;
  /** The committed sidecar has been fetched — positions and styles are the real ones, not defaults. */
  sidecarPrimed: boolean;
  /** React Flow has measured every node. Until then, bounds and therefore the crop are wrong. */
  nodesMeasured: boolean;
  /**
   * The canvas transform has stopped moving. Fitting the view is an animation, and capturing
   * part-way through it crops to wherever the pan had got to — which is how the same view rendered
   * twice produced a 399x1200 image and a 1168x862 one.
   */
  viewportStable: boolean;
  /** Webfonts have settled. Capturing earlier bakes fallback metrics into the image. */
  fontsReady: boolean;
  /** How many nodes the active view resolved to. */
  nodeCount: number;
  /**
   * Consecutive polls that have seen zero nodes. Guards the gap between "the data finished
   * loading" and "React has drawn it": those are separate ticks, and for a moment in between every
   * other input is satisfied while the canvas is still empty.
   */
  zeroStreak: number;
}

/**
 * How many consecutive empty polls it takes to believe a view is genuinely empty.
 *
 * At the poll interval used by the shell this is a few hundred milliseconds — long enough to cover
 * the render tick after the last piece of data lands, short enough that a truly empty view is
 * reported promptly rather than waiting out the renderer's timeout.
 */
export const EMPTY_CONFIRM_POLLS = 5;

/**
 * How many consecutive polls the canvas transform must be unchanged before the picture counts as
 * still. Fitting the view animates over a few hundred milliseconds; this outlasts it without
 * hard-coding that duration, which the canvas is free to change.
 */
export const VIEWPORT_STABLE_POLLS = 4;

/**
 * Decide the state from the inputs. Pure, so the ordering rules are testable without a DOM.
 *
 * The rule that matters is that `empty` is *terminal* — the renderer stops on it — so it must never
 * be published on the way to `ready`. Data loading and painting finish on different ticks, and
 * announcing "nothing to draw" in that gap turns a good render into a confident failure.
 */
export function computeRenderState(i: ReadinessInputs): RenderState {
  if (!i.workspaceOpen || !i.archLoaded || !i.sidecarPrimed || !i.fontsReady) return 'loading';
  if (i.nodeCount > 0) return i.nodesMeasured && i.viewportStable ? 'ready' : 'loading';
  // A view with no nodes never measures any, so `nodesMeasured` cannot gate this branch or an
  // empty view would sit in `loading` until the renderer timed out.
  return i.zeroStreak >= EMPTY_CONFIRM_POLLS ? 'empty' : 'loading';
}

/** Publish a state on the document root. No-op outside a browser. */
export function publishRenderState(state: RenderState, error?: string): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  root.setAttribute(RENDER_STATE_ATTR, state);
  if (state === 'error' && error) root.setAttribute(RENDER_ERROR_ATTR, error);
  else root.removeAttribute(RENDER_ERROR_ATTR);
}

/** Current published state, or null if nothing has published one yet. */
export function readRenderState(): RenderState | null {
  if (typeof document === 'undefined') return null;
  return (document.documentElement.getAttribute(RENDER_STATE_ATTR) as RenderState | null) ?? null;
}

/** Resolves once webfonts have settled; resolves immediately where the API is absent. */
export function fontsReady(): Promise<void> {
  if (typeof document === 'undefined' || !('fonts' in document)) return Promise.resolve();
  return (document as Document & { fonts: FontFaceSet }).fonts.ready.then(() => undefined);
}
