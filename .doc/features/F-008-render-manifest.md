# Feature: Render manifest & staleness detection

| Field | Value |
|---|---|
| **ID** | F-008 |
| **Status** | `Shipped` (v1) |
| **Owner** | Bartosz |
| **Persona served** | The Essayist's Agent ("Ada"); anyone publishing a model-backed picture |
| **Roadmap horizon** | `Later` |
| **Created / Updated** | 2026-08-08 / 2026-08-08 |

## 1. Product — why

- **Problem:** the promise that a diagram cannot drift from its model ends at the app window. A PNG
  committed next to a post is an ordinary image; nothing notices when the model moves on.
- **Why now:** F-004 makes published images routine, which makes stale published images routine.
- **Value:** the "cannot lie" claim extends past the window — and it is the thing a drawing tool
  structurally cannot offer.
- **Out of scope:** re-rendering automatically; the check reports, it does not fix.

## 2. User story & acceptance criteria

> As **Ada**, I want each rendered file to carry what it was made from so that a build can fail when
> the picture no longer matches the model.

- [x] AC1 — Each render writes a sibling `<name>.manifest.json`: view id, element ids drawn, profile,
      palette, scale, per-file dimensions and node counts.
- [x] AC2 — The manifest carries a fingerprint of the inputs — model, view membership, layout,
      profile — stable across machines.
- [x] AC3 — `stemma render --check` re-computes the fingerprint and exits non-zero when it differs,
      without writing anything.
- [x] AC4 — `--no-manifest` opts out.

## 3. Architecture impact

- [ ] **Model or presentation?** Neither; an output artefact beside the image.
- [ ] **New/changed operations:** none.
- [ ] **Fidelity:** untouched.
- [ ] **Engine purity:** the fingerprint is computed in `Stemma.Cli` from engine reads.
- [ ] **Sidecar:** untouched.
- [ ] **ADR needed?** No.
- **Affected files/areas:** `src/Stemma.Cli/`.

## 4. UX impact

- [ ] A failing check must say *what* changed — "the view gained an element", not "hash mismatch".

## 5. UI impact

- [ ] None.

## 6. Technical prerequisites & dependencies

- [ ] F-004.

## 7. Test plan

- [x] Fingerprint stability: same inputs, same value, independent of path and machine.
- [x] Fingerprint sensitivity: a changed element name, view membership or constraint changes it.
- [x] `--check` exits non-zero on drift and writes nothing.

## 8. Definition of Done

- [ ] ACs met · [ ] suites green · [ ] docs updated

## 9. Notes / open questions

Shipped 2026-08-08. A first cut existed during F-004 and was removed to keep that change to one
idea; it landed with `stemma validate`.

Still open: whether the fingerprint should cover node *sizes*. They depend on the font, so including them
makes the check machine-sensitive; excluding them means a font change can alter the picture without
the manifest noticing.
