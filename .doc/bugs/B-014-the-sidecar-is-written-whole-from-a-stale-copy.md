# Bug: the sidecar is written whole, from the session's copy, so one drag rewrites it and a pull made meanwhile is lost

| Field | Value |
|---|---|
| **ID** | B-014 |
| **Status** | `Fixed` |
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

- **Approach:** [ADR-0021](../architecture/decisions/0021-sidecar-written-as-changes.md). The sidecar
  is written as changes to the file as it is, and taken in when someone else changes it.
  - **The client sends changes, not the file.** It keeps the copy it last read or wrote, and sends
    the difference down to the smallest value: `{ path, value }` or `{ path, remove: true }`
    (`sidecarChanges`). `PATCH /api/workspace/layout` replaces `PUT`.
  - **The engine applies them to the text.** `SidecarPatch` finds each value's span with
    `Utf8JsonReader` and replaces, inserts or removes only that. New text is laid out like its
    neighbours. Everything else stays byte for byte.

    The first design in this record went through `JsonNode`. A probe showed it re-escapes every
    string with one encoder, puts every array on lines and drops the final newline, so a
    hand-formatted file would still be rewritten.
  - **Outside changes are taken in.** The engine watches the sidecar and announces `SidecarChanged`
    for any text it did not write itself, telling its own write apart by content. The client reads
    the file again and lays its unsent changes over it (`rereadLayoutSidecar`).
  - **An unreadable file is refused,** by `GET` as well as `PATCH`, instead of being read as empty
    and written back.
- **Affected files:**
  - `src/Stemma.Engine/Workspace/SidecarPatch.cs` (new)
  - `src/Stemma.Engine/Workspace/StemmaEngine.cs`, `ExternalWatcher.cs`
  - `src/Stemma.Web/StemmaWebHost.cs`, `Services/EngineHost.cs`
  - `src/Stemma.Web.Client/src/lib/layout.ts`, `api.ts`, `signalr.ts`, `App.tsx`
- [x] Fix implemented
- [x] Inviolable rules respected: the fidelity rule now covers the sidecar too
- [x] No new data store / boundary intact

## 7. Regression test (required)

- [x] **Test location:**
  - `tests/Stemma.Engine.Tests/SidecarPatchTests.cs`
  - `SidecarWriteTests.cs`
  - `tests/Stemma.Web.Tests/LayoutEndpointTests.cs`
  - `src/Stemma.Web.Client/src/lib/sidecarChanges.test.ts`
  - two journeys in `tests/journey/fidelity.spec.ts`
- **What it asserts:**
  - **Engine:** each change to a Stemma-written file and to a hand-written one (tabs, CRLF, compact
    lines, raw characters, no final newline) produces exactly the hand-written edit. The comparison
    is of the whole file.
  - **Engine, file and watcher:** the BOM survives; a missing file is created with `$schema`; a
    conflicted file is refused and left alone; an outside change is announced once, and the engine's
    own write is not announced.
  - **Server:** `GET` returns the file as it is; `PATCH` changes only what it names; an unreadable
    file is refused by both; `PUT` is gone.
  - **Client:**
    - an edit sends only its own values, and is not sent again once it has landed;
    - a refused change is sent again;
    - an outside change is shown and not written over;
    - an unsent edit survives a re-read.
  - **Journeys:**
    - moving a box adds lines to the sidecar and changes none;
    - a note changed outside survives the next drag.

## 8. Verification

- [x] `dotnet test` / `npm test` / journeys green
- [x] Manually verified in the app: one box moved into place in *What ships* is +8/−1 in the diff,
      down from +102/−90. The one changed line is the comma before the new entry.
- [x] Docs updated:
  - ADR-0021;
  - `data-flow-and-sync.md` rules 2, 4 and 6;
  - the operations catalog;
  - conventions, glossary, client-frontend, the frontend persona;
  - the bug board.
