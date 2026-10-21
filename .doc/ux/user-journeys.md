# User Journeys

The canonical paths through Stemma. Each names the persona, the steps, the system response, and the
states that must be handled (cross-reference [`states-and-interactions.md`](./states-and-interactions.md)).

## J1 — Open a workspace and orient (Architect)

1. Point Stemma at a folder (a Git working tree with `Architecture/Architecture.cs`). In the desktop
   shell this is the OS folder picker; in a browser tab, where no such thing exists, it is still a
   typed path ([F-002](../features/F-002-desktop-shell.md) AC4). Either way the folder can also
   arrive from outside: `stemma-desktop <folder>`, or "Open with…" on the folder itself.
2. **Loading state** while the engine parses with Roslyn and primes the sidecar.
3. Land on the default **Module Map** view: bounded contexts as lanes, modules nested, links drawn.
4. Switch views via the bottom tab bar (Module Map · Dependencies · saved custom views).
5. **Find anything** ([F-016](../features/F-016-go-anywhere.md)): ⌘K, a few letters of an element, a
   view or a book, Enter. An element is shown on a view that draws it — the one on screen if it can,
   else the Module Map, else a view that names it — selected, centred and ringed once; the toast says
   when the view changed. The inspector's *Appears in* lists every view that draws the element and
   every book page that points at it.
6. **Find the way back**: ⌘[ / ⌘] or ‹ › beside the tabs go back and forward through the views
   visited, and each view opens at the pan and zoom it was left at. The address keeps the view and
   the selection, so a reload lands in the same place.

**Must-handle:** empty workspace (no model) → an empty state that explains how to add the first
element; a custom view persisted as active must not trap the user — clicking a built-in view always
returns to it. In the shell, step 1 has a step 0: the window appears with a splash while the backend
binds, and if it never does, the window says why and where the log is — never a blank white page.

## J1b — Start from nothing (Architect with no repository yet)

The path an evaluator takes, and the one a consultant takes on a new engagement
([F-003](../features/F-003-from-scratch-onboarding.md)). **No filesystem path is typed at any point.**

1. Choose a door: **Start from a template** (a few boxes to react to), **Start empty**, or **Open an
   existing one**.
2. Name it. A model created by name lands in `~/stemma/<name>` as a Git repository with one commit
   and no build output — so the next diff is the author's first edit and nothing else.
3. It opens immediately. A template arrives pre-arranged; an empty model shows in-canvas guidance
   with one primary action rather than a bare grid.
4. Add the first element → the name field is focused and selected. Type, Enter, done.
5. **Once**, and dismissible: the line of C# that element became, quoted from `Architecture.cs`.

**Must-handle:** the guidance disappears for good once the model has an element, including across a
reload; the explainer is shown once per person, not once per model; a workspace created here opens on
a machine with no .NET SDK at all ([ADR-0016](../architecture/decisions/0016-sdk-free-model-only-workspaces.md)).

Three interactions on the template route, four on the empty one — measured, in F-003 §7.1.

## J2 — Edit the model (Architect)

1. Select an element → the inspector rail opens **Appearance**; other panels (Properties, Text &
   attributes, Lifecycle, Ownership, Custom properties, Comments) are one click away.
2. Rename inline, or open **Text & attributes** to write markdown notes and `#tags` (which become
   custom properties).
3. Draw a relationship from a connection dot to another box; reconnect an endpoint by dragging it.
4. Each structural edit is an **operation** → a Roslyn rewrite → a delta echoed to all clients.
5. **Copy, paste, duplicate** ([F-015](../features/F-015-copy-paste-duplicate.md)): ⌘C the selection,
   ⌘V pastes "*Name* copy" — with its tags, its looks and the relationships between the copies —
   cascading beside the originals or in the middle of the screen; right-click → *Paste here* puts it
   somewhere in particular; ⌘D duplicates in place. ⌥⌘C / ⌥⌘V copy a look from one box onto others.
6. **⌘Z undoes the last step, whatever it was** — a move, a look, an edit, a whole paste — and the
   toast names it.

**Must-handle:** optimistic application with rollback on failure (a toast explains the reason);
deselecting collapses the inspector to the rail; a paste refused part-way says which element and
why, and what landed is one ⌘Z away; an open menu keeps the keyboard to itself (Escape closes the
menu, not the selection behind it).

## J3 — Arrange a view (Architect)

1. Open the **Layout** panel from the rail.
2. Pick a layout mode for *this view* — Architectural (by type), Hierarchical, Organic, or Custom.
   The choice applies immediately and is remembered per view.
3. Tune the active algorithm's sliders (live re-apply) or arrange manually.
4. Moving or adding an element flips the view to **Custom** so auto-layout stops fighting manual work.
5. Multi-select (Shift-drag marquee / Ctrl-click) → align & distribute.

**Must-handle:** a drag must never snap back; multi-selection must survive background refreshes.

## J4 — Style & annotate (Architect / Stakeholder-facing)

1. Appearance panel: presets, fills, borders, shadows, animations; edge routing and markers.
2. Add free-form shapes/labels/arrows (the annotation layer) for emphasis.
3. All of this is **presentation** → saved to `stemma.layout.json`, per view, committable in Git.

## J5 — Capture intent (Architect)

1. Attach **Risks / Questions / Assumptions** to the element they concern (`AboutId`); they render as
   dotted "about" links and cluster near their target.
2. Set **Lifecycle** (status/phase) and **Ownership** (squad/domain) — they show as badges.

## J6 — Export & share (Architect → Stakeholder)

1. Export the current canvas (including shapes) to PNG/SVG.
2. Commit the model + sidecar; reviewers see the change in both the code diff and the canvas —
   drawn as a change, with *Compare* (J6d).

## J6b — Publish & review loop ([F-001](../features/F-001-architecture-report-export.md), ADR-0014)

1. **Export → Architecture report (.html)**: one self-contained file with every view, audience
   modes (Builder / Stakeholder / Reviewer), layer toggles, search, the concerns board and a
   change summary.
2. Share it anywhere (Drive, mail, chat). Recipients download and double-click — Drive's preview
   does not run JavaScript, the file itself needs no install and makes no network requests.
3. Reviewers select elements and write comments in the report (kept locally), then **Export
   comment pack** (`<workspace>.comments.stemma.json`) and send it back.
4. The architect imports the pack (inspector → Comments → import); threads merge idempotently into
   `comments.stemma.json`, anchored to the elements they concern. Act, re-export, repeat.

## J6d — Show a change ([F-017](../features/F-017-what-changed.md))

1. **Compare** in the top bar: *the last commit* (what you have changed, counted), *where this branch
   started*, a tag, or a recent commit. The status bar already says how many changes there are since
   the last commit; clicking it is the same as the first choice.
2. The canvas marks what is **New** (green) and **Changed** (amber), draws what was **removed** as a
   struck-through ghost where it used to be, and fades the rest. Relationships likewise.
3. The bar at the bottom names the comparison and counts it; *Changes* lists every change with what
   changed about it; choosing one shows it. The inspector says what changed about the selected card.
4. Keep editing: the marks follow. *Done*, or Escape with nothing selected, ends it.

**Must-handle:** no Git or no repository — Compare is greyed with the reason; a revision that cannot
be read — a toast, and the canvas as it was; nothing changed — "No changes", not an empty list;
comparing writes nothing, and a ghost is never a position in the sidecar.

## J6c — Present a book ([F-013](../features/F-013-books.md))

1. **Build the walk on the canvas.** *New book*, then for each step: open the view, select what to
   point at, *Add page*, write what you will say. The first page is usually the widest view with no
   focus; the next ones point into it, then move to closer views. *Duplicate* makes the next step
   of a zoom.
2. **Answer the room.** A question the pages did not foresee — "what does Core own?" — is ⌘F and a
   chip ([F-018](../features/F-018-find-on-the-view.md)): what matches stays lit, the rest fades or
   hides, Enter walks it. *Point the page at these* keeps the answer as the page on screen's focus.
3. **Present.** ▶ in the panel or the editor. The window becomes the diagram: arrows, Space or a
   clicker turn pages; on one view a page turn is a camera move, so context to detail is a zoom.
   N hides the narrative when you would rather talk, B blanks the screen, Esc stops. With a
   projector, **With notes** (or P while presenting) opens the presenter view
   ([F-019](../features/F-019-presenter-view.md)) on your screen — now, next, the page list, the
   time — and the projector shows the picture alone; either screen turns the page.
4. **Leave it behind.** The HTML report carries every book as a chapter, and *PDF* in the editor
   makes the deck — one landscape page per page, as presented — for whoever was not there.
5. **Keep it true.** The book is in `stemma.layout.json`, reviewed with the model. A renamed
   element is renamed on its slides; a deleted one marks the page broken, and `stemma validate`
   fails on it.

## J7 — Onboard via samples (any persona)

1. Open a sample workspace (e.g. `samples/AuroraRail`) to see every feature exercised across four
   perspective views (sell path, strangler migration, dependency graph, open concerns).

## Authoring rule

A new feature must name **which journey it touches** and **what changes** in each affected step.
Journeys that gain a new branch (e.g. a new error case) update [`states-and-interactions.md`](./states-and-interactions.md).
