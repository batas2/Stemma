# Feature: Find on the view — light what matches, fade the rest

| Field | Value |
|---|---|
| **ID** | F-018 |
| **Status** | `Shipped` |
| **Owner** | Bartosz |
| **Persona served** | Solution Architect ("Aria") presenting live; Stakeholder ("Priya") asking "and what does team X own?" |
| **Roadmap horizon** | `Later` → built (Search & filter on the canvas) |
| **Created / Updated** | 2026-10-21 / 2026-10-21 |

## 1. Product — why

- **Problem:** in a meeting the room asks a question the prepared pages did not foresee — "what does
  the Core squad own here?", "which of these are still only a target?", "where does PCI data go?".
  The answer is in the model (squad, status, `#tags`, notes), but the only way to show it is to point
  at boxes one by one, or build a book page on the spot. The dependency lens has a focus mode for one
  element's neighbours; nothing lights a set of elements by what they are.
- **Why now:** books (F-013) and the dimming they brought made "light some, fade the rest" a thing
  the canvas already knows how to draw; a query is the missing way to say which.
- **Value:** any question about who owns what, or what state it is in, answered on the picture in a
  few keystrokes, live, in front of the room — and turned into a slide in one click if it should stay.
- **Out of scope:** searching across views (that is ⌘K, F-016); saved filters; filtering
  relationships by their own attributes (a relationship stays lit when both its ends are).

## 2. User story & acceptance criteria

> As an **architect presenting**, I want to **light what matches a question and fade the rest** so
> that **the room sees the answer without my rebuilding the picture**.

- [x] AC1 — **⌘F** opens a find bar on the canvas, below the view's header; ⌘F again takes the focus
      back to it; Escape (or ×) closes it and the canvas is as it was.
- [x] AC2 — A query of words, all of which must match. A plain word matches anything a card says
      about itself — name, id, kind, the context or system it is in, squad, domain, status, phase, its
      notes and custom properties. `status:`, `phase:`, `squad:` (or `owner:`), `domain:`, `kind:`,
      `in:` and `tag:` narrow a word to one field; `#pci` is `tag:pci`; "quoted words" are one word.
- [x] AC3 — What matches stays lit, with the bounded context it sits in; the rest **fades**, or —
      one click — is **hidden**. Relationships stay lit when both their ends are. "No matches" fades
      nothing and says so.
- [x] AC4 — The statuses, squads and kinds the view's cards carry are offered as chips with counts;
      a tap adds that filter, another tap takes it out.
- [x] AC5 — **Enter** (and ⌘G) walks the matches in reading order — top to bottom, left to right —
      gliding to each and ringing it; Shift+Enter walks back; the bar says "3 of 7".
- [x] AC6 — With a book open on a page of this view, **Point the page at these** makes the matches
      the page's focus — the question becomes a slide.
- [x] AC7 — Nothing is written: finding is session state. While presenting, the bar is not drawn and
      lights nothing.

## 3. Architecture impact

- [x] **Model or presentation?** Neither; session state in the store. A page's focus, when the
      matches are made into one, is the book edit F-013 already writes.
- [x] **New/changed operations:** none. **Sidecar:** none. **ADR:** no.
- **Affected files/areas:** `lib/spotlight.ts` (new, pure), `components/FindBar.tsx` (new),
  `ArchCanvas.tsx` (lighting: the find bar's in place of a page's while it is open), `lib/store.ts`,
  `App.tsx` (⌘F, Escape), `CommandPalette.tsx`, `ShortcutHelp.tsx`.

## 4. UX impact

- [x] **Journey(s) touched:** J6c (present a book): a question from the room answered live, and kept
      as a page. J1 (orient): "what is in this view, by owner or status?".
- [x] **States:** empty query — nothing faded, no count; no matches — nothing faded, "No matches" in
      the warning colour; Concerns open — ⌘F does nothing (it is a list, not a canvas).
- [x] **Interactions:** ⌘F, typing, Enter / Shift+Enter / ⌘G, chips, Fade/Hide, Escape.
- [x] **Accessibility:** a `search` landmark; the count is a polite live region; chips are toggle
      buttons with `aria-pressed`; fading is never the only signal — the count and the walk name it.

## 5. UI impact

- [x] **Components:** `FindBar` (new) — a floating panel, top centre, below the header.
- [x] **Tokens:** `surface-overlay`, indigo accent for the active chip and mode, amber for the book action.
- [x] **Both themes:** checked.

## 7. Test plan

- [x] Unit: parsing, matching by field and anywhere, facets and their tokens, toggling a facet,
      context kept lit (`spotlight.test.ts`).
- [x] Journey: ⌘F, a squad chip lights the squad's cards and fades the rest; Enter walks and selects;
      Escape restores the canvas; nothing written (`tests/journey/find.spec.ts`).

## 8. Definition of Done

- [x] All ACs met and demoed
- [x] States handled; accessibility bar met
- [x] `dotnet test` green · `tsc` clean · `vite build` clean · `vitest` green · journeys green
- [x] Model/presentation boundary respected; no new data store
- [x] Docs updated: this record, the features index, `ux/user-journeys.md`, `ui/components.md`
