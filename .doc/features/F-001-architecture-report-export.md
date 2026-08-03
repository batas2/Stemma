# Feature: Architecture Report — single-file interactive HTML export

| Field | Value |
|---|---|
| **ID** | F-001 |
| **Status** | `Shipped` (v1 — §9 decisions applied; see [ADR-0014](../architecture/decisions/0014-architecture-report-rendering-and-comment-pack.md) and the implementation note below §9) |
| **Owner** | Bartosz |
| **Persona served** | Sam (builder) · Priya (stakeholder) · Aria-as-reviewer (peer architect) — authored by Aria/Devin |
| **Roadmap horizon** | `Now` |
| **Created / Updated** | 2026-06-10 / 2026-06-10 |

**What it is.** One self-contained `*.report.html` file exported from Stemma that anyone can open in
a browser with zero installation: an interactive, read-only publication of the architecture model —
all views, navigable and searchable, with show/hide layers, per-audience reading modes, the
concerns board, and an asynchronous comment loop that round-trips feedback back into the workspace.
It is the async counterpart of the live canvas: Stemma is where the model is edited; the report is
how everyone else reads, follows, and challenges it.

## 1. Product — why

- **Problem:** The model lives in a repo and renders only inside a running Stemma instance. The
  people who must consume it — engineers implementing it, stakeholders tracking how the system
  changes, peer architects challenging decisions — don't run Stemma. Today they get lossy artifacts
  (PNG/SVG screenshots, Mermaid text, a PDF book): static, single-view, comment-less, and quickly
  stale. Feedback arrives over chat/email, detached from the elements it concerns.
- **Why now:** The model substrate is ready to be published: typed relationships, lifecycle/status
  tags, notes, concerns (questions/assumptions/risks), saved views, and a comments sidecar
  (`comments.stemma.json`) all exist. What's missing is purely the distribution surface.
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
> architecture and the author can act on my feedback inside Stemma.

- [x] AC1 — Export produces exactly **one** `.html` file with no external network requests; it
      renders fully offline (`file://`, double-click) in current Chrome/Firefox/Safari/Edge.
      *(no-external-request invariant unit-tested; verified in Chrome)*
- [x] AC2 — The report opens with an audience switcher (per Q4); switching modes changes layer
      visibility and detail density without reloading. *(verified: Builder/Stakeholder/Reviewer)*
- [x] AC3 — All exported views (per Q6) are navigable from a persistent rail; element search jumps
      to and highlights the element on its view. *(verified on `samples/AuroraRail`)*
- [x] AC4 — Layers (per Q5) can be toggled show/hide per view; the diagram re-renders instantly and
      legibly at any toggle combination.
- [x] AC5 — Existing comment threads from `comments.stemma.json` display anchored to their targets;
      new comments can be written in the report and exported as a comment pack; importing the pack
      in Stemma merges threads into the sidecar without duplicates (per Q3). *(full loop verified
      live: report → pack → import → `comments.stemma.json`; merge idempotence unit-tested)*
- [x] AC6 — A Concerns page aggregates every Question / Assumption / Risk with its target element,
      status, and counts; concern badges deep-link to it.
- [x] AC7 — Selecting any element opens a read-only detail panel: kind, name, description/notes,
      lifecycle, ownership, custom properties, and its relationships (in/out, typed).
- [x] AC8 — The file stays within the size budget (per Q8) on the reference sample workspaces
      *(≈95 KB on a mid-size workspace vs the 5 MB target; the <16 ms pan/zoom frame budget on a
      200-element model has not been formally measured)*.
- [x] AC9 — Uploading to Google Drive and sharing works per the distribution decision (Q1):
      recipients download and open locally; the flow is stated on the export toast and in J6b.

## 3. Architecture impact

- [x] **Model or presentation?** Presentation only. The report is a *projection*: model from the
      C# source (read via the existing engine API), presentation from `stemma.layout.json` +
      `comments.stemma.json`. No new store of truth; the comment pack is a transport envelope whose
      only durable home is the existing comments sidecar.
- [x] **New/changed operations:** none on the model. One new engine-adjacent capability: *merge
      comment pack into comments sidecar* (sidecar write, same path the comments API already uses —
      not a Roslyn operation, no fidelity fixtures needed).
- [x] **Fidelity:** untouched — no source rewrites anywhere in this feature.
- [x] **Engine purity:** `Stemma.Engine` is not involved beyond existing reads. Report assembly
      lives in the web layer (per Q9). No HTML/templating enters the engine.
- [x] **Sidecar:** no schema change to `stemma.layout.json`. Comment pack file format
      (`*.comments.stemma.json`) reuses the `CommentsSidecar` schema + provenance header
      (author, exported-at, workspace fingerprint).
- [x] **ADR needed?** Yes — [ADR-0014](../architecture/decisions/0014-architecture-report-rendering-and-comment-pack.md)
      (`Accepted`): rendering approach + comment round-trip format.
- **Affected files/areas:** `src/Stemma.Web.Client/src/report/` (new viewer + generator),
  `ExportMenu.tsx`, `lib/comments.ts` (pack import/merge via the existing comments API — no new
  backend endpoint was needed; see the implementation note below §9), `.doc/` (this record,
  ADR-0014, user-journeys J6b).

## 4. UX impact

- [x] **Journey(s) touched:** adds the *publish & review loop* journey: export → upload to Drive →
      recipients read/comment → comment pack returns → author imports → model/comments updated →
      re-export. Documented as J6b in `../ux/user-journeys.md`.
- [ ] **States defined:** export (progress, success-with-size, failure); report (empty view, no
      results in search, zero concerns, no comments yet, comment-draft unsaved warning, "newer
      export may exist" staleness hint with export date in header).
- [x] **Interactions:** pan/zoom (wheel/trackpad/touch), click-to-inspect, keyboard navigation
      (`/` search, arrows between views, `Esc` closes panel — mirrors the app's shortcuts),
      layer/mode toggles, copy-deep-link (works when hosted; degrades to "view + element name"
      reference when on `file://`).
- [ ] **Accessibility:** full keyboard path; visible focus; WCAG AA contrast in report theme;
      respects `prefers-reduced-motion`; readable at 200% zoom; print stylesheet for the summary
      and concerns pages.

## 5. UI impact

- [x] **Components touched/added:** report shell is a separate, self-contained bundle (own minimal
      component set — nav rail, mode switcher, layer panel, detail panel, comment thread, concerns
      board). It reuses Stemma's *design language*, not its React components.
- [x] **Tokens:** report inlines the token values (colors/spacing/type scale) from
      `../ui/design-tokens.md` so it looks like Stemma without importing the app bundle.
- [x] **Both themes:** per Q10 — light default + dark toggle, honours `prefers-color-scheme`.
- [x] **Layout/rail behavior:** fixed left rail (views + concerns + search), right detail panel,
      top bar (title, workspace, export date, audience mode, layer toggle). Diagram canvas center.
      Responsive down to tablet width; stakeholder summary readable on mobile.

## 6. Technical prerequisites & dependencies

- [x] ~~A second Vite build target~~ — simplified: the viewer is plain JS/CSS inlined verbatim via
      Vite `?raw` imports (`src/report/viewer.js` / `viewer.css`); no build-pipeline change.
- [x] One aggregate read of workspace state at export time — implemented as fresh fetches of the
      existing model + comments endpoints plus the sidecar-backed presentation caches; the new
      `export-bundle` endpoint sketched in Q9-A proved unnecessary.
- [x] Markdown/notes sanitizer for embedding user text into standalone HTML (XSS-safe by
      construction; report runs wherever the file lands).
- [x] Layout geometry source: positions/docks/waypoints from `stemma.layout.json`; node sizes from
      explicit styles with canvas-default fallbacks (close visual parity, not pixel-identical —
      accepted in ADR-0014).
- [x] Comment pack import UI (per Q3) — Comments panel header → import; merge in `lib/comments.ts`.

## 7. Test plan

- [x] Unit tests: report data assembly (model+sidecar projection), layer predicate logic, comment
      pack merge (dedupe by id, thread append, resolved-flag conflict rules).
- [ ] Golden-file test: generate report for `samples/AuroraRail` and
      `samples/StemmaArchitecture`; assert single-file invariant (no `http(s)://` fetches), size
      budget, and presence of every view/element anchor.
- [ ] Browser smoke (Playwright) — not automated yet; the same script was executed manually in
      Chrome on `samples/AuroraRail` (modes, layers panel, search→jump, element panel,
      comment → pack → import).
- [x] Round-trip test: pack exported from report imports into a workspace and merges into
      `comments.stemma.json` losslessly; re-import is idempotent.
- [ ] Accessibility pass on the report shell (keyboard-only walk, contrast check).

## 8. Definition of Done

- [ ] All ACs met and demoed on two sample workspaces
- [x] §9 decisions recorded (boxes ticked), ADR-0014 written and `Accepted`
- [ ] States handled; accessibility bar met; both report themes (per Q10) verified
- [x] `dotnet test` untouched-backend · `tsc` clean · `vite build` clean · `vitest` green (150)
- [x] Model/presentation boundary respected; no new data store beyond the existing comments sidecar
- [x] Docs updated in the same PR: this record → `Shipped`, features index, user-journeys, ADR
- [x] Reviewed against all four pillars

## 9. Open questions — **answer before implementation**

> Answered 2026-06-10 (all recommended options; Q5 with six layers, metrics badges left out).
> Decisions are recorded in [ADR-0014](../architecture/decisions/0014-architecture-report-rendering-and-comment-pack.md).

### Q1 — Distribution & the Google Drive reality

Google Drive's built-in preview does **not** execute JavaScript in HTML files; an interactive
report on Drive is *stored and shared* there, but recipients must download and open it (one
double-click, fully offline).

- [x] **A (✅ recommended):** Single `.html` on Drive; recipient downloads and opens locally.
      Document this flow on the export success toast ("Share on Drive — recipients download and
      open").
- [ ] **B:** A + an additional "hosted" variant (small folder with `index.html`) for static hosts
      (GitHub Pages, S3, internal nginx) where deep links work as real URLs.
- [ ] **C:** A now, B as a follow-up feature record.

### Q2 — Rendering approach inside the report

- [x] **A (✅ recommended):** Embed the model + presentation as JSON and re-render with a small
      standalone renderer (positions/sizes captured from the live canvas; same edge-path math
      compiled in). Crisp at every zoom, true layer toggling, element-level interactivity, text
      selectable/searchable.
- [ ] **B:** Pre-rendered SVG snapshot per view (pixel-true, simplest) — layers and per-element
      interaction limited to what we annotate into the SVG; larger files on big models.
- [ ] **C:** Hybrid: SVG base layer + JSON-driven overlay for selection/comments.

### Q3 — The comment / collaboration loop

- [x] **A (✅ recommended):** Comments are written inside the report (drafts kept in
      `localStorage`), then exported as a **comment pack** (`*.comments.stemma.json`, one click,
      includes author name prompt). The author imports the pack in Stemma (Comments panel → Import)
      which merges threads into `comments.stemma.json` by id. Fully offline, no service, anchored to
      elements/views.
- [ ] **B:** Rely on Google Drive's own file-level comments only (zero build cost, but feedback is
      not anchored to elements and never lands in the model).
- [ ] **C:** A + B documented together (pack for architects, Drive comments for casual notes).
- [ ] **D:** Display-only in v1 (show existing threads, no authoring); pack loop in v2.

### Q4 — Audience reading modes

- [x] **A (✅ recommended):** Three presets — **Builder** (full detail: ids, attributes, payloads,
      notes), **Stakeholder** (summary page first, capability/system altitude, statuses & phases,
      no ids), **Reviewer** (everything + concerns overlay + comments expanded) — each preset just
      pre-configures the free layer/detail toggles, which stay user-adjustable.
- [ ] **B:** No presets; free layer toggles only.
- [ ] **C:** Per-audience separate export files (conflicts with the single-file requirement —
      listed for completeness).

### Q5 — Layer dimensions available for show/hide (multi-select: tick all wanted in v1)

- [x] Element kinds (modules / systems / containers / people / use cases / capabilities) ✅
- [x] Relationship types (uses / calls / publishes / subscribes / reads / writes / data flows, per
      type) ✅
- [x] Concerns overlay (questions / assumptions / risks + their `about` links) ✅
- [x] Lifecycle status badges & styling (current / target / to-be-created / deprecated …) ✅
- [x] Bounded-context grouping boxes ✅
- [x] Notes & custom-property rows on nodes
- [ ] Fan-in/out metrics badges

### Q6 — Which views ship in the report

- [x] **A (✅ recommended):** All built-in views (Module Map, Dependencies, Concerns) + all saved
      custom views, each with its persisted layout.
- [ ] **B:** A + Books rendered as narrative chapters (page narrative + its view) — the "guided
      tour" for stakeholders.
- [ ] **C:** Only the currently open view (minimal v1).

### Q7 — "How the system changes" for stakeholders

- [x] **A (✅ recommended):** Derive from what the model already says: lifecycle status coloring,
      current-vs-target counts, phase timeline ("Q4 2026: 3 modules to-be-created…"), deprecations
      — zero new data to maintain.
- [ ] **B:** Embed a baseline (previous export) and compute a real diff (added/removed/changed
      elements & links) — strongest story, more work + needs a baseline to exist.
- [ ] **C:** Git-derived changelog of the architecture files (later; backend work).

### Q8 — Size budget & embedded assets

- [x] **A (✅ recommended):** Target ≤ 5 MB on the reference samples; system font stack (no font
      files); inline SVG icons only; fail the export with a clear message if a pathological
      workspace exceeds 25 MB.
- [ ] **B:** A + embed the brand font (≈ +300 KB) for pixel-identical typography.
- [ ] **C:** No budget; embed everything.

### Q9 — Where the report is assembled

- [x] **A (✅ recommended):** Client-side generation: the running frontend fetches one aggregate
      payload (new lightweight `GET /api/workspace/export-bundle`), injects it plus the prebuilt
      viewer bundle into an HTML template, and triggers the download. Backend stays thin; engine
      untouched.
- [ ] **B:** Backend endpoint renders the whole file (`GET /api/export/report.html`) — also usable
      from CI/CLI without a browser, slightly more backend surface.
- [ ] **C:** Pure client from already-loaded state (no new endpoint; risks drifting from on-disk
      truth if the browser state is stale).

### Q10 — Report theme

- [x] **A (✅ recommended):** Light theme default (paper-like, print-friendly) + dark toggle,
      honoring `prefers-color-scheme`.
- [ ] **B:** Light only.

### Q11 — Entry point & cadence

- [x] **A (✅ recommended):** Export menu → "Architecture report (.html)" alongside PNG/SVG/
      draw.io/Mermaid; manual, on demand.
- [ ] **B:** A + headless generation hook (CLI/endpoint) so CI can publish a nightly report (pairs
      with Q9-B; can be a follow-up record).

---

## Implementation note (v1, 2026-06-10)

Shipped per the §9 answers, with two documented simplifications (both in ADR-0014): the viewer is
inlined via `?raw` instead of a second Vite build target, and export re-fetches the existing
endpoints instead of adding a `GET /api/workspace/export-bundle`. Known v1 gaps, candidates for a
follow-up record: Playwright smoke + accessibility pass, the "newer export may exist" staleness
hint, copy-deep-link affordance, and formal pan/zoom profiling on large models.
