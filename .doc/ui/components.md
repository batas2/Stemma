# UI Components

The frontend's building blocks, what they own, and the rules for changing them. Files are under
`src/Stemma.Web.Client/src/components` unless noted.

## Layout shell

- **Topbar** (`Topbar.tsx`) — workspace title, theme toggle, inspector show/hide, global actions.
- **Sidebar** (`Sidebar.tsx`) — navigation / "add new" palette / saved views list.
- **View tabs** (`ViewTabs.tsx`) — bottom, draw.io-style: ‹ › for back and forward through the views
  visited (F-016, named in their tooltips, greyed at either end), then the built-in views (Module Map
  · Dependencies · Concerns) + open custom views; click to switch, double-click to rename. (Clicking
  a built-in view must always switch to it, even when a custom view is active.)
- **Status bar** (`StatusBar.tsx`) — connection, counts, the open view, and — when there are any —
  how many changes since the last commit, a click from being drawn (F-017).

## Finding on the view ([F-018](../features/F-018-find-on-the-view.md))

- **`FindBar.tsx`** — ⌘F: a `search` landmark floating top centre, below the view's header. A query
  (`lib/spotlight.ts`: words, `field:value`, `#tag`, "quoted"), the count ("3 of 7", "No matches"),
  ↑ ↓, *Fade the rest* / *Hide the rest*, ×; under it chips for the statuses, squads and kinds on the
  view, and — with a book page of this view on screen — *Point the page at these*. While it is open
  and has matches, its lighting replaces a page's (`lit` / `litHides` in `ArchCanvas`).

## Comparing ([F-017](../features/F-017-what-changed.md))

- **`CompareMenu.tsx`** — *Compare* in the top bar, beside Export: the last commit, where the branch
  started, tags, recent commits (subject, short id, author, when). Greyed with the reason when there
  is no Git. Reads `GET /api/workspace/history`.
- **`CompareBar.tsx`** — bottom of the canvas, between the zoom controls and the minimap, while
  comparing: what it is compared with, counts, *Changes* (the list, upward), *Fade the rest*, *Done*.
- **Marks** — a card gets `data.diff` (`New` / `Changed` badge and ring, `ArchNodeView`); a bounded
  context box the same on its chip; lines go green or amber; the rest fades. **Ghosts** — removed
  elements and relationships drawn by `GhostLayer` inside React Flow's `ViewportPortal`, never as
  nodes, so nothing can drag, lay out, select or save them.
- `lib/modelDiff.ts` (pure diff by id, with each change in words) and `lib/compare.ts` (start, stop,
  the live diff hooks).

## Books ([F-013](../features/F-013-books.md))

- **`BooksPanel.tsx`** — the books in the Views & Books panel: create, rename, delete (confirmed),
  ▶ present, and a count of pages whose view or focus no longer exists.
- **`BookFooter.tsx`** — the book editor under the canvas while a book is open: the pages as a
  draggable strip, *Add page* (the current view, pointing at the current selection), and the page
  on screen as a form — title, view, focus, frame (whole view / zoom in), the rest (dim / hide),
  narrative, duplicate, delete. Present and PDF live in its header.
- **Steps** ([F-020](../features/F-020-flow-steps.md)) — in the book editor, under the narrative:
  *Record* (a clicked relationship becomes the next step), *Selected relationship*, and the steps as
  a numbered list — click to show the page at that step, a note to say, ↑ ↓ / Alt+↑↓ / drag to
  reorder, × to remove. On the canvas the reached steps light their ends and wear ①②③ on their
  labels; the current one's label is an amber chip and its line moves. Presenting, Next and Back
  step through them first.
- **`BookPresenter.tsx`** — the full-screen overlay while presenting: the narrative card, page
  count and progress, a black screen, and the presenter's keys (`lib/presenterKeys.ts`). App hides
  every other piece of chrome while it is up, and the canvas is read-only.
- **`PresenterConsole.tsx`** ([F-019](../features/F-019-presenter-view.md)) — the presenter view,
  the app opened at `/?presenter=1` (mounted by `main.tsx` instead of the editor): now, next, the
  page list, elapsed time and the clock, Previous / Next / Blank / End. Dark by design. Talks to the
  presenting window through the hub (`lib/presenterLink.ts`); P or ⧉ opens it, *With notes* in the
  book editor opens it and presents.
- The canvas applies a page through `lib/bookFrame.ts`: what stays lit, and an animated `fitView`
  to the page's frame, immediate under `prefers-reduced-motion`.

## Canvas

- **`ArchCanvas.tsx`** — the React Flow surface: nodes, edges, background grid, minimap, controls,
  shape overlay. Owns node-build, drag handling, layout actions, export. See
  [`../architecture/client-frontend.md`](../architecture/client-frontend.md) for its invariants
  (preserve `selected`, never rebuild mid-drag).
- **Nodes** (`nodes/ArchNodeView.tsx`) — an element box: kind glyph, name, badges (lifecycle,
  ownership, fan-in/out), inline rich-text editor, and **6 connection dots**. Bounded contexts render
  as container boxes wrapping their modules.
- **Edges** (`edges/WaypointEdge.tsx`) — relationships with a **routing** property (curved / elbow /
  step / straight), floating dock endpoints, both-end markers, waypoints, a selection halo + pins,
  and a label. Custom markers in `edges/EdgeMarkerDefs.tsx`; geometry in `lib/edgeDock.ts`.
- **Shapes** (`ShapeLayer.tsx`) — the free-form annotation layer: rect/ellipse/triangle/label/arrow/
  image with appearance + text; arrows can dock to elements/shapes.

## Starting from nothing ([F-003](../features/F-003-from-scratch-onboarding.md))

Three surfaces, each for one state, none of which may ask for a filesystem path.

- **`EmptyState.tsx`** — no workspace open. Three doors, each a real button: *Start from a template*,
  *Start empty*, *Open an existing one*, plus recents inline and — in the desktop shell only —
  *Create somewhere else…*, which opens the OS folder picker.
- **`EmptyCanvasGuide.tsx`** — a workspace is open and its model is empty. A dashed target with one
  primary action and a line naming right-click and ⌘K, which are otherwise invisible until you
  already know they exist. A labelled `region`, so it is announced and not merely drawn.
- **`FirstElementStrip.tsx`** — shown once per person, dismissible, after the element that takes a
  model out of empty. It quotes the line of C# that element became, **read back out of
  `Architecture.cs`** via `GET /api/workspace/source/{id}`. This is the only place in the product
  where the premise is demonstrated rather than asserted: the moment it renders something composed
  from the model instead, it stops being evidence.

There is deliberately **no template picker component** — `pickFromList` in `PromptDialog.tsx` is one,
and a second list surface would only have to be kept in step with the first. The templates themselves
are in `lib/templates.ts` as scripts of ordinary operations, never a stored format.

## Inspector (right-edge icon rail)

`ArchInspector.tsx` is an **icon rail** that opens one panel at a time:

- **Panels:** Properties, Appearance, Text & attributes, Lifecycle, Ownership, Custom properties,
  Comments — plus **Layout** (always available, no selection needed). Properties opens with
  *Appears in* (F-016): the views that draw the element as chips — the one on screen marked — and the
  book pages that point at it, each one click from being on screen.
- **Behavior:** selecting an element opens Appearance; deselecting collapses to the rail; opening a
  panel with nothing selected shows a "pick an element" prompt; selecting 2+ jumps to Layout.
- **Appearance** uses collapsible **sub-sections** (Presets · Style · Animation), not tabs.
- **Text & attributes** fills the panel height (full-height editor) with an **Open full editor**
  button.
- **`Section` (`fill`)** — the panel wrapper; `fill` makes a panel's body fill the height (used by the
  notes editor).

## Layout panel

`LayoutPanel.tsx` — per-view layout. Mode selector (Architectural / Hierarchical / Organic / Custom +
one-shot Focus), the active mode's tunable sliders (with Reset and live re-apply), snap toggle, Fit,
and **Align & distribute** on top (labelled icon-over-text buttons, disabled until enough is
selected). Drives the canvas via the `stemma:layout-action` event.

## Editors & overlays

- **`RichTextEditor.tsx`** — contenteditable WYSIWYG, markdown-backed; simple inline toolbar, or a
  `rich` "turbo" toolbar in the full editor; `#tag` autocomplete from the element's attributes.
- **`NotesModal.tsx`** — the full-screen editor (fills the popup, turbo toolbar).
- **`MarkerSelect.tsx`** — edge end-marker dropdown with SVG previews.
- **`CommandPalette.tsx`** (⌘K, F-016) — Views (all of them, with counts), Books, Elements (kind and
  where each lives; found by name, id, kind, context or squad), Add element, and Go (back, forward,
  shortcuts, theme). Choosing an element calls `revealElement` (`lib/canvasReveal.ts`), the one way
  anything in the app takes a person to an element: open a view that draws it, select it, glide to it,
  ring it once (`.stemma-reveal`, a steady ring under reduced motion).
- **Dialogs** — `ConfirmDialog`, `PromptDialog`; **`ContextMenu.tsx`**;
  **toasts** via the store. An open context menu takes every key (capture phase) until it closes.
- **Copy & paste** ([F-015](../features/F-015-copy-paste-duplicate.md)) — no surface of its own: the
  gestures are window events (`stemma:copy`, `stemma:paste`, `stemma:duplicate`, `stemma:copy-style`,
  `stemma:paste-style`) handled in `ArchCanvas`; `lib/clipboard.ts` plans, `lib/paste.ts` carries out.
  The Appearance panel opens with *Copy style* / *Paste style*, Paste greyed until a look is held.

## Component rules

1. **Tokens, not literals.** Colours, spacing, z-index, radius come from
   [`design-tokens.md`](./design-tokens.md).
2. **States are mandatory.** Every component handles the relevant states in
   [`../ux/states-and-interactions.md`](../ux/states-and-interactions.md) (empty/loading/error/…).
3. **Presentation vs model.** A component that changes the model emits an **operation**; one that
   changes appearance writes the **sidecar** (via `lib/layout.ts`). Never a third store.
4. **Stable identity in the store.** Read store slots directly; don't create fresh objects in
   selectors.
5. **Match the neighbours.** New components mirror the idiom, density, and naming of the ones around
   them.
