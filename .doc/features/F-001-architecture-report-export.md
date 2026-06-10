# Feature: Architecture Report — single-file interactive HTML export

| Field | Value |
|---|---|
| **ID** | F-001 |
| **Status** | `Draft` — **decision gate: answer §9 before implementation** |
| **Owner** | Bartosz |
| **Persona served** | Sam (builder) · Priya (stakeholder) · Aria-as-reviewer (peer architect) — authored by Aria/Devin |
| **Roadmap horizon** | `Next` |
| **Created / Updated** | 2026-06-10 / 2026-06-10 |

**What it is.** One self-contained `*.report.html` file exported from Verso that anyone can open in
a browser with zero installation: an interactive, read-only publication of the architecture model —
all views, navigable and searchable, with show/hide layers, per-audience reading modes, the
concerns board, and an asynchronous comment loop that round-trips feedback back into the workspace.
It is the async counterpart of the live canvas: Verso is where the model is edited; the report is
how everyone else reads, follows, and challenges it.

## 1. Product — why

- **Problem:** The model lives in a repo and renders only inside a running Verso instance. The
  people who must consume it — engineers implementing it, stakeholders tracking how the system
  changes, peer architects challenging decisions — don't run Verso. Today they get lossy artifacts
  (PNG/SVG screenshots, Mermaid text, a PDF book): static, single-view, comment-less, and quickly
  stale. Feedback arrives over chat/email, detached from the elements it concerns.
- **Why now:** The model substrate is ready to be published: typed relationships, lifecycle/status
  tags, notes, concerns (questions/assumptions/risks), saved views, and a comments sidecar
  (`comments.verso.json`) all exist. What's missing is purely the distribution surface.
- **Value:** Extends "the architecture is the deliverable" beyond the repo: one beautiful, legible
  file that is the shared reference for build, review, and status — and a feedback channel that
  lands back in the model instead of in chat scrollback.
- **Out of scope (v1):** live multi-user editing; hosted collaboration backend; editing the model
  from the report; PDF generation (Books PDF already exists); real-time sync between an open report
  and the workspace.

## 2. User story & acceptance criteria

> As **Sam (senior engineer)**, I want the full detail — elements, ids, attributes, relationship
> types and payloads, notes — navigable per view, so that I can implement against the architecture
> without asking the architect to screen-share.

> As **Priya (stakeholder)**, I want a plain-language summary and a view of how the system is
> changing (current vs. target, statuses, phases) so that I can follow progress without learning
> the notation.

> As a **peer Solution Architect**, I want to inspect every view with concerns and rationale
> visible, and to leave element-anchored comments asynchronously, so that I can challenge the
> architecture and the author can act on my feedback inside Verso.

- [ ] AC1 — Export produces exactly **one** `.html` file with no external network requests; it
      renders fully offline (`file://`, double-click) in current Chrome/Firefox/Safari/Edge.
- [ ] AC2 — The report opens with an audience switcher (per Q4); switching modes changes layer
      visibility and detail density without reloading.
- [ ] AC3 — All exported views (per Q6) are navigable from a persistent rail; element search jumps
      to and highlights the element on its view.
- [ ] AC4 — Layers (per Q5) can be toggled show/hide per view; the diagram re-renders instantly and
      legibly at any toggle combination.
- [ ] AC5 — Existing comment threads from `comments.verso.json` display anchored to their targets;
      new comments can be written in the report and exported as a comment pack; importing the pack
      in Verso merges threads into the sidecar without duplicates (per Q3).
- [ ] AC6 — A Concerns page aggregates every Question / Assumption / Risk with its target element,
      status, and counts; concern badges deep-link to it.
- [ ] AC7 — Selecting any element opens a read-only detail panel: kind, name, description/notes,
      lifecycle, ownership, custom properties, and its relationships (in/out, typed).
- [ ] AC8 — The file stays within the size budget (per Q8) on the reference sample workspaces and
      remains responsive (pan/zoom < 16 ms frame on a 200-element model).
- [ ] AC9 — Uploading to Google Drive and sharing works per the distribution decision (Q1), with
      the documented recipient flow.

## 3. Architecture impact

- [ ] **Model or presentation?** Presentation only. The report is a *projection*: model from the
      C# source (read via the existing engine API), presentation from `verso.layout.json` +
      `comments.verso.json`. No new store of truth; the comment pack is a transport envelope whose
      only durable home is the existing comments sidecar.
- [ ] **New/changed operations:** none on the model. One new engine-adjacent capability: *merge
      comment pack into comments sidecar* (sidecar write, same path the comments API already uses —
      not a Roslyn operation, no fidelity fixtures needed).
- [ ] **Fidelity:** untouched — no source rewrites anywhere in this feature.
- [ ] **Engine purity:** `Verso.Engine` is not involved beyond existing reads. Report assembly
      lives in the web layer (per Q9). No HTML/templating enters the engine.
- [ ] **Sidecar:** no schema change to `verso.layout.json`. Comment pack file format
      (`*.comments.verso.json`) reuses the `CommentsSidecar` schema + provenance header
      (author, exported-at, workspace fingerprint).
- [ ] **ADR needed?** Yes, one: *report rendering approach + comment round-trip format* (Q2 + Q3
      outcome). Number it after the decision gate.
- **Affected files/areas:** `src/Verso.Web.Client/src/report/` (new viewer + generator),
  `ExportMenu.tsx`, `lib/comments.ts` (pack import/merge), `Verso.Web` (aggregate export endpoint
  and/or pack-merge endpoint per Q9/Q3), `.doc/` (this record, ADR, user-journeys).

## 4. UX impact

- [ ] **Journey(s) touched:** adds the *publish & review loop* journey: export → upload to Drive →
      recipients read/comment → comment pack returns → author imports → model/comments updated →
      re-export. Documented in `../ux/user-journeys.md` when shipped.
- [ ] **States defined:** export (progress, success-with-size, failure); report (empty view, no
      results in search, zero concerns, no comments yet, comment-draft unsaved warning, "newer
      export may exist" staleness hint with export date in header).
- [ ] **Interactions:** pan/zoom (wheel/trackpad/touch), click-to-inspect, keyboard navigation
      (`/` search, arrows between views, `Esc` closes panel — mirrors the app's shortcuts),
      layer/mode toggles, copy-deep-link (works when hosted; degrades to "view + element name"
      reference when on `file://`).
- [ ] **Accessibility:** full keyboard path; visible focus; WCAG AA contrast in report theme;
      respects `prefers-reduced-motion`; readable at 200% zoom; print stylesheet for the summary
      and concerns pages.

## 5. UI impact

- [ ] **Components touched/added:** report shell is a separate, self-contained bundle (own minimal
      component set — nav rail, mode switcher, layer panel, detail panel, comment thread, concerns
      board). It reuses Verso's *design language*, not its React components.
- [ ] **Tokens:** report inlines the token values (colors/spacing/type scale) from
      `../ui/design-tokens.md` so it looks like Verso without importing the app bundle.
- [ ] **Both themes:** per Q10.
- [ ] **Layout/rail behavior:** fixed left rail (views + concerns + search), right detail panel,
      top bar (title, workspace, export date, audience mode, layer toggle). Diagram canvas center.
      Responsive down to tablet width; stakeholder summary readable on mobile.

## 6. Technical prerequisites & dependencies

- [ ] A second Vite build target ("report viewer") producing a single inlineable JS+CSS artifact,
      embedded into the export at generation time.
- [ ] One aggregate read of workspace state at export time: arch model, layouts, edge styles, node
      styles, notes, custom props, comments, views, books (single endpoint or batched existing
      calls — per Q9).
- [ ] Markdown/notes sanitizer for embedding user text into standalone HTML (XSS-safe by
      construction; report runs wherever the file lands).
- [ ] Layout geometry source: positions from `verso.layout.json`; node sizes measured/captured at
      export time so the report matches the canvas pixel-for-pixel.
- [ ] Comment pack import endpoint/UI (per Q3).

## 7. Test plan

- [ ] Unit tests: report data assembly (model+sidecar projection), layer predicate logic, comment
      pack merge (dedupe by id, thread append, resolved-flag conflict rules).
- [ ] Golden-file test: generate report for `samples/NetworkAggregation` and
      `samples/VersoArchitecture`; assert single-file invariant (no `http(s)://` fetches), size
      budget, and presence of every view/element anchor.
- [ ] Browser smoke (Playwright): open generated file via `file://`, switch modes, toggle layers,
      search → jump, open element panel, write comment → export pack.
- [ ] Round-trip test: pack exported from report imports into a workspace and merges into
      `comments.verso.json` losslessly; re-import is idempotent.
- [ ] Accessibility pass on the report shell (keyboard-only walk, contrast check).

## 8. Definition of Done

- [ ] All ACs met and demoed on two sample workspaces
- [ ] §9 decisions recorded (boxes ticked), ADR written and `Accepted`
- [ ] States handled; accessibility bar met; both report themes (per Q10) verified
- [ ] `dotnet test` green · `tsc` clean · `vite build` (app + report target) clean · `vitest` green
- [ ] Model/presentation boundary respected; no new data store beyond the existing comments sidecar
- [ ] Docs updated in the same PR: this record → `Shipped`, features index, user-journeys, ADR
- [ ] Reviewed against all four pillars

## 9. Open questions — **answer before implementation**

> Tick **exactly one** box per question (Q5 is multi-select). ✅ marks the recommended option.
> When every question has an answer, flip Status to `Ready` and write the ADR from Q2/Q3.

### Q1 — Distribution & the Google Drive reality

Google Drive's built-in preview does **not** execute JavaScript in HTML files; an interactive
report on Drive is *stored and shared* there, but recipients must download and open it (one
double-click, fully offline).

- [ ] **A (✅ recommended):** Single `.html` on Drive; recipient downloads and opens locally.
      Document this flow on the export success toast ("Share on Drive — recipients download and
      open").
- [ ] **B:** A + an additional "hosted" variant (small folder with `index.html`) for static hosts
      (GitHub Pages, S3, internal nginx) where deep links work as real URLs.
- [ ] **C:** A now, B as a follow-up feature record.

### Q2 — Rendering approach inside the report

- [ ] **A (✅ recommended):** Embed the model + presentation as JSON and re-render with a small
      standalone renderer (positions/sizes captured from the live canvas; same edge-path math
      compiled in). Crisp at every zoom, true layer toggling, element-level interactivity, text
      selectable/searchable.
- [ ] **B:** Pre-rendered SVG snapshot per view (pixel-true, simplest) — layers and per-element
      interaction limited to what we annotate into the SVG; larger files on big models.
- [ ] **C:** Hybrid: SVG base layer + JSON-driven overlay for selection/comments.

### Q3 — The comment / collaboration loop

- [ ] **A (✅ recommended):** Comments are written inside the report (drafts kept in
      `localStorage`), then exported as a **comment pack** (`*.comments.verso.json`, one click,
      includes author name prompt). The author imports the pack in Verso (Comments panel → Import)
      which merges threads into `comments.verso.json` by id. Fully offline, no service, anchored to
      elements/views.
- [ ] **B:** Rely on Google Drive's own file-level comments only (zero build cost, but feedback is
      not anchored to elements and never lands in the model).
- [ ] **C:** A + B documented together (pack for architects, Drive comments for casual notes).
- [ ] **D:** Display-only in v1 (show existing threads, no authoring); pack loop in v2.

### Q4 — Audience reading modes

- [ ] **A (✅ recommended):** Three presets — **Builder** (full detail: ids, attributes, payloads,
      notes), **Stakeholder** (summary page first, capability/system altitude, statuses & phases,
      no ids), **Reviewer** (everything + concerns overlay + comments expanded) — each preset just
      pre-configures the free layer/detail toggles, which stay user-adjustable.
- [ ] **B:** No presets; free layer toggles only.
- [ ] **C:** Per-audience separate export files (conflicts with the single-file requirement —
      listed for completeness).

### Q5 — Layer dimensions available for show/hide (multi-select: tick all wanted in v1)

- [ ] Element kinds (modules / systems / containers / people / use cases / capabilities) ✅
- [ ] Relationship types (uses / calls / publishes / subscribes / reads / writes / data flows, per
      type) ✅
- [ ] Concerns overlay (questions / assumptions / risks + their `about` links) ✅
- [ ] Lifecycle status badges & styling (current / target / to-be-created / deprecated …) ✅
- [ ] Bounded-context grouping boxes ✅
- [ ] Notes & custom-property rows on nodes
- [ ] Fan-in/out metrics badges

### Q6 — Which views ship in the report

- [ ] **A (✅ recommended):** All built-in views (Module Map, Dependencies, Concerns) + all saved
      custom views, each with its persisted layout.
- [ ] **B:** A + Books rendered as narrative chapters (page narrative + its view) — the "guided
      tour" for stakeholders.
- [ ] **C:** Only the currently open view (minimal v1).

### Q7 — "How the system changes" for stakeholders

- [ ] **A (✅ recommended):** Derive from what the model already says: lifecycle status coloring,
      current-vs-target counts, phase timeline ("Q4 2026: 3 modules to-be-created…"), deprecations
      — zero new data to maintain.
- [ ] **B:** Embed a baseline (previous export) and compute a real diff (added/removed/changed
      elements & links) — strongest story, more work + needs a baseline to exist.
- [ ] **C:** Git-derived changelog of the architecture files (later; backend work).

### Q8 — Size budget & embedded assets

- [ ] **A (✅ recommended):** Target ≤ 5 MB on the reference samples; system font stack (no font
      files); inline SVG icons only; fail the export with a clear message if a pathological
      workspace exceeds 25 MB.
- [ ] **B:** A + embed the brand font (≈ +300 KB) for pixel-identical typography.
- [ ] **C:** No budget; embed everything.

### Q9 — Where the report is assembled

- [ ] **A (✅ recommended):** Client-side generation: the running frontend fetches one aggregate
      payload (new lightweight `GET /api/workspace/export-bundle`), injects it plus the prebuilt
      viewer bundle into an HTML template, and triggers the download. Backend stays thin; engine
      untouched.
- [ ] **B:** Backend endpoint renders the whole file (`GET /api/export/report.html`) — also usable
      from CI/CLI without a browser, slightly more backend surface.
- [ ] **C:** Pure client from already-loaded state (no new endpoint; risks drifting from on-disk
      truth if the browser state is stale).

### Q10 — Report theme

- [ ] **A (✅ recommended):** Light theme default (paper-like, print-friendly) + dark toggle,
      honoring `prefers-color-scheme`.
- [ ] **B:** Light only.

### Q11 — Entry point & cadence

- [ ] **A (✅ recommended):** Export menu → "Architecture report (.html)" alongside PNG/SVG/
      draw.io/Mermaid; manual, on demand.
- [ ] **B:** A + headless generation hook (CLI/endpoint) so CI can publish a nightly report (pairs
      with Q9-B; can be a follow-up record).

---

*When the boxes above are ticked: set Status `Ready`, write the ADR (rendering + comment
round-trip), and update the features index. Implementation must not start from a `Draft` record.*
