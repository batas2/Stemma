# Bug: `stemma.layout.json` silently discards free-form shapes and edge dock handles

| Field | Value |
|---|---|
| **ID** | B-001 |
| **Status** | `Fixed` |
| **Severity** | `S2 major` (case for S1 in §3) |
| **Area** | `sidecar` |
| **Reported by / Date** | Capability analysis for agent-authored diagrams / 2026-08-08 |
| **Affected version / commit** | `f6e9cdc` — present since `ViewLayout` was introduced |
| **Fixed / Date** | working tree on `f6e9cdc` / 2026-08-08 |

## 1. Summary

Free-form canvas shapes and draw.io-style edge dock handles **never reach disk**. The web client
writes them into `views.<viewKey>.shapes[]` and `views.<viewKey>.edges.<id>.handles`, but the
server's `LayoutSidecar` type does not declare either member and has no `[JsonExtensionData]`, so
System.Text.Json drops them during model binding — before `Write()` ever runs.

The loss is **silent and bidirectional**: the same types are used on read, so a sidecar hand-authored
on disk is also stripped before the client sees it. Two shipped features listed under "Now" in the
roadmap — *free-form shapes* and *draw.io-style edge docking* — therefore survive only until reload,
and the sidecar's stated promise of being "the committed presentation layer that travels with the
model in Git" does not hold for them.

## 2. Steps to reproduce

**In the product:**

1. Open any workspace and switch to a custom view.
2. Add a free-form shape (a text label is enough) and dock one relationship endpoint to a
   connection dot.
3. Confirm both render, and that `stemma.layout.json` was written (the debounced PUT fires ~400 ms
   after the edit).
4. Reload the page.

- **Expected:** the label and the docked endpoint are still there; `stemma.layout.json` contains a
  `shapes` array and a `handles` object.
- **Actual:** both are gone from the canvas and neither key exists in the file.
- **Frequency:** always.
- **Environment:** any browser, any theme, any custom view, any workspace.

**Isolated, without the UI** — reproduced 2026-08-08 against `Stemma.Engine` at `f6e9cdc`. Feed the
type exactly what the client PUTs, then feed it the same document off disk:

```csharp
var authored = """
{ "version": 1, "views": { "custom:view_x": {
    "nodes":  { "mod_1":  { "x": 10, "y": 20 } },
    "edges":  { "flow_1": { "waypoints": [{ "x": 5, "y": 5 }],
                            "handles": { "source": "right", "target": "left" } } },
    "shapes": [ { "id": "sh_1", "kind": "label", "text": "human", "z": -1 } ] } } }
""";

JsonSerializer.Deserialize<LayoutSidecar>(authored)!.Write(dir);          // the PUT path
File.WriteAllText(LayoutSidecar.PathFor(dir), authored);
JsonSerializer.Serialize(LayoutSidecar.Read(dir));                        // the GET path
```

Observed:

| | `shapes` | `handles` | `waypoints` | `nodes` |
|---|---|---|---|---|
| PUT — client → disk | **dropped** | **dropped** | kept | kept |
| GET — disk → client | **dropped** | **dropped** | kept | kept |

**Corroborating evidence:** no sample workspace on disk contains a single `shapes`, `handles`,
`waypoints` or `labelOffset` key, despite all of those features being shipped —
`grep -o '"shapes"\|"handles"' samples/*/stemma.layout.json` returns nothing.

## 3. Triage

- [x] **Severity & priority agreed** — `S2 major`. The board's own rule floors silent lost work at
      S2, and this is silent, permanent, and affects work the user can see themselves doing. The
      case for **S1** is that it is *unrecoverable* content loss with no warning and no undo; it is
      held at S2 only because the canonical model in `Architecture.cs` is untouched and the core
      modelling path is unaffected. Raise to S1 if shapes become load-bearing for published output
      (which F-005 / D2 would make them).
- [x] **Reproduced** independently of the reporter — the isolated repro above runs against the real
      assembly and needs neither the UI nor a browser.
- [x] **Regression?** No. Present since `ViewLayout` was introduced; never worked.
- [x] **Pillar(s) affected:** Architecture (the presentation contract), UX (lost work), Product (two
      "Now" roadmap capabilities are not actually shipped).

## 4. UX / UI impact

- [x] **State involved:** persisted / reload.
- [x] **User-visible symptom:** annotation work disappears on reload with no error, no toast, and no
      diff — the PUT returns `204 No Content`, so every signal the user gets says it saved.
- [x] **Severity to trust:** high. This is the exact failure class the bugs board calls out — *"a
      silent change"* — in a product whose entire pitch is that presentation travels safely in Git.

## 5. Root cause

The pass-through design was applied at the **top level** of the sidecar and not **inside
`ViewLayout`**.

- `LayoutSidecar.cs:14-16` documents the intent: the rich sections are `JsonElement` pass-through
  because *"the web client owns their schema, the engine only persists them verbatim."* That works
  for `nodeStyles`, `edgeStyles`, `notes`, `customProps` and `annotations` — all top-level
  `Dictionary<string, JsonElement>`.
- `LayoutSidecar.cs:37-41` — `ViewLayout` declares only `nodes` and `edges`. It is a **closed type**.
- `LayoutSidecar.cs:49-53` — `EdgeWaypoints` declares only `waypoints` and `labelOffset`. Also closed.
- **No `[JsonExtensionData]` exists anywhere in the solution** (verified by grep), and the options in
  `LayoutSidecar.JsonOpts` do not preserve unmapped members.
- `Program.cs:244-250` — `MapPut("/layout", async (LayoutSidecar sidecar, …)` binds the body into
  that closed type and calls `sidecar.Write(...)`. Unknown members are gone before `Write` is
  reached, so the write is not lossy — **the bind is**.
- `Program.cs:236-242` — `MapGet` calls `LayoutSidecar.Read`, which deserialises through the same
  types, so the read path strips identically.

Client-side counterparts, for completeness — these are correct and are not the bug:

- `lib/layout.ts:52-63` — `loadViewShapes` / `saveViewShapes` read and write `views.<key>.shapes`.
- `lib/layout.ts:214-235` — `saveEdgeHandles` writes `views.<key>.edges.<id>.handles`.

**Why the existing test suite is green.** `LayoutSidecarTests.Round_trip_preserves_positions_styles_
notes_props_and_annotations` asserts only sections the C# type declares. It cannot fail on a member
the type has never heard of, so the round-trip test passes while the round trip is lossy. This is
worth stating in the fix: *a pass-through format needs a test that asserts unknown members survive,
not one that asserts known members do.*

Checked against the standard pitfalls:

- [ ] Sidecar re-fetched mid-session — no; unrelated (the prime-once guard at `layout.ts:248` holds).
- [ ] Node objects rebuilt mid-drag — no.
- [x] **Model vs presentation boundary crossed** — no, but the *presentation* contract is broken:
      data that is supposed to be committed presentation never becomes committed.
- [ ] Fidelity rule violated — no; `Architecture.cs` is untouched.
- [ ] Stale store selector — no.

## 6. Fix

- **Approach:** make `ViewLayout` and `EdgeWaypoints` **open types**, matching the pass-through
  intent already documented at the top of the file. Add
  `[JsonExtensionData] public Dictionary<string, JsonElement>? Extra { get; set; }` to both. Unknown
  members are then captured on read and re-emitted on write, verbatim, exactly as the top-level rich
  sections already are.

  **Rejected alternative:** modelling `shapes` and `handles` as typed C# members. It fixes today's
  two members and re-couples the engine to the client's schema evolution — which is precisely what
  the pass-through design exists to avoid, and it would guarantee a third occurrence of this bug the
  next time the canvas invents a per-view section.

  **Follow-through, not part of the fix:** the format should stop being undocumented. Publishing a
  JSON Schema for the sidecar is tracked as F-007; this bug is the argument for it, because a format
  no one can validate is a format that loses data quietly.

  **Applied:** `[JsonExtensionData] public Dictionary<string, JsonElement>? Extra { get; set; }` on
  `LayoutSidecar`, `ViewLayout` and `EdgeWaypoints` — three properties. `Position` was deliberately
  left closed: `{x, y}` has nowhere to grow, and the noise would not buy anything.

  The class doc comment now states the rule for the next person: *the pass-through promise applies at
  every level; when adding a nested type here, give it extension data too.*

- **Affected files:** `src/Stemma.Engine/Workspace/LayoutSidecar.cs` (+3 properties, +1 doc
  paragraph); `tests/Stemma.Engine.Tests/LayoutSidecarTests.cs` (+1 test)
- [x] Fix implemented
- [x] Inviolable rules respected — no new store; the fix *restores* the single presentation store
- [x] No new data store / boundary intact

## 7. Regression test (required)

- [x] A test that **fails before** the fix and **passes after** — verified in both directions by
      temporarily reverting the three attributes:
      `KeyNotFoundException` at `LayoutSidecarTests.cs:108` without the fix, green with it.
- **Test location:** `tests/Stemma.Engine.Tests/LayoutSidecarTests.cs` —
  `Unknown_members_inside_a_view_survive_a_round_trip`
- **What it asserts:** that a sidecar document containing members the C# type does *not* declare
  survives `Read` → `Write`. Named for the invariant rather than the symptom, and it asserts an
  **invented** section (`sparkles`) alongside the two real ones plus an unmapped top-level section,
  so it guards the *class* of bug rather than its two instances. It also re-reads the file typed, so
  the modelled members are still proven to bind — the id-integrity check in
  `AuroraRailSampleTests.Layout_sidecar_positions_only_known_elements` depends on that.

## 8. Verification

- [x] `dotnet test` green — **97 passed** (90 `Stemma.Engine.Tests`, 7 `Stemma.Web.Tests`), 0 failed
- [x] `tsc --noEmit` clean · `vite build` clean · `vitest` green (150 tests, 15 files) — the fix is
      server-side only, and the client needed no change: `mergeViews` (`lib/layout.ts:93-97`)
      shallow-spreads per view key, so unmapped members already survive the client-side merge
- [x] Both HTTP paths re-verified on the fixed assembly, under
      `JsonSerializerDefaults.Web` — the options ASP.NET actually binds with, which are *not*
      `LayoutSidecar.JsonOpts`:

      | | shapes | handles | layout | offsets | palettes | waypoints | nodes |
      |---|---|---|---|---|---|---|---|
      | PUT client → disk | kept | kept | kept | kept | kept | kept | kept |
      | GET disk → client | kept | kept | kept | kept | kept | kept | kept |

      `layout`, `offsets` and `palettes` are not features yet — they are the sections §8 · Q4 and
      §8 · Q6 of the capability analysis will add. They were included deliberately to prove the fix
      covers the sections that do not exist yet, which was the whole argument for extension data over
      typed members.
- [ ] Manually verified in the product: draw a shape, dock an edge, reload — both persist; `git diff`
      on `stemma.layout.json` shows the shape and the handles. **Not done — needs a running app.**
- [ ] A sample workspace gains a committed shape and a docked edge, so the format is exercised by
      something that ships. **Not done** — best folded into the F-007 schema work, which is where the
      format gets documented.
- [x] Docs updated: `roadmap.md`'s "Now" section no longer claims these two capabilities ship intact;
      `bugs/README.md` gained the failure mode. The format itself stays undocumented here on purpose —
      that is F-007's job, and this bug is the argument for it.

## 9. Notes

Found while assessing what Stemma needs before an agent can author diagrams as text — see
[`../product/agent-authored-diagrams.md`](../product/agent-authored-diagrams.md) §3 (G5). This bug
blocks that work twice over: an agent cannot hand-author shapes (the read path strips them), and the
UI cannot be used to produce them either (the write path strips them). It should be fixed in Phase 0
of that programme, independently of everything else proposed there.
