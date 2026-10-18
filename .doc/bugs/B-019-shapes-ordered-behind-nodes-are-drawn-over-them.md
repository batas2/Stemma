# Bug: A shape ordered behind the nodes is drawn over them

| Field | Value |
|---|---|
| **ID** | B-019 |
| **Status** | `Fixed` |
| **Severity** | `S3 minor` |
| **Area** | `canvas` |
| **Reported by / Date** | Bartosz / 2026-10-18 |
| **Affected version / commit** | 0.1.0 and `feat/books` |

## 1. Summary

The schema and `lib/shapes.ts` say a shape's `z` below zero puts it behind the nodes, and new rects
and ellipses default to `-1` for that reason. Every shape is drawn over every node regardless. A
filled zone meant as a backdrop for a group of cards hides the cards.

## 2. Steps to reproduce

1. In any custom view, add a `rect` shape with a fill, `z: -3`, large enough to cover two cards.
2. Look at the canvas, present a book page on that view, or export the view.

- **Expected:** the rect is a backdrop; the cards are drawn on top of it.
- **Actual:** the rect covers the cards. Only its order among other shapes follows `z`.
- **Frequency:** always.
- **Evidence:** found building a deck whose "shared / private" zones were filled rects; the cards
  inside them disappeared. The deck now draws the zones as outlines.

## 3. Triage

- [ ] **Severity & priority agreed**
- [x] **Reproduced** — any filled shape over a node.
- [ ] **Regression?** Unknown; the overlay has been above the nodes since it was introduced.
- [ ] **Pillar(s) affected:** UI

## 4. UX / UI impact

- [x] **User-visible symptom:** wrong render — the documented stacking does not hold, so the
  natural way to group cards (a tinted panel behind them) hides them.
- [x] **Severity to trust:** low; nothing is lost, but the file says one thing and the canvas draws
  another.

## 5. Root cause

`components/ShapeLayer.tsx` draws all shapes in one overlay `<div>` at `z-index: 5` inside the React
Flow container, above the node layer, and sorts the shapes by `z` within that overlay only
(`sortedShapes`). Nothing draws a shape beneath the nodes.

## 6. Fix

- **Approach:** the layer is split. Shapes with `z < 0` are drawn through React Flow's viewport
  portal at `z-index: -1` inside the viewport's stacking context — beneath the links and the cards —
  and take no pointer events there. In the overlay each one leaves an invisible band along its
  outline, a fixed width on screen at any zoom, which selects and moves it; its inside is left to the
  cards. The report draws backdrops before the bounded contexts and the cards, the rest after them
  ([F-014](../features/F-014-self-explaining-views.md) AC9).
- **Affected files:** `components/ShapeLayer.tsx`, `report/viewer.js`.
- [x] Fix implemented
- [x] Regression test: `tests/journey/view-header.spec.ts` — a filled `z: -1` rect under a card
  leaves the card visible and clickable; `report/viewHeader.report.test.ts` — the report draws a
  backdrop before the cards.
