# Feature: Books — tell the architecture as a story, and present it

| Field | Value |
|---|---|
| **ID** | F-013 |
| **Status** | `In progress` |
| **Owner** | Bartosz |
| **Persona served** | Solution Architect ("Aria") presenting to the team that has to act on the architecture; the Essayist's Agent ("Ada") writing a book by hand |
| **Roadmap horizon** | `Next` |
| **Created / Updated** | 2026-10-18 / 2026-10-18 |

## 1. Product — why

- **Problem:** Architecture is mostly shown in meetings, to bring the team that receives it into
  alignment. The architect shows static diagrams and does most of the work by talking: first the
  wider context, then down to the part that matters today. The diagram cannot point at what is
  being discussed, cannot move from context to detail, and holds none of the words, so the story
  has to be told again from memory every time and is lost to anyone who missed the meeting.
- **Starting point:** Books existed as a sketch. They were read from
  `Concepts/view-book.stemma.yaml` by an adapter otherwise retired, and nothing wrote them: a book
  created in the app, or a narrative edited, was gone on reload. A page could not be added from the
  UI at all. A page pointing at a view in `Views/` did not switch the canvas, which is every page
  of both samples' books. A page always showed its whole view, so the AuroraRail book shows the
  same picture three times while its text says "follow the arrows" and "Payment Orchestration is
  the only module allowed…". The PDF export never received the diagrams, and the HTML report did
  not include books.
- **Why now:** It is the job the target user does every week, and it is where the model starts
  paying back in front of other people. Every other part of Stemma makes the model true; this is
  the part that makes it understood.
- **Value:** *One source for the picture and the story.* A book is a walk through the live model,
  versioned beside it in Git. A rename in code is a rename in the slides; a deleted element is a
  broken page that `stemma validate` reports, not a slide that quietly lies. The same walk is the
  meeting, the leave-behind report and the PDF.
- **Out of scope:** a presenter view with private notes on a second screen; PowerPoint export;
  per-page positions or annotations (a page frames a view as it is laid out); `stemma render
  --book`; filtering books by audience; recording a presentation.

## 2. User story & acceptance criteria

> As a **solution architect**, I want **to walk a team through the architecture from the wide
> context down to the detail, with the diagram showing what I am talking about,** so that **the
> team ends the meeting aligned, and anyone who missed it can follow the same walk afterwards.**

- [x] **AC1 — Books persist.** Creating, renaming and deleting a book, and adding, editing,
  reordering and removing pages, each write to `books` in `stemma.layout.json` and nowhere else.
  A reload or a fresh clone shows the same book.
- [x] **AC2 — The diff is the edit.** Editing one page's narrative changes one line of the
  sidecar; a reorder changes only the book's `order`; every other byte stays, including in a file
  Stemma did not write ([ADR-0021](../architecture/decisions/0021-sidecar-written-as-changes.md),
  [ADR-0022](../architecture/decisions/0022-books-in-the-layout-sidecar.md)).
- [x] **AC3 — A page shows its view,** built-in or from `Views/`, and the canvas switches to it.
- [x] **AC4 — A page points.** Focused elements, and links between two focused elements, stay
  lit; the rest dim, or are hidden when the page says `others: "hide"`. A bounded context holding a
  focused element stays lit.
- [x] **AC5 — A page frames.** It frames the whole view or only its focus. Moving between pages
  animates the camera, so going from context to detail is a zoom rather than a cut; under
  reduced motion it is immediate.
- [x] **AC6 — Authoring from the canvas.** *Add page* takes the current view and the current
  selection as the focus. An existing page can take the current view, take the selection as its
  focus, or clear its focus. Title, narrative, frame and the dim/hide choice are edited in place,
  and pages can be duplicated, removed and reordered by dragging.
- [x] **AC7 — Presenting.** Full screen where the platform allows, no app chrome, a read-only
  canvas, the narrative over the diagram. Next: → ↓ Space PageDown Enter; previous: ← ↑
  PageUp Backspace; Home and End; a presentation clicker works because it sends PageUp/PageDown.
  Esc stops, N hides or shows the narrative, B blanks the screen. Presenting writes nothing.
- [x] **AC8 — Broken pages are visible.** A page whose view no longer exists, or whose focus names
  an element no longer in the model, is marked in the editor and says so when presented.
  `stemma validate` reports `book/missing-view`, `book/dangling-focus`, `book/focus-outside-view`
  and `book/dangling-order`, and `book/legacy-file` for books left in the old YAML file.
- [x] **AC9 — The report tells it too.** The HTML report has a Books section that steps through
  each book: the page's view with its focus and frame, the narrative, previous/next, arrow keys,
  offline.
- [x] **AC10 — The PDF is the deck.** A book's PDF has a cover and one landscape page per book page:
  the diagram as presented, with its focus and frame, the title and the narrative.
- [x] **AC11 — The samples carry their books in their sidecars,** with focus and framing that tell
  the story their narratives already tell. `Concepts/view-book.stemma.yaml` is gone and is not
  read.
- [x] **AC12 — Authorable as text.** The schema describes `books`, and the protocol reference shows
  how to write one.

## 3. Architecture impact

- [x] **Model or presentation?** Presentation, entirely
  ([ADR-0022](../architecture/decisions/0022-books-in-the-layout-sidecar.md)).
- [x] **New/changed operations:** none. No source file is touched.
- [x] **Fidelity:** the sidecar contract of ADR-0021 applies. Book edits go through the same
  change list and the same text patcher as positions and styles.
- [x] **Engine purity:** the engine stores the section without reading it. The CLI's validate
  reads it.
- [x] **Sidecar:** a new top-level `books` section, described in the schema:

  ```json
  "books": {
    "book_ticket_sold": {
      "name": "How a Ticket Is Sold",
      "audience": "engineering",
      "order": ["path", "money"],
      "pages": {
        "path":  { "title": "The path a purchase takes", "view": "view_buy", "narrative": "…" },
        "money": { "title": "Where the money moves", "view": "view_buy", "narrative": "…",
                   "focus": ["mod_payment", "ext_psp"], "frame": "focus" }
      }
    }
  }
  ```

  `frame` is `view` or `focus`, and defaults to `focus` when the page has a focus and `view`
  otherwise. `others` is `dim` (the default) or `hide`.
- [x] **ADR needed?** [ADR-0022](../architecture/decisions/0022-books-in-the-layout-sidecar.md).
- **Affected files/areas:** `src/Stemma.Web.Client/src/lib/books.ts` (new), `lib/layout.ts`,
  `lib/store.ts`, `components/BooksPanel.tsx`, `components/BookFooter.tsx` (the editor),
  `components/BookPresenter.tsx` (new), `components/ArchCanvas.tsx`, `App.tsx`,
  `report/reportData.ts`, `report/viewer.js`, `src/Stemma.Web/StemmaWebHost.cs`,
  `src/Stemma.Web/Services/BookPdfExporter.cs`, `src/Stemma.Engine/Adapters/Yaml/`,
  `src/Stemma.Cli/WorkspaceCheck.cs`, `schema/stemma.layout.schema.json`, both samples.

## 4. UX impact

- [x] **Journey touched:** J6 (export & share) gains J6c, *present a book* — see
  [`../ux/user-journeys.md`](../ux/user-journeys.md).
- [x] **States:** no books (the panel offers to create one); an empty book (the editor offers
  *Add page*); a broken page (marked, and named when presented); an unreadable sidecar (books are
  not editable, as with every other sidecar edit); presenting.
- [x] **Interactions:** the keys in AC7; dragging page chips to reorder; *Add page* from the
  current view and selection.
- [x] **Accessibility:** every control reachable by keyboard; the page strip is a list with the
  current page marked; the presenter announces the page title; camera moves respect
  `prefers-reduced-motion`.

## 5. UI impact

- [x] **Components:** `BooksPanel` (list, create, rename, delete, present), `BookFooter` (the
  editor: page strip and page form), `BookPresenter` (new, the full-screen overlay).
- [x] **Tokens:** the existing amber book accents; the presenter uses the canvas theme.
- [x] **Both themes:** the presenter follows the app theme.
- [x] **Layout:** the editor sits where the book footer was, under the canvas. The presenter
  covers the window.

## 6. Technical prerequisites & dependencies

- [x] The sidecar change writer (ADR-0021) and outside-change re-read.
- [x] `html-to-image` for capturing pages for the PDF (already used by the image export).
- [x] QuestPDF for the PDF (already used).
- [x] Samples converted from YAML to the sidecar, with focus added where the narrative points.

## 7. Test plan

- [x] Engine: book edits through `SidecarPatch` against a minimal, a realistic and a pathological
  sidecar. Each changes only its own bytes. (The pathological reorder found that a one-line array
  was spread over four lines when its value changed; `JsonText.ReplaceValue` now keeps it on one.)
- [x] Client unit: reading books (order, defaults, tolerance of hand edits); each edit produces
  the smallest change; broken-page detection; focus and frame resolution; the presenter's keys;
  the report bundle's books (`books.test.ts`, `bookStore.test.ts`, `bookFrame.test.ts`,
  `presenterKeys.test.ts`, `report.test.ts`).
- [x] CLI: the `book/*` rules, and `book/malformed` for a hand edit gone wrong.
- [x] Web: the PDF with page images, and the endpoint's limits (`BookPdfExporterTests`,
  `BookPdfEndpointTests`, `NarrativeTextTests`).
- [x] Journey: build a book in the app, reload, present it with the keyboard, and check that the
  sidecar diff holds the book and nothing else, and that presenting wrote nothing
  (`tests/journey/books.spec.ts`).
- [x] Samples: both samples' books load from the sidecar and point at views and elements that
  exist; `stemma validate` reports no `book/*` finding on either.

## 8. Definition of Done

- [ ] All ACs met and demoed
- [ ] States handled; accessibility bar met
- [ ] `dotnet test` green · `tsc` clean · `vite build` clean · `vitest` green · journeys green
- [ ] Model/presentation boundary respected; no new data store
- [ ] Docs updated: this record, ADR-0022, the decision index, the features index, the roadmap,
  `ux/user-journeys.md`, `ui/components.md`, `protocol/authoring-a-diagram.md`
- [ ] Reviewed against all four pillars

## 9. Notes / open questions

- **What others do.** [Ilograph walkthroughs](https://www.ilograph.com/docs/editing/walkthroughs/)
  are the closest: slides over a perspective, each with text, *highlight* (fade the rest) or
  *select* (hide the rest); viewers can leave to explore and resume.
  [IcePanel Flows](https://docs.icepanel.io/features/flows) step through messages between objects
  on one diagram, with arrow keys and a share link, and limit free plans to three flows.
  [Structurizr animation](https://docs.structurizr.com/ui/diagrams/animation) reveals a view's
  elements in steps. Stemma's difference is where the book lives: in the repository, next to code
  that compiles, reviewed in pull requests, and checked by `stemma validate` so that a slide cannot
  outlive the element it points at.
- **Found on the way, left as they are:** a page added after a page written on one line is
  written over several; a one-line array that changes loses the spaces after its commas
  (`["a", "b"]` comes back `["b","a"]`); an escaped character in a changed value is written with
  upper-case hex. None changes what the file says, and all are the sidecar writer's, not books'.
- **Deferred:** a presenter view (narrative and next page on a second screen); step-by-step
  messages in the IcePanel sense, which want a `DataFlow` order rather than a page; PowerPoint
  export with narratives as speaker notes; `stemma render --book <id> --page <id>` for agents.
