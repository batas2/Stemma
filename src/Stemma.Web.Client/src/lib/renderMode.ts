/**
 * Headless render mode.
 *
 * The app is normally driven by a person clicking. A published diagram has to come out of the same
 * canvas without one, so `?render=1` boots a bare canvas — no topbar, sidebar, inspector, tabs or
 * footer — parameterised entirely by the query string, and reports when it has settled.
 *
 * It is a *mode of the existing canvas*, deliberately, not a second renderer. A diagram that drew
 * differently here than in the app would be exactly the drift this product exists to abolish.
 */

import type { ViewKind } from './types';

export type RenderProfile = 'app' | 'publication';
export type RenderTheme = 'light' | 'dark';

export interface RenderParams {
  /** Built-in lens name, or the id of a custom view. Empty means "whatever the app opens with". */
  view: string | null;
  profile: RenderProfile;
  theme: RenderTheme | null;
  /** Named palette, resolved by the publication profile. Null means the profile's default. */
  palette: string | null;
  /** Hide the dot grid, the minimap, the controls and the attribution. On by default in render mode. */
  bare: boolean;
}

const BUILTIN_VIEWS: ViewKind[] = ['moduleMap', 'dependencyGraph', 'concerns'];

export function isBuiltinView(view: string): view is ViewKind {
  return (BUILTIN_VIEWS as string[]).includes(view);
}

function oneOf<T extends string>(raw: string | null, allowed: readonly T[], fallback: T): T {
  return allowed.includes((raw ?? '') as T) ? (raw as T) : fallback;
}

/**
 * Parse render parameters out of a query string, or return null when this is an ordinary session.
 *
 * Accepts a raw search string so it is testable without a browser.
 */
export function parseRenderParams(search: string): RenderParams | null {
  const q = new URLSearchParams(search);
  const flag = q.get('render');
  if (flag === null || flag === '0' || flag === 'false') return null;

  const theme = q.get('theme');
  const bare = q.get('bare');

  return {
    view: q.get('view') || null,
    profile: oneOf(q.get('profile'), ['app', 'publication'] as const, 'app'),
    theme: theme === 'light' || theme === 'dark' ? theme : null,
    palette: q.get('palette') || null,
    bare: bare === null ? true : !(bare === '0' || bare === 'false'),
  };
}

/** Read the current window's render parameters. Null outside a browser or an ordinary session. */
export function currentRenderParams(): RenderParams | null {
  if (typeof window === 'undefined') return null;
  return parseRenderParams(window.location.search);
}
