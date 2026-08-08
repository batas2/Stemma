# Feature: Headless diagram render (`stemma render`)

| Field | Value |
|---|---|
| **ID** | F-004 |
| **Status** | `Shipped` (v1) |
| **Owner** | Bartosz |
| **Persona served** | The Essayist's Agent ("Ada") — [`../product/users-and-personas.md`](../product/users-and-personas.md) |
| **Roadmap horizon** | `Next` |
| **Created / Updated** | 2026-08-08 / 2026-08-08 |

## 1. Product — why

- **Problem:** turning a model into an image required a person with a browser open. The only post
  ever illustrated from Stemma cost a 190-line Playwright script that dragged nodes with synthetic
  mouse gestures, slept at eight points and computed its own crop.
- **Why now:** the picture half of "the diagram *is* the code" is the half that leaves the app. Until
  it can be produced without a mouse, every claim about diagrams that cannot drift stops at the
  window edge.
- **Value:** a model plus a view becomes a file, reproducibly, from a command — the precondition for
  every other item in [`../product/agent-authored-diagrams.md`](../product/agent-authored-diagrams.md).
- **Out of scope:** editing the model from the CLI; rendering at volume as a service.

## 2. User story & acceptance criteria

> As **Ada**, I want to turn a named view into an image file from one command so that a post can
> reference a diagram I never opened a canvas to draw.

- [x] AC1 — `stemma render --workspace <path> --view <id> --out <file>` writes the file.
- [x] AC2 — A view id that does not exist fails with a message naming the views that do, rather than
      silently drawing the whole model.
- [x] AC3 — A view that resolves to no elements is reported as empty, distinctly from a timeout.
- [x] AC4 — Two runs of the same command produce the same image dimensions.
- [x] AC5 — `--theme light,dark` writes the `-light`/`-dark` pair the site's `<picture>` expects; a
      single theme keeps the filename exactly as given.
- [x] AC6 — Rendering does not disturb a workspace already open in the app.

## 3. Architecture impact

- [x] **Model or presentation?** Neither is written. The CLI reads; the canvas draws.
- [x] **New/changed operations:** none.
- [x] **Fidelity:** untouched — nothing rewrites C# source.
- [x] **Engine purity:** `Stemma.Cli` depends on `Stemma.Engine`, never the reverse.
- [x] **Sidecar:** none for this record (see F-006 for `layout`/`offsets`).
- [x] **ADR needed?** No — the two decisions it embodies (a render *mode* rather than a second
      renderer; a process per render) are recorded as §8 · Q2 and §8 · Q5 of the analysis.
- **Affected files/areas:** `src/Stemma.Cli/`, `src/Stemma.Web.Client/src/components/RenderShell.tsx`,
  `src/Stemma.Web.Client/src/lib/renderMode.ts`, `src/Stemma.Web.Client/src/lib/renderReady.ts`.

## 4. UX impact

- [x] **Journey(s) touched:** a new one that has no UI. Ada never opens the app.
- [x] **States defined:** `loading` / `ready` / `empty` / `error`, published on the document root.
      `empty` and `error` exist so that "nothing to draw" and "never finished" stop being the same
      observation from outside.
- [x] **Interactions:** none — every affordance is deliberately absent in render mode.
- [x] **Accessibility:** not applicable to a headless surface; the app is untouched.

## 5. UI impact

- [x] **Components touched/added:** `RenderShell` (new). `ArchCanvas` gains a render-fit handler.
- [x] **Tokens:** none new here; the palette variables belong to F-005.
- [x] **Both themes:** `--theme light,dark` exercised.
- [x] **Layout/rail behavior:** render mode has no rails.

## 6. Technical prerequisites & dependencies

- [x] `Microsoft.Playwright`, driving the system Chrome so no browser download is required.
- [x] A built `Stemma.Web` **and** its `wwwroot` bundle — the two live in different directories and
      both are resolved explicitly.
- [x] Depends on B-001 being fixed, since the render reads the committed sidecar.

## 7. Test plan

- [x] Frontend unit tests for the pure logic: query parsing and the readiness state machine
      (`renderMode.test.ts`).
- [x] CLI unit tests for option parsing and output naming (`RenderOptionsTests`).
- [x] End-to-end: `samples/AuroraRail` rendered repeatedly, byte-stable dimensions across runs.
- [ ] A CI job that renders a sample and fails on a diff. Not built — needs a stable baseline first.

## 8. Definition of Done

- [x] All ACs met and demonstrated
- [x] States handled
- [x] `dotnet test` green · `tsc` clean · `vite build` clean · `vitest` green
- [x] Model/presentation boundary respected; no new data store
- [x] Docs updated in the same change

## 9. Notes / open questions

Three races surfaced only under repeated end-to-end rendering and are recorded in the commit: a
terminal `empty` published in the gap between data landing and React painting; a stillness signature
that ignored position and so declared the canvas settled while every box was about to move; and a
crop measured from the DOM, whose bezier overshoot moved by tens of pixels between runs.

SVG output is currently the edge layer only and is honest about that — see F-009.
