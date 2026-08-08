# Feature: Publication render profile & named export palettes

| Field | Value |
|---|---|
| **ID** | F-005 |
| **Status** | `Shipped` (v1) |
| **Owner** | Bartosz |
| **Persona served** | The Essayist's Agent ("Ada"); also any architect putting a diagram in a document |
| **Roadmap horizon** | `Next` |
| **Created / Updated** | 2026-08-08 / 2026-08-08 |

## 1. Product — why

- **Problem:** the canvas is styled for an application — type chips, kind icons, drop shadows, a dot
  grid, status pills that carry meaning in hue alone. Published in an essay it reads as a screenshot
  of a tool, and it breaks two of the rules a published diagram has to keep.
- **Why now:** the render pipeline (F-004) makes the picture easy to produce; without this it makes
  the *wrong* picture easy to produce.
- **Value:** "render for the screen" and "render for print" are different jobs; Stemma now has both.
- **Out of scope:** shipping any particular site's brand colours.

## 2. User story & acceptance criteria

> As **Ada**, I want the rendered diagram to be ink rather than app UI so that it can sit in a
> document without looking like a screenshot.

- [x] AC1 — `--profile publication` removes the kind chip, the kind icon, the header row, the dot
      grid, minimap, controls, attribution, handles, shadows and all motion.
- [x] AC2 — Boxes are outline-only and the page is transparent, because a fill and a background are
      the two things that cannot survive an unknown destination background.
- [x] AC3 — Status stops being a coloured pill; it keeps its label.
- [x] AC4 — `--palette <name>` selects the ink. Unknown names fall back to the default rather than
      failing a render.
- [x] AC5 — Palettes are a render argument, not workspace state.
- [x] AC6 — Transparency and scale are also available from the app's export menu, remembered between
      sessions, without changing what the button has always produced by default.

## 3. Architecture impact

- [x] **Model or presentation?** Presentation only, and mostly CSS.
- [x] **New/changed operations:** none.
- [x] **Fidelity:** untouched.
- [x] **Engine purity:** untouched.
- [x] **Sidecar:** may *name* a default palette; it never contains one. A palette copied into every
      per-post workspace would drift from the site exactly as a diagram drifts from code.
- [x] **ADR needed?** No — recorded as §8 · Q4 of the analysis.
- **Affected files/areas:** `src/Stemma.Web.Client/src/styles.css`, `lib/palette.ts`,
  `lib/exportImage.ts`, `components/ExportMenu.tsx`, `components/nodes/ArchNodeView.tsx`.

## 4. UX impact

- [x] **Journey(s) touched:** exporting an image from the app; rendering headlessly.
- [x] **States defined:** not state-bearing.
- [x] **Interactions:** two remembered preferences in the export menu.
- [x] **Accessibility:** improves it — the profile removes hue-only status encoding. `validate`
      should refuse a palette that reintroduces it (F-007).

## 5. UI impact

- [x] **Components touched/added:** `ExportMenu` gains an options block; `ArchNodeView` gains class
      hooks the profile stylesheet targets.
- [x] **Tokens:** `--pub-stroke`, `--pub-text`, `--pub-accent`, `--pub-fill`.
- [x] **Both themes:** verified light and dark.
- [x] **Layout/rail behavior:** unchanged in the app.

## 6. Technical prerequisites & dependencies

- [x] F-004 for the headless path; the profile is independently usable from the export menu.

## 7. Test plan

- [x] Unit tests for palette resolution, fallback and the CSS-variable contract.
- [x] Unit tests for export option resolution — clamping, and the difference between a padding of
      zero and an absent padding.
- [x] Visual check of a rendered diagram on both themes.
- [ ] Contrast assertions on the shipped palettes. Not built; the numbers are documented, not tested.

## 8. Definition of Done

- [x] All ACs met · [x] `tsc`/`vitest`/`vite build` green · [x] no new data store · [x] docs updated

## 9. Notes / open questions

`html-to-image` reads `backgroundColor: undefined` as "paint nothing" while the string
`'transparent'` makes it paint. That is pinned by a test, because it is not what the option name
suggests.

Bounded-context frames still carry more of the app's look than the rest; the profile de-plates them
but the grouping is drawn as a dashed frame rather than as anything a designer chose.
