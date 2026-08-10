# Bug: `stemma render` ignores authored `nodes` positions, so a hand-written layout is silently auto-arranged

| Field | Value |
|---|---|
| **ID** | B-002 |
| **Status** | `Fixed` |
| **Severity** | `S2 major` |
| **Area** | `layout` |
| **Reported by / Date** | Dogfooding: the hero figure for *Adoption Is the Deliverable* on bfrackowiak.pl / 2026-08-10 |
| **Affected version / commit** | `dacc508` (local `master`, 21 commits ahead of `origin/master`) |

## 1. Summary

A workspace that states its arrangement as absolute `views.<key>.nodes` positions — with
`layoutMode: "custom"`, exactly as the schema and the protocol reference describe — renders as
though the file contained no positions at all. The nodes come out in the default arrangement and
nothing warns that the authored one was discarded.

This hits the **Essayist's Agent** persona precisely: the one writer who cannot see the canvas, cannot
drag anything, and gets one attempt at a file. It is also the failure mode
[`../product/agent-authored-diagrams.md`](../product/agent-authored-diagrams.md) §3 records as **G2**
and reports closed by **C1**. G2 is not closed for the path that matters most.

Two documents currently make a promise the tool does not keep:

- `schema/stemma.layout.schema.json` → `viewLayout.layoutMode`: *"'custom' means the stored `nodes`
  positions are authoritative"*.
- [`../protocol/authoring-a-diagram.md`](../protocol/authoring-a-diagram.md) §4: *"You **can** write
  absolute positions"*, with a worked `nodes` example, and §5.2 relies on the mixture — a `row`
  constraint for four elements and an absolute `nodes` entry for the fifth.

## 2. Steps to reproduce

Reproduced 2026-08-10 on a two-element workspace built for the purpose — no UI, no browser of the
reporter's, nothing from the real diagram it was extracted from.

```
postest/
├── Architecture/Architecture.cs   two Concepts, con_a and con_b
├── Views/T.cs                     view_t, BaseView "all", both ids
└── stemma.layout.json
```

```jsonc
// stemma.layout.json — 400 units apart, vertically, and declared authoritative
{
  "version": 1,
  "views": {
    "custom:view_t": {
      "layoutMode": "custom",
      "nodes": { "con_a": { "x": 0, "y": 0 }, "con_b": { "x": 0, "y": 400 } }
    }
  }
}
```

```
stemma render --workspace postest --view view_t --out postest/out.png --scale 1
```

- **Expected:** a tall image — two boxes stacked, roughly 400 units apart.
- **Actual:** `out.png  1098x138  2 nodes`. A wide, short image: the two boxes side by side, i.e. the
  default arrangement. 138px cannot contain a 400-unit vertical gap.
- **Frequency:** always. Observed across five renders of the real figure and once on this isolate.
- **Environment:** `stemma render` via `Microsoft.Playwright`; `Release` build of `dacc508`; .NET
  10.0.110, Node 24.14.1, Linux. No browser of the operator's involved.
- **Exit status:** `0`. The render reports success.

**The asymmetry that makes this precise.** In the real workspace, the *same file*, under the *same
view key*, had its `shapes` honoured at the exact coordinates written while its `nodes` were ignored:

| `views["custom:view_worth"]` member | authored | honoured in the render |
|---|---|---|
| `shapes[].x` / `.y` | yes | **yes** |
| `layout` (a `grid` constraint) | yes | **yes** |
| `offsets` | yes | **yes** |
| `nodes` | yes | **no** |
| `edges[].handles` | yes | **yes** |

So the sidecar is being read, the view key is correct, and the cache is primed. `nodes` alone does
not survive.

## 3. Triage

- [x] **Severity & priority agreed** — `S2 major`. The board's rule floors a *silent change*
      at S2, and this is silent: the picture is wrong, the exit code is `0`, and the only way to
      notice is to look at the image, which is the one thing the persona cannot do. It is not S1
      because a workaround exists (state the arrangement as a constraint) and no user data is lost.
- [x] **Reproduced** independently of the real diagram — the two-box isolate above.
- [x] **Regression?** Yes, and recent — introduced by C1 itself. C1 gave the *constraint* precedence
      over a node that already existed on the canvas and stopped there; plain authored positions were
      left losing to the same stale value. A view that used a constraint was covered and a view that
      stated coordinates was not, which is why the capability analysis could close G2 in good faith.
- [x] **Pillar(s) affected:** Product (the headless workflow is the feature), Architecture (the
      presentation contract), UX (silent wrong output).

## 4. UX / UI impact

- [x] **State involved:** first paint of a view that has never been placed by a human.
- [x] **User-visible symptom:** a diagram that is correct in content and wrong in arrangement, with
      no error, no warning, and a zero exit code.
- [x] **Severity to trust:** high. `stemma render`'s entire pitch is determinism — *file in, picture
      out, byte-stable across two machines*. A renderer that quietly substitutes its own arrangement
      for the author's is not deterministic in the sense anybody cares about.

## 5. Root cause

**Suspect 1 was right, and more specifically than stated: the later run is the *same* effect, and
what overwrites the authored positions is the placeholder its own earlier run produced.**

`ArchCanvas.tsx` builds nodes in an effect that re-runs when the sidecar lands (`sidecarTick`). On a
view no human has opened, in a headless render, the first build happens *before*
`primeLayoutSidecar` resolves, so `loadLayout` returns nothing and every node is placed at a default.
When the sidecar arrives the effect re-runs — and the position it chose was:

```js
const pos = (governedIds.has(e.id) ? merged[e.id] : existing?.position ?? merged[e.id]) ?? { x: 0, y: 0 };
```

`existing` is the node from the previous build, holding the default. It was consulted *before*
`merged`, which is where the authored positions live. So the first paint won, permanently.

This is exactly the asymmetry §2 documents, and it explains every row of that table. `shapes`,
`layout`, `offsets` and `handles` are re-derived from the sidecar on every build and have no
`existing` to lose to. Only `nodes` had a competing prior value, so only `nodes` lost.

The `existing` branch is not junk — it is what keeps a node still under the user's cursor from
snapping back mid-drag. The defect was its position in the chain, not its presence.

Both of the guards examined in the original triage were innocent, as the report suspected. The store
ordering in suspect 2 is real but benign, and is left alone.

## 6. Fix

- **Approach:** order the precedence chain by authority instead of by recency. A constraint governs
  what it claims; otherwise the authored position wins; only then the node's current position, which
  exists to survive a drag; then defaults.

```js
const authored = saved[e.id];
const pos = (governedIds.has(e.id) ? merged[e.id] : authored ?? existing?.position ?? merged[e.id])
  ?? { x: 0, y: 0 };
```

  One clause moved. Nothing about drag behaviour changes: during a drag the authored value and the
  live value are the same until the drop writes a new one.
- **Do not fix by documentation.** Deleting the promise from the schema and the protocol reference
  would be cheaper and wrong: the mixture of a constraint plus absolute positions is the arrangement
  the protocol's own §5.2 example depends on, and a figure with one element deliberately outside the
  constraint has no other way to be expressed.
- [x] Fix implemented
- [x] Inviolable rules respected
- [x] No new data store / boundary intact

## 7. Regression test (required)

- [x] A test that **fails before** the fix and **passes after** — verified by reverting the one
      clause, rebuilding the client and re-running: both tests below fail, and the transparency
      tests keep passing, so they are testing different things.
- **Location:** `tests/Stemma.Cli.Tests/RenderContractTests.cs`, driving the shipped command as a
  subprocess. They skip with a reason when the host or front end is not built, so a clean checkout
  stays green rather than red for the wrong cause.
- **Was:** `tests/Stemma.Cli.Tests/` — a render-level test, because this is invisible at
  every layer below it. Every unit underneath appears to work.
- **What it should assert:** that a workspace with `layoutMode: "custom"` and two nodes 400 units
  apart vertically renders taller than it is wide. Asserting the *shape of the output* rather than an
  internal call is what makes it a test of the contract instead of a test of the implementation, and
  it is the assertion that would have caught this.
- **Also worth adding:** the mixed case from the protocol's §5.2 — a constraint governing four ids
  and one absolute `nodes` entry outside it — since that is the documented pattern most likely to
  break again.

## 8. Verification

- [x] `dotnet test` green (260) · `tsc` clean · `vite build` clean · `vitest` green (266)
- [x] The two-box isolate in §2 renders tall — `1098x138` before, `490x1120` after
- [x] The protocol reference's §5.2 example renders as printed
- [x] No doc changes needed: the schema and the protocol reference were already right, and are now
      true. Both promises in §1 are kept rather than withdrawn.
- [x] The two other layout paths regression-checked on real workspaces — a mixed constraint plus an
      absolute node, and a pure constraint. Neither moved.

## 9. Notes

Found while producing a publication figure for an essay with `stemma render`, from a workspace
written by hand and never opened in the app — the workflow
[`../protocol/authoring-a-diagram.md`](../protocol/authoring-a-diagram.md) exists to support. Found
alongside [B-003](./B-003-render-transparent-emits-opaque-png.md) in the same session; the two are
independent.

The figure was delivered by expressing the composition as a `grid` constraint plus an `offsets` entry
instead, which is arguably the better authoring style anyway. That is not a reason to leave this: the
workaround was found by reading the renderer's source after four failed renders, which is not a route
open to the reader the protocol document was written for.
