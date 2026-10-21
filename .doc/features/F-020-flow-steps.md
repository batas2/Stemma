# Feature: Steps — a book page plays a flow one arrow at a time

| Field | Value |
|---|---|
| **ID** | F-020 |
| **Status** | `Shipped` |
| **Owner** | Bartosz |
| **Persona served** | Solution Architect ("Aria") explaining how something happens; the team receiving it |
| **Roadmap horizon** | `Next` (deferred from [F-013](./F-013-books.md)) |
| **Created / Updated** | 2026-10-21 / 2026-10-21 |

## 1. Product — why

- **Problem:** the pages that matter most in a meeting tell how something *happens* — a purchase, a
  deployment, a request through six hops. Today such a page shows every arrow at once with a
  narrative that says "follow the top row left to right, then drop down…", and the room follows the
  presenter's finger, or doesn't. Splitting the flow into one page per hop makes six slides of the
  same picture.
- **Why now:** books (F-013) put the walk in the repository; this is the deferred piece that makes a
  walk of a *flow* as legible as a walk of a structure. IcePanel's Flows and Structurizr's animation
  prove the need; Stemma keeps the order in the book, next to the model, checked by `validate`.
- **Value:** a flow told in the order it happens, one arrow lit and numbered at a time, on one
  picture that stays still while the highlight moves.
- **Out of scope:** steps that move the camera; steps spanning views (a page is one view — the next
  page is the next view); branching flows.

## 2. User story & acceptance criteria

> As an **architect presenting**, I want **a page to light a flow's relationships one at a time, in
> order, numbered**, so that **the room follows how it happens instead of searching the picture**.

- [x] AC1 — A page can carry **steps**: relationships in order, each with an optional note. In the
      book editor: **Record**, then click relationships on the canvas in the order things happen;
      or **Selected relationship**; each step is listed with its arrow in words ("Canvas → Web host
      · open"), a note field, ↑ ↓ (and Alt+↑↓, and drag) to reorder, × to remove.
- [x] AC2 — Presenting, a page with steps arrives as it always has; each **Next** lights the next
      step before the page turns: the steps reached so far are lit with their two ends and wear
      their number on their label (①②③…); the one reached last is the books' amber, moving, its label
      an amber chip; everything else fades (or hides, as the page says). **Back** unwinds a step at a
      time, and back into a page arrives where it ended, every step lit.
- [x] AC3 — The narrative card says "③ Step 3 of 6" and the step's note — or, without one, its arrow
      in words; the screen reader hears it; the presenter view (F-019) shows it too.
- [x] AC4 — Clicking a step in the editor shows the page at that step, so the walk is rehearsed where
      it is written; *Before step 1* shows it as it arrives.
- [x] AC5 — The PDF shows the whole flow lit and numbered, and lists the steps under the narrative;
      the report lists them too.
- [x] AC6 — A step naming a relationship the model no longer has marks the page broken on the canvas
      and is a `book/dangling-step` error in `stemma validate`.

## 3. Architecture impact

- [x] **Model or presentation?** Presentation: `books.<id>.pages.<id>.steps` in `stemma.layout.json`
      ([ADR-0022](../architecture/decisions/0022-books-in-the-layout-sidecar.md)). A step is a link
      id, or `{ "link", "note" }` when it has something to say — the shortest thing that says it.
      The order is the array; a reorder is one changed value (ADR-0021).
- [x] **New/changed operations:** none. **Schema:** `bookPage.steps` documented.
- [x] **CLI:** `book/dangling-step` (error) and `book/malformed` for steps that are not a list.
- **Affected files/areas:** `lib/books.ts` (read, write, problems, `stepsLit`, captions), `lib/store.ts`
  (`activeStep`, `advance`, recording), `ArchCanvas.tsx` (lighting, numbered labels, recording by
  click), `WaypointEdge.tsx` (the current step's label), `BookPresenter.tsx`, `BookFooter.tsx`
  (`StepsEditor`), `lib/bookExport.ts`, `report/`, `Stemma.Cli/WorkspaceCheck.cs`,
  `schema/stemma.layout.schema.json`, the self-model's book.

## 4. UX impact

- [x] **Journey(s) touched:** J6c (present a book): building the walk, presenting, leaving it behind.
- [x] **States:** *no steps* — the editor says what steps are and how to record them; *recording* — a
      pulsing red dot and "click the arrows in order · Done"; each recorded step is toasted ("Step 3:
      A → B"); the same arrow clicked twice in a row is one step; *broken step* — struck through in
      the list, the page marked broken.
- [x] **Accessibility:** colour is not the only signal — the number is on the label and in the card;
      reduced motion stops the pulse; reorder has a keyboard path.

## 7. Test plan

- [x] Unit: reading steps however written, writing them shortest-first, a dangling step, the step
      mark, what is lit at each step and on paper (`books.test.ts`); stepping through steps and
      back into a page at its end, recording (`bookStore.test.ts`).
- [x] CLI: steps that hold, a dangling step, steps that are not a list (`WorkspaceCheckTests`).
- [x] Journey: the self-model's "A gesture becomes a diff" — Next lights ① to ⑥, then turns the
      page; Back arrives at ⑥ and unwinds; recording two clicked arrows writes them as steps
      (`tests/journey/steps.spec.ts`).
- [x] Sample: the self-model's book now plays the write path as six steps.

## 8. Definition of Done

- [x] All ACs met and demoed
- [x] `dotnet test` green · `tsc` clean · `vite build` clean · `vitest` green · journeys green
- [x] Docs updated: this record, F-013, the features index, `protocol/authoring-a-diagram.md`,
      `ux/user-journeys.md`, `ui/components.md`, the schema
