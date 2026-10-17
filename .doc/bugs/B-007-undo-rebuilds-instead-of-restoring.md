# Bug: undo rebuilds what an edit removed instead of putting it back

| Field | Value |
|---|---|
| **ID** | B-007 |
| **Status** | `Fixed` |
| **Severity** | `S2 major` |
| **Area** | `engine` |
| **Reported by / Date** | Bartosz / 2026-10-17 |
| **Affected version / commit** | since the undo stack was written |

## 1. Summary

Every undo was a second edit composed from the model, not the reversal of the first. Undoing a
removal re-declared the element at the end of `Build()`, without the comment above it, without its
tag, and — for a Risk, Question or Assumption — without what it was about; undoing the removal of a
`Relation` lost its label. The canvas looked right. `git diff` after edit-then-undo was not empty.

## 2. Steps to reproduce

1. In a model with a commented, tagged element mid-file, remove a Risk that is `about` something.
2. Undo.
3. `git diff`.

- **Expected:** nothing. Edit then undo is no change.
- **Actual:** the Risk's line is gone from where it was and a new one is at the bottom of the
  method, with no `aboutId`; the comment that sat above it is gone too.
- **Frequency:** always, for removals and for clearing a tag; the in-place edits (rename, set
  attribute) happened to round-trip because their inverse is the same edit with the old value.
- **Environment:** any.
- **Evidence:** `UndoTests` before the fix — the restored file differs from the original at the
  removed line, and `Attributes["aboutId"]` is absent.

## 3. Triage

- [x] **Severity & priority agreed** — S2. Undo is the user's way out of a mistake; when it leaves
      the file different, the way out is itself a change nobody asked for.
- [x] **Reproduced** — by the tests below.
- [x] **Regression?** No — inherent in an inverse built from the model.
- [x] **Pillar(s) affected:** Architecture, UX.

## 4. UX / UI impact

- [x] **State involved:** undo after a removal or a tag change.
- [x] **User-visible symptom:** none on the canvas; a moved, stripped declaration in the diff, and a
      Risk that is no longer attached to anything.
- [x] **Severity to trust:** high — "I undid it" and "the file is as it was" stopped being the same.

## 5. Root cause

`UndoStack.BuildInverse` turned each operation into an opposite operation built from the model as
it was before. The model is a summary of the file: it has ids, names and the attributes each kind
emits, and it does not have positions, comments, formatting, RAPID roles or anything else the file
says. An inverse built from it can only re-create the summary. `RestoreElementOp` and
`RestoreLinkOp` also simply had no field for `aboutId` and `label`, so even the summary was short.

- [x] A fidelity rule violated — the contract applies to undo as much as to the edit.

## 6. Fix

- **Approach:** `CommitAsync` now records what each write did — the document's tree before, and the
  exact text it left — and the undo entry is a `RestoreDocumentsOp` that puts the old tree back,
  provided the file is still byte-for-byte what the edit wrote. So undo is the edit's own diff,
  reversed. If the file has changed in between (an outside edit), restoring old bytes would erase
  that change, so the old inverse operation is kept as the fallback, now carrying `aboutId` and
  `label`; with no fallback the undo is refused as `UndoConflict` rather than guessed.
- **Affected files:** `src/Stemma.Engine/Workspace/UndoStack.cs`, `src/Stemma.Engine/Workspace/StemmaEngine.cs`
- [x] Fix implemented
- [x] Inviolable rules respected — the restore replaces one tree with the tree it replaced, and only
      after checking the file is exactly what the edit produced
- [x] No new data store / boundary intact — the history lives in memory for the session, as before;
      Git remains the durable one

## 7. Regression test (required)

- [x] **Test location:** `tests/Stemma.Engine.Tests/UndoTests.cs`
- **What it asserts:** after edit-then-undo the file equals the original byte for byte — for a
  removal, for a cleared tag, and across three edits undone in order; that redo reproduces the edit
  exactly; that a new edit discards the redo branch; that after an outside edit undo keeps that edit
  and still restores what a Risk was about; and that the fallback for a `Relation` keeps its label.

## 8. Verification

- [x] `dotnet test` green
- [ ] Manually verified in the app — not done here
- [x] Docs updated: the bug board
