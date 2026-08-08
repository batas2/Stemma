# Feature: Declarative layout DSL in the presentation sidecar

| Field | Value |
|---|---|
| **ID** | F-006 |
| **Status** | `Shipped` (v1) |
| **Owner** | Bartosz |
| **Persona served** | The Essayist's Agent ("Ada"); Solution Architect ("Aria") for repeatable arrangements |
| **Roadmap horizon** | `Next` |
| **Created / Updated** | 2026-08-08 / 2026-08-08 |

## 1. Product — why

- **Problem:** the only way to place a node was to drag it. An agent cannot drag, and a human who
  drags one box loses the arrangement that aligned the others, because a manual move takes the whole
  view off its layout permanently.
- **Why now:** an LLM is poor at pixel coordinates and good at intent. "These four questions sit
  above the four artifacts that answer them" is a sentence it can write and could not previously
  express.
- **Value:** the seven-box argument diagram — the shape most essays need — becomes authorable as
  text, and stays authorable after it has been adjusted.
- **Out of scope:** nested constraints; replacing the auto-layout algorithms.

## 2. User story & acceptance criteria

> As **Ada**, I want to state the arrangement rather than compute coordinates so that a diagram is
> authorable, and stays correct when a box is added.

- [x] AC1 — A view may carry `layout`: `grid`, `row`, `column` or `stack`.
- [x] AC2 — Columns are as wide as their widest member and rows as tall as their tallest, measured
      per track — the failure this prevents puts a long label underneath its neighbour.
- [x] AC3 — Nodes the constraint does not name keep their stored positions.
- [x] AC4 — A drag on a governed node records a delta in `offsets`; the constraint survives.
- [x] AC5 — A nudge travels with its slot when the arrangement is re-solved.
- [x] AC6 — Sizes come from measurements where they exist and from an estimate otherwise, so a
      headless render can place nodes before drawing them without the layout jumping.
- [x] AC7 — Only deterministic arrangements are constraints. Force, hierarchical and byType remain
      one-shot generators that bake coordinates.

## 3. Architecture impact

- [x] **Model or presentation?** Presentation. Nothing here describes the system.
- [x] **New/changed operations:** none.
- [x] **Fidelity:** untouched.
- [x] **Engine purity:** no engine change was needed at all — `layout` and `offsets` ride through on
      the extension data added with B-001, which is the first thing that fix paid for.
- [x] **Sidecar:** adds `views.<key>.layout` and `views.<key>.offsets`, both in the schema.
- [x] **ADR needed?** No — recorded as §8 · Q6.
- **Affected files/areas:** `lib/layoutDsl.ts`, `lib/textMetrics.ts`, `lib/layout.ts`,
  `components/ArchCanvas.tsx`, `schema/stemma.layout.schema.json`.

## 4. UX impact

- [x] **Journey(s) touched:** arranging a view; opening a workspace someone else authored.
- [x] **States defined:** governed / ungoverned nodes; nudged / clean.
- [x] **Interactions:** dragging a governed node nudges it rather than escaping the constraint.
- [ ] **Accessibility:** no keyboard path to author or clear a constraint yet — see §9.

## 5. UI impact

- [ ] **Components touched/added:** no inspector surface yet. The constraint is authored in the
      sidecar; the canvas honours it. This is the main gap in the record.
- [x] **Tokens:** none.
- [x] **Both themes:** unaffected.

## 6. Technical prerequisites & dependencies

- [x] B-001 fixed, or the constraint never reaches disk.
- [x] Requires the node-build effect to re-run once the sidecar is primed — see §9.

## 7. Test plan

- [x] 30 unit tests over the solver: track sizing, ragged columns, alignment, fallback sizes,
      offsets surviving a re-solve, baking, dangling ids, size estimation.
- [x] End-to-end: a workspace whose only layout is a constraint, rendered twice, identical.
- [ ] A test that a drag on a governed node writes an offset rather than a position. The logic is
      unit-tested; the wiring is not.

## 8. Definition of Done

- [x] ACs met · [x] all suites green · [x] no new store · [x] schema and docs updated

## 9. Notes / open questions

Wiring this exposed two long-standing canvas defects, both of which made a committed layout lose to
a grid nobody authored: the node-build effect never re-ran after the sidecar finished loading, and a
node that already existed kept its position across every rebuild. Both are fixed here; both were
independent of this feature and had been silently degrading ordinary use.

**Not built:** any UI for authoring or clearing a constraint, and a "reset nudges" affordance. Until
those exist the feature serves Ada fully and Aria only through a text editor.
