# Bug: The Module Map draws every Concept in the model

| Field | Value |
|---|---|
| **ID** | B-020 |
| **Status** | `Fixed` |
| **Severity** | `S3 minor` |
| **Area** | `canvas` |
| **Reported by / Date** | Bartosz / 2026-10-18 |
| **Affected version / commit** | 0.1.0 and `feat/books` |

## 1. Summary

[ADR-0018](../architecture/decisions/0018-concept-element-kind.md) gives the Concept kind "no
membership in the `moduleMap` or `dependencyGraph` lenses", and [F-010](../features/F-010-concept-element-kind.md)
AC2 is ticked: "It belongs to no built-in lens; it appears only in views that name it." The Module
Map draws them all. In a workspace that argues as well as describes, they are most of what is on it.

## 2. Steps to reproduce

1. Open a workspace with Concepts (the network target-architecture deck has forty).
2. Open the Module Map.

- **Expected:** the architecture — people, systems, contexts, modules, concerns — and no Concept.
- **Actual:** every Concept, piled into the auto layout among the modules, with their relations.
- **Frequency:** always.

## 3. Triage

- [x] **Reproduced.**
- [x] **Regression?** No — the Module Map has rendered every kind since Concept was added.
- [x] **Pillar(s) affected:** UI, report.

## 5. Root cause

`components/ArchCanvas.tsx` `applyBuiltIn` returns `arch.elements` for the Module Map ("the
universal canvas — every kind renders"), and `lib/lenses.ts` `viewRendersKind('moduleMap', …)`
answers yes for every kind. The report's `kindAllowedInView` in `report/viewer.js` does the same.
The ADR was applied to the dependency lens only, where Concepts were already excluded by kind.

## 6. Fix

- **Approach:** the built-in Module Map leaves Concepts out, in the canvas and in the report. A view
  that names a Concept still draws it, whatever its base lens. Adding a Concept while a built-in
  lens is open no longer switches to a lens that cannot show it; the toast says where it went.
- **Affected files:** `components/ArchCanvas.tsx`, `lib/lenses.ts`, `lib/canvasReveal.ts`,
  `report/viewer.js`.
- [x] Fix implemented
- [x] Regression test: `lenses.test.ts` — the Module Map does not render a Concept;
  `report.test.ts` — the report's Module Map leaves Concepts out.
