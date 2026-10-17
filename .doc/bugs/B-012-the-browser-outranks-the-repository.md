# Bug: the browser's copy of a workspace outranked the repository, and could replace its sidecar

| Field | Value |
|---|---|
| **ID** | B-012 |
| **Status** | `Fixed` |
| **Severity** | `S2 major` |
| **Area** | `sidecar` |
| **Reported by / Date** | Bartosz / 2026-10-17 |
| **Affected version / commit** | the merges since `14f4e5c` (2026-06-07); the layout-mode write since `96ee93d` (2026-08-08) |

## 1. Summary

The client keeps a copy of each workspace in `localStorage`: its views, notes, node and edge styles,
custom properties, positions and layout modes. That copy was meant to be a cache, something to draw
before the repository had been read. In practice it was merged with what the repository held, and
whatever only the browser had was kept. A view deleted in a pull, a note a teammate removed, a style a
checkout went back past: each came back on the next open, for as long as this browser remembered
it. A view that came back this way was written back into `Views/` the first time it was edited,
which made it real again.

Layout modes went further. Every open "migrated" each remembered mode into the sidecar before the
sidecar had been read, and that scheduled a PUT of a sidecar holding nothing else. It went out
400 ms later. If the file had been read by then, the browser's modes were written over the committed
ones, so a teammate's change to a view's layout never survived anyone else opening the workspace.
If the file had not been read yet, the PUT replaced `stemma.layout.json` with a file that held only
those modes, and every position, style, note and shape in it was gone.

## 2. Steps to reproduce

1. Open a workspace, set a view's layout to *Organic*, and close the tab.
2. Commit a change that sets that view to *Hierarchical* in `stemma.layout.json` (or remove the mode),
   as a teammate would.
3. Open the workspace again in the same browser, and look at `git diff stemma.layout.json`.

- **Expected:** the view is *Hierarchical* and the file is unchanged.
- **Actual:** the view is *Organic*, and so is the file. With the sidecar read slower than 400 ms,
  the file is replaced with
  `{"version":1,"views":{"moduleMap":{"layoutMode":"force"}},"nodeStyles":{},"edgeStyles":{}}`.
- **Same class:**
  - Delete `Views/Foo.cs` and reopen: *Foo* is still listed.
  - Remove a note from the sidecar and reopen: the note is still shown.
  - On a fresh clone, every view showed *Custom* whatever the sidecar said.
- **Frequency:** always for the merges. The full replacement needs a sidecar read slower than the
  debounce: a cold engine load, the desktop shell's first start, or a slow disk.
- **Environment:** any.
- **Evidence:** the first run of `src/lib/browserCache.test.ts` failed 18 of its 23 cases. A probe
  that opened a workspace with a remembered mode, and a sidecar read that never returned, captured
  the PUT shown above.

## 3. Triage

- [x] **Severity & priority agreed:** S2. The sidecar is lost work when it is replaced, and the
      rest are silent changes to what a team committed.
- [x] **Reproduced:** by the test suite, and by the probe above.
- [x] **Regression?** No. Every piece of this shipped as it was written.
- [x] **Pillar(s) affected:** Architecture: the presentation sidecar, which is the second of the
      two stores and has to behave like one.

## 4. UX / UI impact

- [x] **State involved:** any workspace that more than one checkout or one browser has seen.
- [x] **User-visible symptom:** removed things come back, a teammate's layout change does not stick,
      and occasionally a whole canvas is laid out from scratch.
- [x] **Severity to trust:** high. "Code is the database" means what the repository says is what the
      canvas shows, and here the browser could overrule it without saying so.

## 5. Root cause

The rule *the committed copy is authoritative* was written down for each section and then
implemented as *the committed copy wins where both have an entry*. Old line numbers:

- `nodeStyles.ts:60`, `edgeStyles.ts:44`, `customProps.ts:14`, `elementNotes.ts:9`:
  `{ ...local, ...committed }`.
- `layout.ts:188`: `loadLayout` fell through to `localStorage` for a view the sidecar had no
  positions for.
- `store.ts:259`: the views from the code were joined with every view only the browser had. An
  empty `Views/` folder was skipped altogether, so then the browser's whole list stood.
- `api.ts:92`: a list that could not be read came back as `[]`, so a failed request looked the same
  as "no views".
- `store.ts:51`: the layout-mode migration ran on every read, before the sidecar had been read, and
  `rehydratePresentation` never read the modes again afterwards.
- `layout.ts:28`: the debounced write did not check whether the sidecar had been read, so a write
  scheduled before then sent the cache, which held only this session's edits, as the whole file.
- `layout.ts:333`: a `404` (no workspace on the server) was read as an empty sidecar and marked
  as read.

## 6. Fix

- **Approach:** one rule, in one place. Once the sidecar has been read, it is the whole answer, and
  the browser's copy is overwritten with it. Before that, the browser's copy is all there is. The two
  are never merged.
  - **Sections:** the four presentation loaders go through `cachedSection` (`layout.ts`). Positions
    follow the same rule.
  - **Writes before the read:** nothing is written to the sidecar until it has been read. Edits made
    while it loads are held back and written once, merged over the file. Opening reads the sidecar
    from two places at once, the open and the first refresh. The read that lands second leaves the
    cache alone. Without that check, it took the other read's result for held-back edits and wrote
    the file on every open; the in-app pass caught this.
  - **Layout modes:** migrated once per workspace, after the read. Rehydration now reads them.
  - **Views:** the list is what `Views/*.cs` declares, read on open and again on every refresh. A
    save or delete still on its way is laid over that list until the engine answers. A refused save
    is put back as the code has it, and the refusal is shown, not only logged. A list that cannot be
    read leaves the cached one in place.
- **Affected files:**
  - `src/Stemma.Web.Client/src/lib/layout.ts`
  - `src/Stemma.Web.Client/src/lib/store.ts`
  - `src/Stemma.Web.Client/src/lib/api.ts`
  - `src/Stemma.Web.Client/src/lib/{nodeStyles,edgeStyles,customProps,elementNotes}.ts`
  - `src/Stemma.Web.Client/src/App.tsx`
- [x] Fix implemented
- [x] Inviolable rules respected
- [x] No new data store / boundary intact: this removes one; `localStorage` is a cache again

## 7. Regression test (required)

- [x] **Test location:** `src/Stemma.Web.Client/src/lib/browserCache.test.ts`; and, through the app,
      `tests/journey/fidelity.spec.ts`, *opening a workspace writes nothing*
- **What it asserts:**
  - **Sections:** for each of notes, node styles, edge styles and custom properties, an entry the
    sidecar does not have is not drawn and is dropped from the cache. Before the read, the cache is
    still drawn.
  - **Positions:** a view without positions in the sidecar is not laid out from the browser.
  - **Writes before the read:** nothing is written before the read, and an edit made during it
    reaches the file merged over what the file had. Two reads at once write nothing.
  - **Layout modes:** a fresh clone shows the committed mode. A committed mode beats a remembered
    one and is not overwritten. A remembered-only mode is migrated once and not brought back after
    the sidecar drops it.
  - **Views:**
    - A view only the browser has leaves the list, and its open tab closes.
    - An empty `Views/` is an empty list, and an unreadable list keeps the cache.
    - A view deleted outside Stemma goes on the next refresh.
    - A refresh does not undo a save or a delete that is still on its way.
    - A refused save or delete is put back and shown, and so is one that could not be sent.

## 8. Verification

- [x] `npm test` green (327), `tsc -b` clean, `vite build` OK
- [x] Manually verified in the app, in a fresh browser on a scratch copy of the self-model:
  - opening writes nothing;
  - a view file deleted outside leaves the list without a reload and does not return after one.
- [x] Docs updated: [`data-flow-and-sync.md`](../architecture/data-flow-and-sync.md) gains the two
      rules this broke; the bug board
