# Feature: True vector output from the publication profile

| Field | Value |
|---|---|
| **ID** | F-009 |
| **Status** | `Draft` |
| **Owner** | Bartosz |
| **Persona served** | The Essayist's Agent ("Ada"); anyone putting a diagram on a slide |
| **Roadmap horizon** | `Later` |
| **Created / Updated** | 2026-08-08 / 2026-08-08 |

## 1. Product — why

- **Problem:** the SVG that ships today is the edge layer only, because React Flow draws edges as SVG
  and nodes as HTML. The app's older `html-to-image` SVG was worse — HTML inside a `<foreignObject>`,
  which renders in a browser and essentially nowhere else.
- **Why now:** it does not block anything. PNG at scale 2–4 covers the blog; vector matters for a
  talk slide and for editing a diagram two years later.
- **Value:** resizable output, meaningful diffs in Git.
- **Out of scope:** a standalone non-browser renderer — rejected, see §9.

## 2. User story & acceptance criteria

> As **Ada**, I want `--format svg` to produce a real vector drawing so that it survives being
> resized and opened in an editor.

- [ ] AC1 — The publication profile renders node bodies as SVG primitives — `<rect>` plus `<text>`
      with pre-computed `<tspan>` lines — instead of styled `<div>`s.
- [ ] AC2 — Line breaking still happens in the browser, measured once and emitted as `<tspan>`s, so
      the product contains exactly one line-breaking implementation and it is the one on screen.
- [ ] AC3 — Export serialises the live SVG subtree rather than rasterising it.
- [ ] AC4 — PNG is produced from the same SVG, so the two cannot disagree.
- [ ] AC5 — Text is either accompanied by an embedded subset font or converted to paths, chosen per
      invocation, because an SVG naming a font it cannot guarantee re-wraps on the reader's machine.

## 3. Architecture impact

- [ ] **Model or presentation?** Presentation.
- [ ] **New/changed operations:** none.
- [ ] **Fidelity / engine purity:** untouched.
- [ ] **ADR needed?** No — the decision not to build a second renderer is §8 · Q2.
- **Affected files/areas:** `components/nodes/`, `styles.css`, `src/Stemma.Cli/DiagramRenderer.cs`.

## 4. UX impact

- [ ] The profile toggled in the app *is* the preview; there is nothing extra to build for that.

## 5. UI impact

- [ ] The publication node body becomes a second render path *within one component*, not a second
      component. If it becomes a fork, this feature has failed.

## 6. Technical prerequisites & dependencies

- [ ] F-005, whose profile this renders.

## 7. Test plan

- [ ] The serialised SVG parses standalone and contains one `<rect>` and one `<text>` per node.
- [ ] Wrapped titles emit the same line breaks as the DOM path for the same width.
- [ ] A visual-regression gate between the SVG-derived PNG and the DOM screenshot.

## 8. Definition of Done

- [ ] ACs met · [ ] suites green · [ ] docs updated

## 9. Notes / open questions

The rejected alternative is a standalone server-side SVG renderer. It fails on text measurement: a
break landing one word differently adds a line, changes the box height, and shifts everything below
it in a grid — a structurally different picture, not a slightly different one. Its safety net would
be a CI job rasterising the SVG and pixel-diffing it against Chrome, which is the class of test that
is either too loose to catch drift or too tight to stay green.

Today's edge-layer-only SVG is documented as such in `DiagramRenderer`, deliberately, so nobody
mistakes it for the finished feature.
