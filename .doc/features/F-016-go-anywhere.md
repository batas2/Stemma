# Feature: Go anywhere — find an element, land on it, and find your way back

| Field | Value |
|---|---|
| **ID** | F-016 |
| **Status** | `Shipped` |
| **Owner** | Bartosz |
| **Persona served** | Solution Architect ("Aria") in a long session and in a meeting; Stakeholder ("Priya") being walked through |
| **Roadmap horizon** | `Next` (Epic 13 — Navigation & views clarity) |
| **Created / Updated** | 2026-10-21 / 2026-10-21 |

## 1. Product — why

- **Problem:** the model is bigger than any one view, and the canvas does not help find a thing in
  it. ⌘K lists only the Module Map and Dependencies — not Concerns, not one view from `Views/`. Picking
  an element there only sets the selection: the canvas does not move, and when the element is not on
  the open view nothing visible happens at all. Clicking it in the sidebar tries to centre it and, off
  this view, fails without a word. Nothing says which views an element is drawn in, so "where else
  does Payments show up?" means opening every view. Every view is re-fitted each time it is opened, so
  the zoom someone set up for a meeting is lost by looking somewhere else for a second, and there is
  no way back to where they just were.
- **Why now:** it is the first thing a person does in a model they did not draw, and the thing a
  presenter does live when the room asks "and where is X?".
- **Value:** any element is two keys and a few letters away, on a view that shows it, lit so the eye
  finds it; and wherever that took you, ⌘[ brings you back exactly as you were.
- **Out of scope:** sharing a link to a view with someone else — Stemma runs on the author's machine,
  so a link names a port only that machine has; the report has its own deep links (F-001).

## 2. User story & acceptance criteria

> As an **architect**, I want to **jump to any element or view, and back**, so that **the model is as
> easy to move around as a set of documents**.

- [x] AC1 — **⌘K lists every view** — Module Map, Dependencies, Concerns and every view from `Views/`
      with how many elements it draws — the one on screen marked; every book; every element with its
      kind and where it lives (its bounded context or system), found by name, id, kind or that place;
      and the actions *Go back*, *Go forward*, *Keyboard shortcuts* and *Switch theme*.
- [x] AC2 — **Choosing an element takes you to it.** If the open view draws it, the canvas glides to
      it; otherwise the view that draws it is opened first — the Module Map for any kind it draws, a
      view from `Views/` for a Concept — and the toast says which. The element is selected, centred and
      ringed once, briefly, so the eye lands on it. Under reduced motion the canvas moves at once and
      the ring does not pulse. The same happens from the sidebar's list, from Tab, and from anywhere
      else that names an element.
- [x] AC3 — **The inspector says where an element appears**: a row of the views that draw it, the one
      on screen marked, and the book pages that point at it, each one click from being on screen.
- [x] AC4 — **Back and forward**: ⌘[ and ⌘] (Ctrl on Linux and Windows), and ‹ › beside the view
      tabs, go back and forward through the views visited, each named in its tooltip ("Back to Module
      Map"), greyed when there is nowhere to go.
- [x] AC5 — **A view opens as it was left.** Each view remembers its pan and zoom for the session; a
      view opened for the first time is fitted, as before.
- [x] AC6 — The address keeps the view and the selection (`#view=…&select=…`), so a reload comes back
      to the same place, element revealed.

## 3. Architecture impact

- [x] **Model or presentation?** Neither: navigation is session state in the store; nothing is written.
- [x] **New/changed operations:** none.
- [x] **Sidecar:** none — a remembered viewport is not presentation anyone commits.
- [x] **ADR needed?** No.
- **Affected files/areas:** `lib/navigation.ts` (new, pure), `lib/store.ts` (back/forward),
  `CommandPalette.tsx`, `ArchCanvas.tsx` (reveal, viewport memory), `ArchInspector.tsx` (Appears in),
  `ViewTabs.tsx`, `Sidebar.tsx`, `App.tsx` (keys, address), `styles.css` (the ring).

## 4. UX impact

- [x] **Journey(s) touched:** J1 (orient): step 4 gains search, reveal and back; J6c (present a book):
      answering "where is X?" in the room without leaving the book.
- [x] **States:** an element no view draws (a Concept no view names) — the palette still lists it,
      choosing it selects it and the toast says no view draws it yet; a view that disappeared from the
      back stack (deleted, or pulled away) is skipped.
- [x] **Interactions:** ⌘K, ⌘[, ⌘], Enter in the palette; click on a chip.
- [x] **Accessibility:** the palette is a listbox with type-ahead; chips are buttons with names; the
      ring is an addition to selection, never the only signal; reduced motion honoured.

## 5. UI impact

- [x] **Components touched:** `CommandPalette`, `ViewTabs` (‹ ›), the inspector's Properties panel
      (Appears in), a ring on the revealed card.
- [x] **Tokens:** indigo accent for the ring; no new colours.
- [x] **Both themes:** checked.

## 7. Test plan

- [x] Unit: which views draw an element, and which one to open for it (`navigation.test.ts`); the back
      and forward stacks (`navigation.test.ts`).
- [x] Journey: from the Module Map, ⌘K → an element only a view from `Views/` draws → that view opens
      with it selected; ⌘[ goes back to the Module Map (`tests/journey/navigation.spec.ts`).

## 8. Definition of Done

- [x] All ACs met and demoed
- [x] States handled; accessibility bar met
- [x] `dotnet test` green · `tsc` clean · `vite build` clean · `vitest` green · journeys green
- [x] Docs updated: this record, the features index, `ux/user-journeys.md` (J1), `ui/components.md`

## 9. Notes / open questions

- **Found on the way:** the palette's group headings styled the whole group, so every item in ⌘K was
  set in spaced capitals; Tab cycled through every element of the model by id rather than the cards
  on screen; clicking a view's tab while Concerns was open left the Concerns list on screen.
