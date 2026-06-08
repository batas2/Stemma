# Client & Frontend

`src/Verso.Web.Client` is a React 19 + Vite single-page app. The canvas is `@xyflow/react` (React
Flow); state is `zustand`; styling is Tailwind. It renders the active view, captures gestures as
operations, and patches its local graph from server deltas. **It holds no authoritative model
state** — a refresh re-fetches the snapshot.

## State model (zustand)

`lib/store.ts` is the single store. It holds the loaded `arch` model, the active `view` /
`activeCustomViewId`, selection (`selectedElementId` / `selectedLinkId` / `selectedShapeId` and a
multi-select count), presentation state hydrated from the sidecar (`nodeStyles`, `edgeStyles`,
`customProps`, `viewLayouts`, `forceParams`/`hierParams`/`byTypeParams`), and UI state
(`inspectorTab`, `canvasMode`, theme, toasts).

Two store invariants worth knowing:

- **Selectors must return stable references.** Reading `s.customProps[id] ?? {}` returns a fresh
  object each snapshot and loops `useSyncExternalStore`; select the slot, default outside.
- **Presentation is hydrated once, then authoritative in memory.** See the sidecar cache rule below.

## The presentation sidecar cache (critical)

All purely-visual state — node styles, edge styles, element notes, custom props, free-form shapes,
annotations, per-view layout choices — is routed through **one shared cache** in `lib/layout.ts`
(`sidecarMap` / `sidecarSet` / `loadViewShapes` / `saveViewShapes`). The cache:

- is **fetched once per workspace** (`primeLayoutSidecar` with a `primedRoot` guard); after that the
  in-memory cache is the session's source of truth and is debounce-flushed to `verso.layout.json`;
- must **never be re-fetched mid-session** — re-fetching clobbers unflushed edits (the cause of the
  "box jumps back / routing reverts / canvas blinks while editing" class of bugs).

A `verso:sidecar-primed` event triggers `store.rehydratePresentation()` exactly once.

## The canvas (`ArchCanvas.tsx`)

- Builds React Flow `nodes` from the filtered model and `edges` from links. **Node objects must
  preserve `selected` across rebuilds** — a periodic poll rebuilds nodes and would otherwise wipe a
  Ctrl-click / marquee multi-selection.
- **Never rebuild node objects mid-drag.** A drag-in-flight guard skips the rebuild; otherwise the
  dragged node loses its identity and snaps back on drop.
- Edges render through `WaypointEdge` with floating, dock-aware endpoints (draw.io-style) and a
  routing property; relationships connect to the 6 connection handles per node.
- Auto-layout lives in `lib/autoLayout.ts` (force-directed, hierarchical, by-type, focused). The
  Layout panel drives it via a `verso:layout-action` event because it lives outside the canvas tree.

## Inspector (`ArchInspector.tsx`)

A right-edge **icon rail** that opens one panel at a time (Properties, Appearance, Text &
attributes, Lifecycle, Ownership, Custom properties, Comments, Layout). Selecting an element opens
Appearance; deselecting collapses to the rail. See [`../ui/components.md`](../ui/components.md).

## Editing text (`RichTextEditor.tsx` + `lib/markdownDom.ts`)

A contenteditable WYSIWYG with **markdown as the stored format** (the bridge round-trips headings,
lists, tables, blockquote, code fences, task lists, and inline color/underline/highlight). The
inline editor uses a simple toolbar; the full-screen `NotesModal` uses a "turbo" toolbar. `#tags`
typed in notes become custom properties on the element.

## Live sync

A SignalR connection streams operations and applies deltas. Edits made elsewhere (or by another
client) arrive as deltas; the client merges them without clobbering in-flight local edits.

## Orientation — key files

| Concern | File |
|---|---|
| Store | `lib/store.ts` |
| Sidecar cache | `lib/layout.ts` |
| Canvas | `components/ArchCanvas.tsx` |
| Inspector rail | `components/ArchInspector.tsx` |
| Layout panel | `components/LayoutPanel.tsx` |
| Edge rendering / docking | `components/edges/WaypointEdge.tsx`, `lib/edgeDock.ts` |
| Shapes / annotations | `components/ShapeLayer.tsx`, `lib/shapes.ts` |
| Auto-layout | `lib/autoLayout.ts` |
| Node / edge styling | `lib/nodeStyles.ts`, `lib/edgeStyles.ts` |
| Rich text | `components/RichTextEditor.tsx`, `lib/markdownDom.ts` |

## Testing

Frontend tests are `vitest`; pure logic (auto-layout, markdown bridge, edge-dock geometry, sidecar)
is unit-tested. See [`../engineering/testing.md`](../engineering/testing.md).
