# Feature: The render says what is wrong with the picture

| Field | Value |
|---|---|
| **ID** | F-022 |
| **Status** | In progress |
| **Owner** | Bartosz |
| **Persona served** | The Architect's Agent ("Theo"); the Essayist's Agent ("Ada") |
| **Roadmap horizon** | Next |
| **Created / Updated** | 2026-10-22 / 2026-10-22 |

## 1. Product — why

- **Problem:** an agent judges its diagram by looking at a PNG, and vision models are unreliable at
  exactly the faults that make a diagram hard to read — they tell 0, 1 or 2 line crossings apart
  41–76% of the time ([arXiv 2407.06581](https://arxiv.org/abs/2407.06581)). The audit's vanished
  back edge (A5) is invisible in the picture *by construction*. The renderer, meanwhile, knows every
  box and every line to the pixel.
- **Why now:** with F-021 most views are laid out automatically, and the agent needs to know when one
  is not — a hand-placed grid, a nudge too far, a view too dense for any layout.
- **Value:** *a picture that cannot lie about its own legibility* — the render manifest already proves
  the image matches the model (F-008); now it says whether the image is readable.
- **Out of scope:** judging aesthetics beyond measurable faults; showing the lint in the app (the pure
  module is ready for it; the surface is a later decision); changing the picture to fix what it finds.

## 2. User story & acceptance criteria

> As **an agent that cannot see well**, I want **the render to tell me, in words and ids, what is wrong
> with the picture** so that **I can fix it without guessing from pixels**.

- [ ] **AC1 — Geometry in the manifest.** Every render writes, beside the existing fields, `geometry`:
  each card's box, each frame's box, each edge's polyline, each edge label's box — in flow units — and
  the content bounds.
- [ ] **AC2 — A layout lint.** Computed from that geometry and written to the manifest as `lint`:
  - `layout/node-overlap` (warning) — two cards' boxes intersect.
  - `layout/edge-through-node` (warning) — an edge passes through a card that is neither of its ends.
  - `layout/label-overlap` (warning) — an edge label covers another label or a card.
  - `layout/edge-hidden` (warning) — most of an edge's length lies along another edge, so it cannot be
    told apart (the audit's A5).
  - `layout/crossings` (info) — how many times edges cross; a warning when there are more crossings
    than edges.
- [ ] **AC3 — Said on stdout.** `stemma render` prints one line per finding — severity, rule, the ids —
  and a summary (`wrote 1 file · 2 layout warnings`).
- [ ] **AC4 — Machine-readable.** `--json` prints the result of the whole render as one JSON document:
  files, sizes, node and edge counts, findings.
- [ ] **AC5 — Opt-in failure.** `--fail-on-lint` exits 1 when there is any warning; without it, lint never
  changes the exit code.
- [ ] **AC6 — Not part of the fingerprint.** `--check` ignores geometry and lint: they are a function of
  what the fingerprint already covers.
- [ ] **AC7 — One implementation.** The geometry is read from the live canvas and the lint is a pure
  module in the client, so the numbers are the ones the picture was drawn with.

## 3. Architecture impact

- [x] **Model or presentation?** Neither — render output, beside the image, like the manifest it extends.
- [x] **New/changed operations:** none.
- [x] **Fidelity:** untouched.
- [x] **Engine purity:** untouched; the CLI and the client only.
- [x] **Sidecar:** none.
- [x] **ADR needed?** No: an extension of F-008's manifest under its existing decision.
- **Affected files/areas:**
  - `src/Stemma.Web.Client/src/lib/layoutLint.ts` (new, pure)
  - `src/Stemma.Web.Client/src/lib/renderGeometry.ts` (new: reads boxes from React Flow, polylines from
    the edge paths, label boxes from the label layer)
  - `components/RenderShell.tsx` (exposes `window.stemmaRender.geometry()` once ready)
  - `src/Stemma.Cli/DiagramRenderer.cs`, `RenderCommand.cs`, `RenderOptions.cs`, the manifest writer

## 4. UX impact

- [x] **Journey(s) touched:** the agent's render loop (protocol §6–§7).
- [x] **States defined:** a render with findings is still a successful render; a render with
  `--fail-on-lint` and a warning writes the image and exits 1, so the agent can look at what failed.
- [x] **Interactions:** CLI only.
- [x] **Accessibility:** n/a (text output).

## 5. UI impact

- [x] None in the app.

## 6. Technical prerequisites & dependencies

- [x] F-021 makes most findings disappear; F-022 is what proves it (F-021 AC9).

## 7. Test plan

- [ ] `layoutLint.test.ts` — each rule on hand-built geometry, including the A5 case (a back edge along
  a row), and no finding for an edge that merely touches its own ends.
- [ ] `renderGeometry` exercised through the render: the audit workspace's manifest carries geometry
  and the expected findings before F-021 (grid) and none after (layered).
- [ ] CLI tests: `--json` shape, `--fail-on-lint` exit code, `--check` unaffected.

## 8. Definition of Done

- [ ] All ACs met and demoed
- [ ] `dotnet test` green · `tsc` clean · `vite build` clean · `vitest` green
- [ ] Docs: protocol §6, the manifest description in F-008
- [ ] Reviewed against all four pillars

## 9. Notes / open questions

- Bézier edges are sampled into polylines every few units; routed edges are exact.
- A finding names ids, never coordinates, because ids are what the agent can change.
