# Bug: Publication cards let a line run through their text

| Field | Value |
|---|---|
| **ID** | B-023 |
| **Status** | In progress |
| **Severity** | S2 major |
| **Area** | `canvas` |
| **Reported by / Date** | Audit ([`agent-architecture-workflow.md`](../product/agent-architecture-workflow.md) §1, A6) / 2026-10-22 |
| **Affected version / commit** | `7264f79` |

## 1. Summary

Under the publication profile a card is an outline with no fill, so the page shows through — the
house style requires it. Any edge that passes beneath a card is therefore drawn across its name, which
reads as struck-through text: *~~Customer~~*, *~~API Gateway~~*.

## 2. Steps to reproduce

1. The B-021 workspace with a six-column grid constraint.
2. `stemma render --workspace . --view view_containers --out out.png` (publication is the default).

- **Expected:** lines stop at a card's outline.
- **Actual:** every line that crosses a card crosses its text.
- **Frequency:** always, wherever an edge passes under a card.

## 3. Triage

- [x] **Severity & priority agreed** — S2: a published picture that looks broken.
- [x] **Reproduced.**
- [x] **Regression?** Since F-005/F-009 made publication cards fill-less outlines.
- [x] **Pillar(s) affected:** UI.

## 4. UX / UI impact

- [x] **User-visible symptom:** wrong render.

## 5. Root cause

The edge layer is drawn beneath the nodes, which is correct, and a card that fills its body hides the
part of a line beneath it. A publication card does not fill its body (`PublicationNode.tsx` draws a
stroked `<rect>` with `fill="none"`), so nothing hides it. Filling it with the page colour would break
transparency — the same PNG must sit on a light and a dark page.

## 6. Fix

- **Approach:** cut the cards out of the edge layer instead of painting over it. Under the publication
  profile the edge layer carries an SVG `<mask>`: white everywhere, a black rectangle for each card's
  box. A line beneath a card is then not drawn at all, the background stays transparent, and the SVG
  export carries the mask with it. Routed edges (F-021) rarely pass beneath a card; this covers the
  constraints that do not route (grid, row, column) and hand-placed views.
- **Affected files:** `components/ArchCanvas.tsx` (or a small `EdgeKnockout` component),
  `src/Stemma.Cli/DiagramRenderer.cs` if the serialiser must carry the mask.
- [ ] Fix implemented
- [x] Inviolable rules respected
- [x] No new data store / boundary intact

## 7. Regression test (required)

- [ ] A test that **fails before** the fix and **passes after**
- **Test location:** `src/Stemma.Web.Client/src/lib/edgeKnockout.test.ts` (the rectangles the mask
  cuts, from the node boxes) and a render check in `tests/Stemma.Cli.Tests` that the serialised SVG
  carries the mask.
- **What it asserts:** a card's box is cut from the edge layer; a frame (a bounded context or a system
  boundary) is not — lines cross into a boundary on purpose.

## 8. Verification

- [ ] `tsc` clean · `vite build` clean · `vitest` green
- [ ] The audit render re-made and looked at, PNG and SVG.
