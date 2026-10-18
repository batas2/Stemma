# UI Components

The frontend's building blocks, what they own, and the rules for changing them. Files are under
`src/Stemma.Web.Client/src/components` unless noted.

## Layout shell

- **Topbar** (`Topbar.tsx`) — workspace title, theme toggle, inspector show/hide, global actions.
- **Sidebar** (`Sidebar.tsx`) — navigation / "add new" palette / saved views list.
- **View tabs** (`ViewTabs.tsx`) — bottom, draw.io-style: built-in views (Module Map · Dependencies ·
  Concerns) + open custom views; click to switch, double-click to rename. (Clicking a built-in view
  must always switch to it, even when a custom view is active.)
- **Status bar** (`StatusBar.tsx`).

## Books ([F-013](../features/F-013-books.md))

- **`BooksPanel.tsx`** — the books in the Views & Books panel: create, rename, delete (confirmed),
  ▶ present, and a count of pages whose view or focus no longer exists.
- **`BookFooter.tsx`** — the book editor under the canvas while a book is open: the pages as a
  draggable strip, *Add page* (the current view, pointing at the current selection), and the page
  on screen as a form — title, view, focus, frame (whole view / zoom in), the rest (dim / hide),
  narrative, duplicate, delete. Present and PDF live in its header.
- **`BookPresenter.tsx`** — the full-screen overlay while presenting: the narrative card, page
  count and progress, a black screen, and the presenter's keys (`lib/presenterKeys.ts`). App hides
  every other piece of chrome while it is up, and the canvas is read-only.
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
  Comments — plus **Layout** (always available, no selection needed).
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
- **Dialogs** — `ConfirmDialog`, `PromptDialog`; **`CommandPalette.tsx`**; **`ContextMenu.tsx`**;
  **toasts** via the store.

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
