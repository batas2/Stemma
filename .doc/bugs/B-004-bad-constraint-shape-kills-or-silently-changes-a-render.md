# Bug: a constraint field of the wrong shape either kills the render with an unreadable error or silently redraws the picture

| Field | Value |
|---|---|
| **ID** | B-004 |
| **Status** | `Fixed` |
| **Severity** | `S2 major` |
| **Area** | `layout` (sidecar → solver → capture) |
| **Reported by / Date** | Sweep for defects of the same family as B-002 and B-003 / 2026-08-10 |
| **Affected version / commit** | `dacc508` (local `master`) |

## 1. Summary

`gap` is a pair of numbers on a `grid` and a single number on a `row`. The two forms sit a few lines
apart in the same document, and writing one where the other belongs is the mistake anyone authoring
a sidecar by hand will eventually make.

The tool's answer to it was one of two bad ones, depending on which way round the mistake went:

- **`gap: [56, 30]` on a row** — the solver added an array to a number, every coordinate downstream
  became `NaN`, `JSON.stringify` wrote those as `null`, and the render died with
  `The requested operation requires an element of type 'Number', but the target element has type 'Null'.`
  That message names no file, no view and no field.
- **`gap: 56` on a grid** — destructuring a number threw, and the failure surfaced as a fragment of a
  minified stack trace: `at ci (http://127.0.0.1:40565/assets/index-B6jCVSfP.js:48:108779)`.
- **`gap: "60"` on a row** — no error at all. The render exited `0` and produced a *different
  picture*: `1800x49` where the correct file gives `1098x138`.

This was found by sweeping for relatives of [B-002](./B-002-render-ignores-authored-node-positions.md)
and [B-003](./B-003-render-transparent-emits-opaque-png.md), and it is the same family: a headless
render that reports success while the picture is not the one the file describes. It is arguably worse
than either, because the third case is silent and the first two are unactionable.

## 2. Steps to reproduce

Any workspace with two elements. Nine sidecars were run through the shipped command; these are the
three that misbehave.

```jsonc
// dies with a JSON type error
{ "layout": { "kind": "row",  "ids": ["con_a", "con_b"], "gap": [60, 40] } }
// dies with a minified stack fragment
{ "layout": { "kind": "grid", "columns": [["con_a"], ["con_b"]], "gap": 60 } }
// exits 0 and draws something else
{ "layout": { "kind": "row",  "ids": ["con_a", "con_b"], "gap": "60" } }
```

```
stemma render --workspace <ws> --view <id> --out out.png --scale 1
```

- **Expected:** either the arrangement the file describes, or a message naming the field that is
  wrong.
- **Actual:** as above.
- **Frequency:** always.
- **Note on the schema:** `schema/stemma.layout.schema.json` is correct and already says a row's gap
  is a number. Nothing enforced it, and `stemma validate` — which exists precisely to report what the
  compiler cannot — did not look at constraints at all.

## 3. Triage

- [x] **Severity & priority agreed** — `S2 major`. The silent case alone floors here under the
      board's rule for a silently different picture; the two crashing cases are not S1 because
      nothing is lost and the file is still there to correct.
- [x] **Reproduced** — nine sidecar variants against the shipped command.
- [x] **Regression?** No. The solver has read `gap` this way since it was written.
- [x] **Pillar(s) affected:** Product (the headless workflow), UX (an error a reader cannot act on),
      Architecture (a boundary that passed non-numbers across itself).

## 4. UX / UI impact

- [x] **State involved:** any view whose sidecar was written by hand or by an agent.
- [x] **User-visible symptom:** an unactionable error, or a diagram that is subtly wrong.
- [x] **Severity to trust:** high, for the Essayist's Agent specifically. That reader cannot see the
      picture, so a silently different arrangement is undetectable, and an error naming a minified
      bundle offset gives them nothing to correct.

## 5. Root cause

One value of an unchecked type, crossing three boundaries and degrading at each.

1. **`layoutDsl.ts`** took `c.gap ?? DEFAULT_GAP[0]` — a nullish check, which passes anything that is
   not `null` or `undefined`. `x += s.w + gap` with an array coerces to a string, and the next
   addition is `NaN`. `solveGrid` had the mirror problem: `const [gapX, gapY] = c.gap ?? DEFAULT_GAP`
   throws outright on a number, because a number is not iterable.
2. **`ArchCanvas.tsx`** published the content box with `JSON.stringify`, which serialises `NaN` as
   `null` — the point where a type error becomes a silent one.
3. **`DiagramRenderer.cs`** read it back with `GetProperty("x").GetDouble()`, which throws
   `InvalidOperationException` with the message quoted in §1. It names the JSON type because that is
   all it knows by then.

The value is wrong at step 1 and unrecognisable by step 3, which is why the message is useless: every
layer that could have named the field had already handed the problem on.

## 6. Fix

Defence at each boundary the value crosses, because each one is wrong on its own terms.

- **The solver never emits a coordinate that is not a number.** `finite()` and `gapPair()` take
  whatever is in the field and fall back to the default spacing. `gapPair` also accepts a single
  number for a grid: it is unambiguous, it reads naturally, and it is the mistake people make.
- **The canvas refuses to publish a box that is not four finite numbers**, dispatching
  `stemma:render-failed` with a sentence instead. `RenderShell` owns readiness, so it turns that into
  the `error` state that already exists rather than publishing one itself.
- **The renderer validates every field before using any of it** and fails with a message naming the
  view's `layout` and pointing at `stemma validate`.
- **`stemma validate` reports the constraint** — `constraint/bad-gap`, `constraint/unknown-kind`,
  `constraint/no-members`, `constraint/dangling-id`, `constraint/not-an-object`. This is the layer
  that matters most now: the solver's fallback turns a dead render into a quietly different picture,
  so something has to say the file is wrong out loud.
- [x] Fix implemented
- [x] Inviolable rules respected — presentation only; no model, no third store
- [x] No new data store / boundary intact

## 7. Regression test (required)

- [x] Tests that **fail before** the fix and **pass after**
- **Location:** `src/Stemma.Web.Client/src/lib/layoutDsl.test.ts` for the solver,
  `tests/Stemma.Cli.Tests/WorkspaceCheckTests.cs` for the reporting.
- **What they assert:** nine wrong-shaped constraints — a pair where a number belongs and the
  reverse, strings, objects, `null`, a half-length pair, `NaN`, `Infinity` — each solving to
  coordinates that are all finite; that a bad gap falls back to the *default* spacing rather than to
  zero, since collapsing every node onto the last would look like a different bug; and that each
  malformed shape produces the matching finding, while a correct constraint produces none.

## 8. Verification

- [x] `dotnet test` green (260) · `tsc` clean · `vite build` clean · `vitest` green (266)
- [x] All three reproductions in §2 now render the arrangement the file describes
- [x] A genuinely unsolvable view reports the sentence rather than a JSON type error

## 9. Notes

Found by running plausible-but-wrong sidecars through the shipped command rather than by reading it —
the same method that found the render races. The two crashing cases were visible immediately; the
silent one was only visible by comparing the output dimensions against a correct run, which is the
whole difficulty with this class and the reason the board now carries a note about it.
