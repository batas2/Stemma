# Bug: An app-profile render can capture the minimap and the controls

| Field | Value |
|---|---|
| **ID** | B-027 |
| **Status** | Fixed |
| **Severity** | S3 minor |
| **Area** | `web` |
| **Reported by / Date** | Found rendering the C4 sample for F-023 / 2026-10-22 |
| **Affected version / commit** | `7264f79` |

## 1. Summary

`?render=1` parses a `bare` flag — documented as "hide the dot grid, the minimap, the controls and the
attribution; on by default in render mode" — and nothing reads it. Under the `app` profile the minimap,
the zoom controls and the dot grid are therefore drawn in a headless render, and a picture wide enough to
reach a corner of the viewport captures the minimap with it. (The publication profile hides them in CSS,
which is why it went unnoticed.)

## 2. Steps to reproduce

1. `stemma render --workspace samples/FoodDelivery --view view_context --out c.png --profile app --opaque`.

- **Expected:** the diagram alone.
- **Actual:** the minimap's corner in the bottom right of the image.

## 3. Triage

- [x] **Severity & priority agreed** — S3.
- [x] **Reproduced.**
- [x] **Regression?** Since F-004; latent until a view was wide enough.

## 5. Root cause

`RenderParams.bare` (`lib/renderMode.ts`) is set and never consulted; `ArchCanvas` draws `Background`,
`Controls` and `MiniMap` whenever it is not presenting or capturing a book page.

## 6. Fix

- **Approach:** the canvas leaves the three out when the render parameters say `bare`, which is the
  default in render mode.
- **Affected files:** `src/Stemma.Web.Client/src/components/ArchCanvas.tsx`.
- [x] Fix implemented

## 7. Regression test (required)

- [x] **Test location:** `tests/Stemma.Cli.Tests/LayeredRenderTests.cs` — an app-profile render of a wide
  view whose image has no minimap pixel colour in its bottom-right corner.

## 8. Verification

- [x] The sample re-rendered and looked at.
