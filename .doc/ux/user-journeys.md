# User Journeys

The canonical paths through Stemma. Each names the persona, the steps, the system response, and the
states that must be handled (cross-reference [`states-and-interactions.md`](./states-and-interactions.md)).

## J1 — Open a workspace and orient (Architect)

1. Point Stemma at a folder (a Git working tree with `Architecture/Architecture.cs`).
2. **Loading state** while the engine parses with Roslyn and primes the sidecar.
3. Land on the default **Module Map** view: bounded contexts as lanes, modules nested, links drawn.
4. Switch views via the bottom tab bar (Module Map · Dependencies · saved custom views).

**Must-handle:** empty workspace (no model) → an empty state that explains how to add the first
element; a custom view persisted as active must not trap the user — clicking a built-in view always
returns to it.

## J2 — Edit the model (Architect)

1. Select an element → the inspector rail opens **Appearance**; other panels (Properties, Text &
   attributes, Lifecycle, Ownership, Custom properties, Comments) are one click away.
2. Rename inline, or open **Text & attributes** to write markdown notes and `#tags` (which become
   custom properties).
3. Draw a relationship from a connection dot to another box; reconnect an endpoint by dragging it.
4. Each structural edit is an **operation** → a Roslyn rewrite → a delta echoed to all clients.

**Must-handle:** optimistic application with rollback on failure (a toast explains the reason);
deselecting collapses the inspector to the rail.

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
2. Commit the model + sidecar; reviewers see the change in both the code diff and the canvas.

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

## J7 — Onboard via samples (any persona)

1. Open a sample workspace (e.g. `samples/AuroraRail`) to see every feature exercised across four
   perspective views (sell path, strangler migration, dependency graph, open concerns).

## Authoring rule

A new feature must name **which journey it touches** and **what changes** in each affected step.
Journeys that gain a new branch (e.g. a new error case) update [`states-and-interactions.md`](./states-and-interactions.md).
