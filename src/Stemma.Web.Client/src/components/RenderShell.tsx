import { useEffect, useRef, useState } from 'react';
import { useApp } from '@/lib/store';
import { ArchCanvas } from './ArchCanvas';
import { applyPalette } from '@/lib/palette';
import { isBuiltinView, type RenderParams } from '@/lib/renderMode';
import { computeRenderState, fontsReady, publishRenderState, VIEWPORT_STABLE_POLLS, type RenderState } from '@/lib/renderReady';
import type { ViewKind } from '@/lib/types';

/**
 * The canvas with nothing around it, for `?render=1`.
 *
 * No topbar, sidebar, inspector, view tabs, footer, toasts or dialogs — every one of those is an
 * affordance for a person, and every one of them would end up in the picture. What remains is the
 * same `<ArchCanvas>` the app renders, so a diagram cannot look one way here and another way in
 * the tool.
 *
 * Its other job is to say when it has settled. The capture side used to sleep for a fixed number of
 * milliseconds at each step and hope; here the shell publishes `data-stemma-render` on the document
 * root and the renderer waits for a value.
 */
export function RenderShell({ params }: { params: RenderParams }) {
  const ws = useApp((s) => s.workspace);
  const arch = useApp((s) => s.arch);
  const customViews = useApp((s) => s.customViews);
  const setView = useApp((s) => s.setView);
  const setActiveCustomView = useApp((s) => s.setActiveCustomView);

  const [sidecarPrimed, setSidecarPrimed] = useState(false);
  const [fonts, setFonts] = useState(false);
  const [measured, setMeasured] = useState(false);
  const [nodeCount, setNodeCount] = useState(0);
  const [zeroStreak, setZeroStreak] = useState(0);
  const [viewportStable, setViewportStable] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const viewApplied = useRef(false);

  // Palette and profile are attributes on the root so the publication stylesheet and the export
  // can both read them without threading props through the canvas.
  useEffect(() => {
    applyPalette(params.palette);
    document.documentElement.setAttribute('data-stemma-profile', params.profile);
    return () => document.documentElement.removeAttribute('data-stemma-profile');
  }, [params.palette, params.profile]);

  useEffect(() => {
    if (params.theme) document.documentElement.classList.toggle('dark', params.theme === 'dark');
  }, [params.theme]);

  useEffect(() => { fontsReady().then(() => setFonts(true)); }, []);

  useEffect(() => {
    function onPrimed() { setSidecarPrimed(true); }
    window.addEventListener('stemma:sidecar-primed', onPrimed);
    return () => window.removeEventListener('stemma:sidecar-primed', onPrimed);
  }, []);

  // Select the requested view once the data it needs is present. A custom view is named by id; a
  // built-in by lens name. Asking for one that does not exist is a hard error rather than a silent
  // fallback to the whole model — a render that quietly draws something else is worse than no
  // render, because it looks like a success.
  useEffect(() => {
    if (!params.view || viewApplied.current || !arch) return;
    if (isBuiltinView(params.view)) {
      setView(params.view as ViewKind);
      viewApplied.current = true;
      return;
    }
    if (customViews.length === 0) return; // not loaded yet
    const match = customViews.find((v) => v.id === params.view || v.name === params.view);
    if (!match) {
      setFailure(`no view '${params.view}' in this workspace (have: ${customViews.map((v) => v.id).join(', ') || 'none'})`);
      viewApplied.current = true;
      return;
    }
    setActiveCustomView(match.id);
    viewApplied.current = true;
  }, [params.view, arch, customViews, setView, setActiveCustomView]);

  // React Flow reports its measurements through the DOM; poll rather than reaching into internals,
  // so this keeps working when the canvas changes how it draws.
  //
  // Once everything has stopped changing, ask the canvas for one instant, unanimated fit and treat
  // *that* as the moment the picture is final. Waiting for the animated fit to stop was a race
  // against whichever fit fired last, and it produced the same view at two different sizes.
  useEffect(() => {
    const started = Date.now();
    let lastSignature = '';
    let stillFor = 0;
    let fitRequested = false;

    const timer = setInterval(() => {
      const nodes = Array.from(document.querySelectorAll('.react-flow__node')) as HTMLElement[];
      setNodeCount(nodes.length);
      setZeroStreak((n) => (nodes.length === 0 ? n + 1 : 0));
      setMeasured(nodes.length > 0 && nodes.every((n) => n.offsetWidth > 0));

      // The signature covers each node's size *and* its position. Size alone is not enough: the
      // committed positions arrive with the sidecar, after the nodes first appear, so a
      // size-only signature declares the canvas still while every box is about to move.
      const signature = nodes
        .map((n) => `${n.dataset.id}:${n.offsetWidth}x${n.offsetHeight}@${n.style.transform}`)
        .join('|');
      stillFor = signature && signature === lastSignature ? stillFor + 1 : 0;
      lastSignature = signature;

      if (!fitRequested && nodes.length > 0 && stillFor >= VIEWPORT_STABLE_POLLS) {
        fitRequested = true;
        // Enough slack that an edge label hanging off the leftmost node still has viewport to sit in;
        // the crop trims the rest back to the content anyway.
        window.dispatchEvent(new CustomEvent('stemma:render-fit', { detail: { padding: 0.12 } }));
        // Nothing after this point is decided here — readiness now waits on `render-fitted`. Left
        // running, it would keep measuring every node and rebuilding a signature string throughout
        // the capture itself, for a question already answered.
        clearInterval(timer);
      }

      // A safety valve, not a success path: if something never settles the page stays in `loading`
      // and the renderer fails with its own timeout, which says more than a silent capture would.
      if (Date.now() - started > 30_000) clearInterval(timer);
    }, 60);
    return () => clearInterval(timer);
  }, [arch, params.view]);

  useEffect(() => {
    function onFitted() { setViewportStable(true); }
    // The canvas can discover during the fit that there is nothing sane to capture. Readiness is
    // owned here, so it reports the reason rather than publishing a state of its own.
    function onFailed(ev: Event) {
      setFailure(String((ev as CustomEvent).detail?.reason ?? 'the canvas could not place the content'));
    }
    window.addEventListener('stemma:render-fitted', onFitted);
    window.addEventListener('stemma:render-failed', onFailed);
    return () => {
      window.removeEventListener('stemma:render-fitted', onFitted);
      window.removeEventListener('stemma:render-failed', onFailed);
    };
  }, []);

  const state: RenderState = failure
    ? 'error'
    : computeRenderState({
        workspaceOpen: !!ws,
        archLoaded: !!arch,
        sidecarPrimed,
        nodesMeasured: measured,
        fontsReady: fonts,
        nodeCount,
        zeroStreak,
        viewportStable,
      });

  useEffect(() => { publishRenderState(state, failure ?? undefined); }, [state, failure]);

  return (
    <div className="h-screen w-screen" data-stemma-render-shell>
      <ArchCanvas />
    </div>
  );
}
