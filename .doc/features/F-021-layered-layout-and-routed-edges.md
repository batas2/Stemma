# Feature: Layered layout and routed edges

| Field | Value |
|---|---|
| **ID** | F-021 |
| **Status** | In progress |
| **Owner** | Bartosz |
| **Persona served** | The Architect's Agent ("Theo"); every architect who opens a view nobody arranged |
| **Roadmap horizon** | Next |
| **Created / Updated** | 2026-10-22 / 2026-10-22 |

## 1. Product — why

- **Problem:** an agent that writes an architecture of fifteen or more elements cannot get a readable
  picture without placing every box itself, and Stemma has no edge router: lines cross cards, labels
  collide, a back edge in a row vanishes under the card it passes. Mermaid draws the same graph legibly
  on the first try because dagre/ELK lay it out and route it. This is the one axis on which Stemma
  loses ([`agent-architecture-workflow.md`](../product/agent-architecture-workflow.md) §1, A2–A5).
- **Why now:** it blocks everything else for Theo — rules, C4 lenses and conformance all end in a
  picture someone has to read.
- **Value:** *the picture is right without anyone placing a box*, and stays the same picture until the
  model changes — automatic like Mermaid, reproducible unlike a force layout.
- **Out of scope:** routing for views arranged by hand or by a grid/row/column constraint (they keep
  their edges; [F-022](./F-022-render-geometry-and-layout-lint.md) reports what goes wrong there);
  a server-side layout; replacing the force/by-type generators.

## 2. User story & acceptance criteria

> As **the Architect's Agent**, I want to **write the model and the view and get a laid-out,
> routed picture** so that **I never author a coordinate and the human never has to tidy up after me**.

- [ ] **AC1 — A layered constraint.** `"layout": { "kind": "layered" }` on a view lays out every node in
  it with ELK's layered algorithm: cards do not overlap; edges are routed orthogonally around cards;
  edge labels are placed so they overlap neither cards nor each other.
- [ ] **AC2 — Deterministic.** The same model, sizes and sidecar give the same positions and the same
  routes, run after run and in the app and the render. Elements and links are given to ELK in the
  order the model declares them, and that order breaks ties — so declaring in reading order is a way
  to ask for an order.
- [ ] **AC3 — Options.** `direction` (`down` default, `right`, `up`, `left`); `spacing` (a number, or
  `[between nodes, between layers]`, default `[48, 72]`); `first` and `last` (ids pinned to the first
  or last layer); `groups` (default `true`: a bounded context is laid out around its modules and a
  software system around its containers, when both the parent and a child are in the view, and the
  boundary is drawn); `routing` (`orthogonal` default, `polyline`, `spline`).
- [ ] **AC4 — The default for a view nobody arranged.** A view — custom or built-in — with no `layout`
  and no saved position for any of its members is laid out as `{ "kind": "layered" }`. Nothing is
  written to the sidecar on open, in the app or the render.
- [ ] **AC5 — Nudges.** Dragging a card on a layered view records an offset against its solved position
  (the Q6 contract); the constraint stays. An edge touching a nudged card is drawn with the view's
  ordinary routing instead of its ELK route. On a view laid out by default, the first drag writes
  `"layout": { "kind": "layered" }` and the offset — the arrangement the person was looking at becomes
  the committed one.
- [ ] **AC6 — In the Layout panel.** "Layered" is offered beside grid, row, column and stack, with
  direction and spacing; removing it bakes the drawn positions, as for the other constraints.
- [ ] **AC7 — The render waits for it.** `stemma render` captures only after the layout has settled; a
  layout that fails reports `error` with the reason, never a picture of the fallback.
- [ ] **AC8 — Checked.** The schema documents the kind; `stemma validate` reports `constraint/dangling-id`
  for `first`/`last`, `constraint/bad-direction`, and accepts the kind where it reported
  `constraint/unknown-kind`.
- [ ] **AC9 — The audit passes.** The food-delivery container view from the audit renders with no card
  overlap and no edge through a card (measured by F-022's lint), from a sidecar with no coordinates.

## 3. Architecture impact

- [x] **Model or presentation?** Presentation only: a new constraint kind in `views.<key>.layout`.
- [x] **New/changed operations:** none.
- [x] **Fidelity:** untouched — no source is rewritten.
- [x] **Engine purity:** ELK runs in the browser; the engine is not involved.
- [x] **Sidecar:** new `layout.kind = "layered"` and its fields; schema updated.
- [x] **ADR needed?** [ADR-0025](../architecture/decisions/0025-layered-layout-is-a-live-constraint.md)
  — ELK is admitted as a live constraint; dependency, licence and determinism.
- **Affected files/areas:**
  - `src/Stemma.Web.Client/src/lib/layeredLayout.ts` (new, pure: graph in → positions, frames, routes,
    label positions out; ELK loaded lazily, its own chunk)
  - `lib/layoutDsl.ts` (the kind, its guard, `constraintIds`)
  - `components/ArchCanvas.tsx` (run it when the view is layered or unarranged; hide the cards until it
    lands; apply offsets; hand routes to the edges; report `layoutSettled`)
  - `components/edges/WaypointEdge.tsx` (draw a given route and label position)
  - `components/LayoutConstraintPanel.tsx`, `components/RenderShell.tsx`, `lib/renderReady.ts`
  - `schema/stemma.layout.schema.json`, `src/Stemma.Cli/WorkspaceCheck.cs`

## 4. UX impact

- [x] **Journey(s) touched:** opening a view for the first time; an agent's render; arranging a view.
- [x] **States defined:** *pending* — the cards are measured but not yet shown (no visible jump from a
  default arrangement to the solved one); *settled*; *failed* — the view falls back to the default
  arrangement and a toast says the layout could not be computed (render: `error`).
- [x] **Interactions:** drag = nudge (offset), as for grid. "Reset nudges" clears them.
- [x] **Accessibility:** no new controls beyond two segmented choices in the Layout panel, keyboard
  reachable like the rest of it.

## 5. UI impact

- [x] **Components touched/added:** Layout panel (one more constraint kind); system boundary frames
  (same look as bounded-context frames, the system's name in the chip).
- [x] **Tokens:** reuses the frame tokens; no new colour.
- [x] **Both themes:** frames and routed edges checked in light and dark.
- [x] **Layout/rail behavior:** unchanged.

## 6. Technical prerequisites & dependencies

- [x] `elkjs` 0.12.0 (EPL-2.0 OR GPL-3.0; used under EPL-2.0) — lazily imported; notice shipped.
- [x] Blocks F-022's acceptance (AC9 is measured with its lint) and F-023's lenses (they default to it).

## 7. Test plan

- [ ] `layeredLayout.test.ts` — properties on real ELK: no overlaps; no route segment through a card
  that is not one of its ends; the same input twice gives identical output; `first`/`last` honoured;
  `direction` changes the axis; children inside their parent's frame.
- [ ] `layoutDsl.test.ts` — the guard accepts the kind; ids include `first`/`last`.
- [ ] `WorkspaceCheckTests` — the new findings.
- [ ] Render: the audit workspace, looked at; F-022's lint reports no overlap or edge-through-card.

## 8. Definition of Done

- [ ] All ACs met and demoed
- [ ] States handled; accessibility bar met
- [ ] `dotnet test` green · `tsc` clean · `vite build` clean · `vitest` green
- [ ] Model/presentation boundary respected; no new data store
- [ ] Docs: protocol §4 and §8, schema, `layoutDsl.ts` header, Q6 cross-reference
- [ ] Reviewed against all four pillars

## 9. Notes / open questions

- **Why ELK and not dagre:** ELK has compound nodes (boundaries), orthogonal routing with edge labels as
  first-class obstacles, `considerModelOrder`, and layer constraints; dagre has none of the four. ELK is
  what draw.io's MCP server, LikeC4's newer layouts and D2 offer for the same reason.
- **Edge routes are not committed.** They are a function of the positions, like the solved positions
  themselves.
- **Bundle:** ELK is about 1.4 MB unminified; it is a separate chunk loaded the first time a view needs it.
