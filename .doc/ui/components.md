# UI Components

The frontend's building blocks, what they own, and the rules for changing them. Files are under
`src/Stemma.Web.Client/src/components` unless noted.

## Layout shell

- **Topbar** (`Topbar.tsx`) — workspace title, theme toggle, inspector show/hide, global actions.
- **Sidebar** (`Sidebar.tsx`) — navigation / "add new" palette / saved views list.
- **View tabs** (`ViewTabs.tsx`) — bottom, draw.io-style: built-in views (Module Map · Dependencies ·
  Concerns) + open custom views; click to switch, double-click to rename. (Clicking a built-in view
  must always switch to it, even when a custom view is active.)
- **Status bar** (`StatusBar.tsx`), **Book footer** (`BookFooter.tsx`).

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
