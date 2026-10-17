# Bug: an edit made outside Stemma is written back to disk, again and again, without its BOM

| Field | Value |
|---|---|
| **ID** | B-008 |
| **Status** | `Fixed` |
| **Severity** | `S2 major` |
| **Area** | `engine` |
| **Reported by / Date** | Bartosz / 2026-10-17 |
| **Affected version / commit** | since outside edits were picked up |

## 1. Summary

When `Architecture.cs` changed outside Stemma — a `git pull`, an IDE save, another agent — the
engine took the change in by **writing the file itself**, through the same `TryApplyChanges` that
persists an edit. That write was an outside change to the watcher, so the engine took it in again,
and wrote again: roughly once a second for as long as the workspace stayed open, broadcasting an
`ExternalChange` to every client each time. On a model-only workspace each write also dropped the
file's byte-order mark.

Separately, and for every edit rather than only after an outside one: an operation applied in the
second or so between someone's save and the watcher noticing it was computed from the old text and
written over the new one.

## 2. Steps to reproduce

1. Open a workspace whose `Architecture.cs` has a BOM (Visual Studio writes one).
2. Change the file in another editor and save.
3. Watch the file's modification time, and the log.

- **Expected:** the canvas updates once; the file is not touched by Stemma.
- **Actual:** the file is rewritten about every second indefinitely, without its BOM, and every
  connected canvas re-fetches the model each time.
- **Frequency:** always, after the first outside edit of a session.
- **Environment:** any; the BOM loss on model-only workspaces, the loop on both kinds.
- **Evidence:** a probe that saved the file once and sampled it for eight seconds saw the
  `ExternalChange` count reach 10 and the BOM gone after the first second.

For the second half: open a workspace, save a change to the file in an editor, and make an edit on
the canvas within the polling window. The editor's change is gone.

## 3. Triage

- [x] **Severity & priority agreed** — S2. Each rewrite is a chance to overwrite the next save with
      a stale copy, so the loop turns a narrow race into one that runs every second; the guard's
      absence is lost work by itself.
- [x] **Reproduced** — by the probe, and by the tests below.
- [x] **Regression?** No — the write-back is how outside edits were taken in from the start.
- [x] **Pillar(s) affected:** Architecture, UX.

## 4. UX / UI impact

- [x] **State involved:** any open workspace whose file is edited elsewhere — which is the premise:
      the model is code, and code is edited in many places.
- [x] **User-visible symptom:** a canvas that re-fetches every second, a BOM that disappears, and —
      rarely and unrecoverably — an IDE save that is silently undone.
- [x] **Severity to trust:** high. "Edit it anywhere" is the product's claim.

## 5. Root cause

`StemmaEngine.OnExternalChange` read the file with `File.ReadAllTextAsync` — which strips the BOM
and forgets the encoding — and applied it with `TryApplyChanges`, which for both workspace kinds
*persists* the document. Nothing compared the new text with what the workspace already held, so
the engine's own write came back as a change; the self-write echo window covers `CommitAsync`'s
writes and not this one.

`CommitAsync` checked the disk for nothing before writing: it trusted the workspace's copy, which
is out of date for as long as the watcher has not caught up.

- [x] A fidelity rule violated — bytes changed that no operation targeted.

## 6. Fix

- **Approach:**
  - Read outside text through `SourceText` so encoding and BOM are detected, and do nothing when it
    already matches the workspace — content and preamble — which ends the loop on both paths.
  - `FileBackedWorkspace.TakeIn` updates the document in memory without writing it, so a model-only
    workspace never writes in response to an outside edit at all. `MSBuildWorkspace` has no such
    API; there the text is written back once, byte-identical, and marked as Stemma's own write.
  - Before writing, `CommitAsync` compares each file it is about to change with the text the edit
    was computed from. If they differ the edit is refused as `ChangedOnDisk`, the new text is taken
    in, and clients are told — so a retry lands on top of the save instead of under it.
  - The bare `catch` around the handler now logs.
- **Affected files:** `src/Stemma.Engine/Workspace/StemmaEngine.cs`,
  `src/Stemma.Engine/Workspace/ModelWorkspaceLoader.cs`
- [x] Fix implemented
- [x] Inviolable rules respected
- [x] No new data store / boundary intact

## 7. Regression test (required)

- [x] **Test location:** `tests/Stemma.Engine.Tests/OutsideEditTests.cs`
- **What it asserts:** after one outside save, for four seconds of watcher polls, the file's bytes
  are exactly what was saved — BOM included — and exactly one `ExternalChange` is raised; on a
  model-only workspace the file's modification time does not move at all. And an edit made before
  the engine has noticed a save is refused as `ChangedOnDisk`, leaves the save intact, and succeeds
  on retry with both changes in the file.

## 8. Verification

- [x] `dotnet test` green
- [ ] Manually verified in the app — not done here
- [x] Docs updated: the bug board
