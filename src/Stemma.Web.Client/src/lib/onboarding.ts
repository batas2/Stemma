/**
 * The decisions that make up the first ten minutes (F-003).
 *
 * Small predicates rather than conditions buried in a component, because each of them is a claim
 * about when a person is shown something once — and "once" is exactly the kind of rule that quietly
 * becomes "sometimes twice, and never on a Tuesday" when it lives inside a render.
 *
 * The flag is per user and lives in `localStorage`: "have I been told how this works" is a fact
 * about the reader, not about the model or about how a view is arranged. Putting it in
 * `stemma.layout.json` would commit one person's onboarding into everybody else's repository, which
 * is precisely the drift the presentation/model split exists to prevent.
 */

const FIRST_ELEMENT_EXPLAINED = 'stemma.firstElementExplained';

/**
 * A workspace is open and its model has nothing in it — so the canvas shows guidance instead of a
 * bare grid, where every way to add the first element is invisible until you already know it.
 *
 * Deliberately not shown when no workspace is open: that is the start screen's job, and drawing
 * both is how a first run ends up saying two different things at once.
 */
export function shouldShowEmptyCanvasGuide(workspaceOpen: boolean, elementCount: number): boolean {
  return workspaceOpen && elementCount === 0;
}

/**
 * This was the model's first element, and this person has not been shown what one becomes.
 *
 * `elementCountBefore` rather than after: the interesting moment is the transition out of empty,
 * and by the time the element exists the model is no longer empty.
 */
export function shouldExplainFirstElement(seenBefore: boolean, elementCountBefore: number): boolean {
  return !seenBefore && elementCountBefore === 0;
}

function read(key: string): boolean {
  try {
    return localStorage.getItem(key) === '1';
  } catch {
    // Private browsing, or storage disabled. Showing the explainer again is a far smaller cost than
    // failing to render the canvas.
    return false;
  }
}

/** Has this person already been shown the C# their first element produced? */
export function hasSeenFirstElementExplainer(): boolean {
  return read(FIRST_ELEMENT_EXPLAINED);
}

export function markFirstElementExplained(): void {
  try { localStorage.setItem(FIRST_ELEMENT_EXPLAINED, '1'); }
  catch { /* nothing to do, and nothing worth reporting */ }
}

/** Test seam, and the thing to call if the explainer ever needs to be shown again deliberately. */
export function forgetOnboarding(): void {
  try { localStorage.removeItem(FIRST_ELEMENT_EXPLAINED); } catch { /* ignore */ }
}
