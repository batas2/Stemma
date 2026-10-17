# Bug: the sidecar is written whole, from the session's copy, so one drag rewrites it and a pull made meanwhile is lost

| Field | Value |
|---|---|
| **ID** | B-014 |
| **Status** | `Triaged` |
| **Severity** | `S2 major` |
| **Area** | `sidecar` |
| **Reported by / Date** | Bartosz / 2026-10-17 |
| **Affected version / commit** | since the sidecar was introduced |

## 1. Summary

`stemma.layout.json` is a committed file, written by hand and by agents as well as by the canvas.
The schema is published for exactly that use. But every write from the canvas replaces the whole
file with the session's copy of it, re-serialized by the server. That has two effects.

- **One change rewrites the file.** Dragging one box into a view of
  `samples/StemmaArchitecture` changed 102 lines and removed 90. Semantically, it added one
  position, plus an empty `"nodes": {}` in every view and an empty `"annotations": {}`. Textually,
  it reordered the keys of every view to the server's property order, so a hand-written `layout`
  moved below `edges`. The review of a one-box move is a diff of the whole file.
- **A change made outside during a session is lost.** The client reads the sidecar once per session
  and never again (rule 2 in [`data-flow-and-sync.md`](../architecture/data-flow-and-sync.md)), and
  every write sends its whole copy. A note changed in the sidecar by a `git pull` while the canvas
  was open was gone after the next drag.

This is the presentation-file counterpart of [B-009](./B-009-edits-rebuild-the-declaration.md) and
[B-008](./B-008-outside-edit-is-written-back-forever.md), which are fixed for the C# side.

## 2. Steps to reproduce

1. Commit `samples/StemmaArchitecture` into a scratch repository and open it.
2. Open *What ships* and drag one element into it. Run `git diff --stat stemma.layout.json`.
3. Reset. With the canvas open, change one note in `stemma.layout.json` from outside, then drag any
   box and read the file.

- **Expected:** one entry added; the outside change still there.
- **Actual:**
  - `102 insertions(+), 90 deletions(-)`;
  - the outside change is gone.
- **Frequency:** always.
- **Environment:** any.
- **Evidence:** the in-app pass of 2026-10-17. Opening alone no longer writes the file, which B-012
  fixed. The first edit after opening does.

## 3. Triage

- [x] **Severity & priority agreed:** S2. Lost work for the outside change. An untrustworthy diff
      for every presentation edit.
- [x] **Reproduced:** in the app.
- [x] **Regression?** No.
- [x] **Pillar(s) affected:** Architecture. The sidecar is the second of the two stores, and the
      fidelity contract does not yet cover it.

## 4. UX / UI impact

- [x] **State involved:** any presentation edit; any workspace pulled into while open.
- [x] **User-visible symptom:** a large diff of `stemma.layout.json` for a small change; a teammate's
      layout change silently reverted.
- [x] **Severity to trust:** high for anyone who reviews or writes the sidecar by hand, including the
      *Essayist's Agent* persona.

## 5. Root cause

- `src/Stemma.Web.Client/src/lib/layout.ts`, `scheduleSidecarWrite` and `saveLayout`: every write
  sends `sidecarCache.sidecar`, the whole copy read at the start of the session.
- `src/Stemma.Web/StemmaWebHost.cs`, `PUT /api/workspace/layout`, through `LayoutSidecar.Write`:
  binds the body to the C# type and serializes that. This adds every default the type has and
  orders properties by declaration. `GET` goes through the same type, so even the copy the client
  starts from is already re-serialized.
- Rule 2 ("never re-fetch mid-session") exists because re-fetching once overwrote unsent edits. It
  also means nothing written after the read is ever seen.

## 6. Fix

Not decided. It changes how the sidecar is written, so it needs an ADR first. The direction this
record proposes:

- **Write a patch, not the file.** The client sends the entries it changed (`section`, `key`, value
  or deletion). The server applies them to the file as it is on disk now, through `JsonNode`, so
  order, unknown keys and everything else stay as they are. It writes the result with the file's own
  indentation and line ending. The diff of a one-box move is then one entry, and changes from
  outside to other entries survive by construction.
- **Take the sidecar in like a source file.** The engine already watches the workspace. When the
  sidecar changes outside, the client reads it again and lays its own unsent edits over the result.
  Rule 2 becomes "never re-read *over unsent edits*" instead of "never re-read".

- [ ] Fix implemented
- [ ] Inviolable rules respected
- [ ] No new data store / boundary intact

## 7. Regression test (required)

- [ ] **Test location (planned):** `tests/Stemma.Web.Tests` and
      `src/Stemma.Web.Client/src/lib/presentationSidecar.test.ts`
- **What it will assert:**
  - On the server: a one-entry change to a hand-formatted sidecar changes that entry and no other
    byte.
  - On the client: an outside change to the sidecar is shown, and survives the next edit, which
    is laid over it.

## 8. Verification

- [ ] `dotnet test` / `npm test` green
- [ ] Manually verified in the app
- [ ] Docs updated: an ADR, `data-flow-and-sync.md` rule 2, the bug board
