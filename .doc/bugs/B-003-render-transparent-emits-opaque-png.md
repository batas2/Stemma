# Bug: `stemma render` writes an opaque PNG while recording `transparent: true` in its manifest

| Field | Value |
|---|---|
| **ID** | B-003 |
| **Status** | `Fixed` |
| **Severity** | `S2 major` |
| **Area** | `web` (render profile / capture) |
| **Reported by / Date** | Dogfooding: the hero figure for *Adoption Is the Deliverable* on bfrackowiak.pl / 2026-08-10 |
| **Affected version / commit** | `dacc508` (local `master`, 21 commits ahead of `origin/master`) |

## 1. Summary

`stemma render` is transparent by default. The PNG it produces has **no alpha channel** and the page
background baked in, while the manifest written beside it records `"transparent": true`. The picture
and the provenance record disagree, and the record is the one that is wrong.

The consequence is the exact thing the transparent export was built to remove. Phase 0 of the
capability analysis closed with: *"`capture.mjs` can now drop its light/dark pair — one transparent
PNG serves both themes."* It cannot. An opaque `#f8fafc` slab is a glaring rectangle for every
dark-mode reader, which is why the light/dark pair existed in the first place.

## 2. Steps to reproduce

Any workspace and any view; this used a six-`Concept` figure.

```
stemma render --workspace <ws> --view <id> --out out.png --scale 2 --pad 32
```

- **Expected:** a PNG with an alpha channel and transparent padding. `--opaque` is the flag that
  bakes a background in, and it was not passed.
- **Actual:** an opaque PNG. Verified two ways:

```
$ identify -format "%f alpha=%A channels=%[channels]\n" out.png
out.png  alpha=Undefined  channels=srgb 3.0

$ python3 -c "from PIL import Image; im=Image.open('out.png'); print(im.mode, im.getpixel((2,2)))"
RGB (248, 250, 252)
```

`(248, 250, 252)` is `#f8fafc`. Pixel `(2,2)` is inside the padding, so it is background and nothing
else.

- **The manifest disagrees with the file it describes:**

```json
{ "view": "view_worth", "profile": "publication", "palette": "dual-theme",
  "transparent": true, "scale": 2, ... }
```

- **Frequency:** always, across six renders.
- **Environment:** `stemma render` via `Microsoft.Playwright`; `Release` build of `dacc508`; .NET
  10.0.110, Node 24.14.1, Linux.
- **Exit status:** `0`.

## 3. Triage

- [x] **Severity & priority agreed** — `S2 major`. Not S3, because the manifest actively
      asserts the opposite of what shipped: a build that trusts the manifest ships a slab, and the
      whole point of the manifest is that it can be trusted. Not S1: the picture is otherwise
      correct and a post-process recovers it.
- [x] **Reproduced** — six times, and the two independent probes above agree.
- [x] **Regression?** No — it never worked. Transparency and the manifest arrived in the same
      programme (B3 and B5) and were never checked against each other, exactly as suspected. The
      publication stylesheet was written against the elements that were known to paint, and the one
      that actually did was never in the list.
- [x] **Pillar(s) affected:** Product (the single-file light/dark promise), UX (dark-mode readers),
      Architecture (a provenance record that does not match its artefact).

## 4. UX / UI impact

- [x] **State involved:** exported artefact, dark theme on the destination page.
- [x] **User-visible symptom:** a light rectangle around every diagram for half the readers of
      whatever the image is placed in.
- [x] **Severity to trust:** high, and specifically the manifest's. `render --check` exists so a
      build can trust that a committed image still matches its model. A manifest that misdescribes
      the file it sits next to undermines the one feature that makes published output trustworthy.

## 5. Root cause

**Narrowed, not pinned.** The flag is plumbed correctly; something inside the clip region is still
painted.

Confirmed correct:

- `src/Stemma.Cli/DiagramRenderer.cs:96-101` — the screenshot passes
  `OmitBackground = o.Transparent`. For the PNG path this is the right and only Playwright knob.
- `src/Stemma.Cli/RenderOptions.cs` — `Transparent` defaults to `true`; `--opaque` clears it. The
  manifest's `true` is therefore an accurate record of what was *asked for*.
- `src/Stemma.Web.Client/src/styles.css:252-258` — the publication profile already forces
  `body`, `.react-flow`, `.react-flow__pane` and `.react-flow__renderer` to
  `background: transparent !important`, with the comment *"The page itself carries no colour: the
  export decides the backdrop, not the stylesheet."*
- `src/Stemma.Web.Client/src/lib/palette.ts:39,48,57` — every palette sets `fill: 'none'`, so nodes
  are outline-only and are not the source. (Confirmed empirically: keying `#f8fafc` out of the
  finished PNG left the boxes intact, with no holes.)
- The publication profile *is* applied in the render — the output has no grid, no minimap, no
  chrome and outline-only boxes — so `data-stemma-profile` is present on the root at capture time
  and the block above is live.

**The gap, and the painter.** `OmitBackground` only suppresses the browser's *default* white
backdrop; it cannot see through an element that paints. Lead 1 was the red herring the report
suspected — the shade was the tell. Lead 2 was right:

`ArchCanvas.tsx` renders the canvas inside a wrapper whose background is an **inline style**:

```jsx
const bgColor = isDark ? 'rgb(9 9 11)' : 'rgb(248 250 252)';
…
<div className="h-full w-full relative" style={{ background: bgColor }}>
```

`rgb(248 250 252)` is `#f8fafc` — the observed pixel exactly. A stylesheet rule with `!important`
does beat a plain inline style, but only if it selects the element, and the wrapper carried no class
the publication block named: it is the *parent* of `.react-flow`, not any of the four selectors
listed above.

Checked against the standard pitfalls: none apply. This is a CSS/capture interaction, not a state or
fidelity problem.

## 6. Fix

- **Approach:** the first shape, extended one step. The wrapper is given a name —
  `stemma-canvas-surface` — and the publication block clears it along with the render shell and
  `.react-flow__viewport`, the other two layers between the body and the drawing that were never
  covered either. The profile now clears every surface from the page down to the canvas rather than
  the subset that happened to be known.

  The second shape was considered and not taken. Acting on the palette's `background: null` is the
  tidier idea, but it clears exactly one element — whichever the render route decides to reach for —
  and this bug is the proof that guessing which element paints is the part that goes wrong. The rule
  is now stated over the whole stack, where a new wrapper cannot slip underneath it.
- **The manifest cannot lie again — both halves were done.** `PngFacts` reads the written PNG's
  colour type back off disk, and `RenderTransparency` reports *that* in the manifest, per file and in
  aggregate. It is `null`, not `false`, when nothing readable was written, because "not established"
  is a different claim from "opaque".
- **And the render no longer exits `0` when the artefact contradicts the request.** Recording the
  truth fixes the record; this is what stops the wrong file being published in the first place, which
  is what the caller actually cares about. It is also the guard that makes the whole class visible:
  with the CSS fix reverted, the default render now *fails* instead of quietly shipping a slab.
- [x] Fix implemented
- [x] Inviolable rules respected
- [x] No new data store / boundary intact

## 7. Regression test (required)

- [x] A test that **fails before** the fix and **passes after** — verified by reverting the
      stylesheet block, rebuilding and re-running.
- **Location:** `tests/Stemma.Cli.Tests/RenderContractTests.cs`, plus `PngFactsTests` and
  `RenderTransparencyTests` for the reading and the reconciliation on their own.
- **What it asserts:** render any view without `--opaque`, then assert the PNG's colour type
  has alpha and that a pixel in the padding is fully transparent. Then render the same view with
  `--opaque` and assert the opposite — otherwise a fix that makes everything transparent passes too.
- **Second assertion, cheap and worth it:** the manifest's `transparent` must equal the alpha that is
  actually in the file, which is the invariant this bug broke. Written as
  `Records_the_transparency_the_file_actually_has`.
- **The `--opaque` case earns its place.** With the fix reverted it is the only one of the five that
  still passes, which is what shows the other four are testing transparency rather than testing that
  renders happen.

## 8. Verification

- [x] `dotnet test` green (260) · `tsc` clean · `vite build` clean · `vitest` green (266)
- [x] A default render is `RGBA` with pixel `(2,2)` at `(0, 0, 0, 0)`; `--opaque` is `RGB` at
      `(255, 255, 255)`, so the flag still does its job
- [x] The manifest agrees with the file in both directions
- [x] Phase 0's claim about dropping the light/dark pair is now true rather than corrected

## 9. Notes

Found while producing a publication figure for an essay, alongside
[B-002](./B-002-render-ignores-authored-node-positions.md); the two are independent.

Worked around downstream by keying the flat background out of the finished PNG with ImageMagick,
which is safe here only because every palette sets `fill: 'none'` and the boxes are outline-only. It
would punch holes in any diagram that ever gains a filled node, so it is not a workaround to
document.
