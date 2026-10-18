# Feature: Self-explaining views — a header with the point, a legend, and cards you can read

| Field | Value |
|---|---|
| **ID** | F-014 |
| **Status** | `In progress` |
| **Owner** | Bartosz |
| **Persona served** | Solution Architect ("Aria") presenting to the team that has to act on the architecture, and the reader who opens the report afterwards |
| **Roadmap horizon** | `Next` |
| **Created / Updated** | 2026-10-18 / 2026-10-18 |

## 1. Product — why

- **Problem:** A view is boxes and arrows and nothing else. Put on a screen in a meeting, it does
  not say what it is about, what its colours mean, or what the room should take away from it; the
  architect says all of that, every time, and the report says none of it. The draw.io pages the
  same architects make by hand carry a title, a line with the point, a legend and callout boxes,
  and that is why they are easier to follow than the model they were drawn from. Three defects make
  it worse: a card's notes are 11 px whatever its text size and are cut off at 140 px, so a card
  that carries an argument cannot be read from the back of the room; a filled zone drawn behind a
  group of cards covers them ([B-019](../bugs/B-019-shapes-ordered-behind-nodes-are-drawn-over-them.md));
  and the Module Map draws every Concept in the model, which the Concept kind promised it would not
  ([B-020](../bugs/B-020-module-map-draws-concepts.md)) — in a workspace that argues as well as
  describes, that is most of what makes it unreadable.
- **Why now:** Books ([F-013](./F-013-books.md)) made the model presentable; the first real deck
  built with them showed that each picture still needed the architect standing next to it.
- **Value:** *The view explains itself.* What the picture is, the sentence it should leave in the
  room, how to read it and what its colours mean travel with the view: on the canvas, presented, in
  the PDF and in the report. The legend is computed from what is drawn, so it cannot drift from the
  picture the way a hand-drawn key does.
- **Out of scope:** the header in `stemma render` output and in single-image export (a figure's
  caption belongs to the document it is placed in); editing legend entries in the app (they are
  written as text, or computed); per-book-page headers (a page has its narrative).

## 2. User story & acceptance criteria

> As a **solution architect**, I want **every view to carry its title, its point, how to read it
> and what its colours mean,** so that **the room understands the picture while I talk about what
> matters, and a reader who was not there understands it without me.**

- [x] **AC1 — A view can carry a header,** under `views.<key>.header` in `stemma.layout.json`:
  `title`, `message`, `context`, `legend`. Any view: the two built-in lenses and every view in
  `Views/`. It is written as changes ([ADR-0021](../architecture/decisions/0021-sidecar-written-as-changes.md)):
  editing the message changes one line ([ADR-0023](../architecture/decisions/0023-view-headers-in-the-layout-sidecar.md)).
- [x] **AC2 — The header is the top of the page:** the title (the view's name unless one is
  given), the message — the one sentence the view should leave in the room — and the context, in
  Markdown (bold, italic, code, lists), rendered as text and never as markup. The diagram is framed
  beneath it, both when a view opens and when a book page is presented.
- [x] **AC3 — The legend says what the colours mean, from what is drawn.** Without a `legend`:
  one entry per lifecycle status carried by an element in the view, its swatch drawn the way those
  cards are drawn, then one per kind of link drawn. A `legend` list replaces it: an entry names a
  `status` (its swatch taken from the view), or gives its own `swatch` or `line`, each with a
  `label`. `"legend": []` shows none.
- [x] **AC4 — Written in place.** In the app the title, message and context are edited in the header
  itself; Enter (title, message), Ctrl+Enter (context) or leaving the field saves, Esc cancels, and a
  field left as it was writes nothing. An edit changes that one field of the header as the file holds
  it — every other key, the ones the app does not read included, stays as written. The Layout panel
  adds a header to the open view or removes it; removing the last thing a view's entry held removes
  the entry. Collapsing the header belongs to the reader, kept in the browser, not in the file.
- [x] **AC5 — Presented and captured.** Presenting shows the header's title, message and legend,
  read-only, and keeps them while the camera frames a focus, so the room keeps the view's point; the
  context is said rather than shown, and the picture gets the room. The PDF deck's picture of a page
  includes the same. A presented page is framed above the narrative card or beside it, whichever
  draws the picture larger. A single-image export does not carry the header. Empty fields are never
  shown outside the editor.
- [x] **AC6 — The report explains its views too:** each view's header above its diagram, and the
  view's annotations — box shapes with their text, labels, arrows — drawn in it, backdrops beneath
  the cards. A book page in the report shows its view's header.
- [x] **AC7 — Cards readable at presentation size.** `textSize` sizes the card's whole text, title
  and notes, and gains `xl`; a context frame's chip follows its own `textSize`, and an edge label its
  edge's `labelSize`. At `lg` and `xl` a card without a fixed `height` grows to hold its notes,
  in the app and in the report. A card that shows its status but not its kind carries the status
  beside its name, in the card's own colour, rather than on a row of its own.
- [x] **AC8 — Annotation text is Markdown:** a box shape's `text` renders bold, italic, code and
  lists, in the app and in the report, as text and never as markup.
- [x] **AC9 — A backdrop stays behind** (fixes B-019). A shape whose `z` is below zero is drawn
  beneath the cards and the links. It is selected and moved by its own outline — the rectangle's edge,
  the ellipse's curve — drawn beneath the cards too, so a card on a zone's edge keeps its clicks.
- [x] **AC10 — The Module Map shows no Concepts** (fixes B-020, as [F-010](./F-010-concept-element-kind.md)
  AC2 always said): a Concept appears only in the views that name it, in the app and in the report.
  Adding one while a built-in lens is open says where it went. Every view is fitted once its cards
  are on the canvas — the Module Map used to open unfitted on a fresh load.
- [x] **AC11 — `stemma validate` checks headers:** `header/malformed` for a field of the wrong
  type, `header/unknown-status` for a legend entry naming a status no element in the view carries.
- [x] **AC12 — Authorable as text.** The schema describes `header` and `textSize: "xl"`; the
  protocol reference shows a header.

## 3. Architecture impact

- [x] **Model or presentation?** Presentation, entirely
  ([ADR-0023](../architecture/decisions/0023-view-headers-in-the-layout-sidecar.md)).
- [x] **New/changed operations:** none. No source file is touched.
- [x] **Fidelity:** the sidecar contract of ADR-0021 applies; header edits go through the same
  change list and the same text patcher as positions, styles and books.
- [x] **Engine purity:** the engine stores the member without reading it. The CLI's validate reads
  it.
- [x] **Sidecar:** a new member of a view's entry, described in the schema:

  ```json
  "views": {
    "custom:view_target": {
      "header": {
        "title": "Target · one shared graph, a private overlay per buyer",
        "message": "One shared graph of the real world, with a private overlay per buyer.",
        "context": "Left to right: who uses it, the surfaces, the read models, the graph, the engines.",
        "legend": [
          { "status": "reuse", "label": "reuse — runs today" },
          { "status": "build", "label": "build — new" },
          { "line": { "color": "#64748b", "style": "dashed" }, "label": "projected from" }
        ]
      }
    }
  }
  ```
- [x] **ADR needed?** [ADR-0023](../architecture/decisions/0023-view-headers-in-the-layout-sidecar.md).
- **Affected files/areas:** `src/Stemma.Web.Client/src/lib/viewHeader.ts` and `lib/viewFilter.ts` (new), `lib/layout.ts`,
  `lib/store.ts`, `components/ViewHeader.tsx` (new), `components/ArchCanvas.tsx`,
  `components/ShapeLayer.tsx`, `components/nodes/ArchNodeView.tsx`, `components/LayoutPanel.tsx`,
  `lib/lenses.ts`, `lib/canvasReveal.ts`, `report/reportData.ts`, `report/viewer.js`,
  `report/viewer.css`, `src/Stemma.Cli/WorkspaceCheck.cs`, `schema/stemma.layout.schema.json`.

## 4. UX impact

- [x] **Journeys touched:** the canvas (J2), presenting a book (J6c) and the report (J6).
- [x] **States:** no header (the Layout panel offers one); a header with empty fields (prompts in
  the editor, nothing outside it); collapsed; presenting; capturing.
- [x] **Interactions:** click a field to edit it; the keys in AC4; the collapse toggle; a backdrop
  is selected by its outline.
- [x] **Accessibility:** the header is a `banner`-like region named after the view; every field is
  reachable by keyboard; the legend is a list.

## 5. UI impact

- [x] **Components:** `ViewHeader` (new): title, message, context on the left, the legend on the
  right, in one band across the top of the canvas.
- [x] **Tokens:** the canvas surface and text tokens; the message uses the strong text colour, not
  an accent, so the view's own colours stay the only colours that mean something.
- [x] **Both themes:** yes.

## 6. Technical prerequisites & dependencies

- [F-013](./F-013-books.md) for presenting and the PDF deck; [ADR-0021](../architecture/decisions/0021-sidecar-written-as-changes.md).

## 7. Test plan

| Kind | What it proves |
|---|---|
| Unit (`viewHeader.test.ts`) | Parsing tolerates hand edits; the computed legend lists the statuses and link kinds drawn, with swatches as drawn; an explicit legend replaces it; `[]` shows none; an edit is one change. |
| Unit (`lenses.test.ts`, canvas filter) | The Module Map renders no Concept; a view that names one still does. |
| Unit (report) | The report draws a view's header, legend and shapes, text as text. |
| Unit (C#, `WorkspaceCheckTests`) | `header/malformed`, `header/unknown-status`. |
| Journey (`view-header.spec.ts`) | A header is added, edited and survives a reload; it is shown when presenting; a filled `z: -1` rect under a card leaves the card visible and clickable, at its centre and on the zone's edge (B-019). |

## 8. Definition of Done

- [x] All ACs ticked, tests green, both themes checked on screen.
- [x] Docs: protocol reference, schema, roadmap, this record.

## 9. Notes / open questions

- The header is screen-space, not canvas-space: drawn on the canvas it would scale with the zoom and
  leave the frame whenever a page frames its focus — exactly when the room most needs the view's
  point. See ADR-0023.
