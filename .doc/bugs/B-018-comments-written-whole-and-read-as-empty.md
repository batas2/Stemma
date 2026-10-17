# Bug: comments are written whole from the panel's copy, and a file that does not parse reads as none

| Field | Value |
|---|---|
| **ID** | B-018 |
| **Status** | `Fixed` |
| **Severity** | `S2 major` |
| **Area** | `sidecar` |
| **Reported by / Date** | Bartosz / 2026-10-17 |
| **Affected version / commit** | since the comments panel (Epic 07); 0.1.0 |

## 1. Summary

`comments.stemma.json` had every fault [B-014](./B-014-the-sidecar-is-written-whole-from-a-stale-copy.md)
fixed for the layout sidecar, and one worse:

- **A comment arriving meanwhile was lost.** The panel read the file when it opened and sent its copy
  of the whole file with every action. A comment that came in a pull, from a teammate or from an
  agent while the panel was open was written over by the next comment, reply or resolve.
- **Every write rewrote the file.** The server bound the body to closed C# records and serialized
  them again: keys it did not model were dropped, order was its own, a hand-written file lost its
  layout and its final newline, and every non-ASCII character was escaped. A Polish comment read
  `nale\u017C\u0105` in every diff.
- **A file that did not parse read as no comments, and the next one replaced it.** The reader caught
  every error and returned an empty list. After a merge left its markers in the file, the panel
  showed nothing, and posting a comment wrote a file holding that one comment over both sides of
  the conflict. The report did the same: it exported with no comments and said nothing.

## 2. Steps to reproduce

1. Open a workspace with comments, select an element and open its Comments panel.
2. From outside, add a comment to `comments.stemma.json` (or pull one).
3. Post a comment in the panel. `git diff comments.stemma.json`.

- **Expected:** the new comment added, and nothing else changed.
- **Actual:** the outside comment gone, the file re-serialized.
- **Same class:** put merge-conflict markers in the file, open the panel (it is empty), post a comment:
  the file now holds that comment alone.
- **Frequency:** always.
- **Evidence:** found while closing B-014; listed as the next fidelity gap in the roadmap.

## 3. Triage

- [x] **Severity & priority agreed:** S2. Review comments are lost, silently, by an ordinary action —
      and in the merge-conflict case, all of them.
- [x] **Reproduced:** by the tests below, and in the app by the journeys.
- [x] **Regression?** No.
- [x] **Pillar(s) affected:** Architecture (the store and how it is written), UX (a panel that showed
      nothing for a file it could not read).

## 4. UX / UI impact

- [x] **State involved:** the Comments panel on an element or shape; comment-pack import; report
      export.
- [x] **User-visible symptom:** a teammate's comment disappears; a file with a conflict shows no
      comments and loses them all on the next post.
- [x] **Severity to trust:** high. Comments are the one place reviewers write into the repository.

## 5. Root cause

- `src/Stemma.Engine/Workspace/CommentsSidecar.cs`: `Read` returned `Empty()` from a `catch`;
  `Write` serialized the records with `JsonSerializerDefaults.Web`.
- `src/Stemma.Web/StemmaWebHost.cs`: `PUT /api/workspace/comments` bound and wrote the whole file.
- `src/Stemma.Web.Client/src/components/CommentsPanel.tsx`: every action sent the panel's copy,
  loaded once when it opened.
- `src/Stemma.Web.Client/src/report/reportData.ts`: a failed read exported as no comments.

## 6. Fix

- **Approach:** the same as ADR-0021's for the layout, decision 6 there.
  - **Changes, by id.** The panel sends what it did — add a comment, reply to one, resolve one,
    remove one — naming the comment by its id. `PATCH /api/workspace/comments` replaces `PUT`.
  - **Applied to the file as it is.** `CommentsPatch` makes each change to the text on disk now and
    leaves every other byte; the shared span reading and layout moved from `SidecarPatch` into
    `JsonText`, which now reads lists as well as objects. Adding a comment that is there already,
    or a reply that is there already, and removing one that is gone, change nothing, so a change
    sent twice or a comment pack imported twice is harmless.
  - **Refused, never replaced.** A file that does not parse is refused by `GET` and `PATCH`
    (`UnreadableSidecar`), with the line to look at. The panel says so, writes nothing and shows no
    stale comments; the report export fails with the same message instead of shipping none.
  - **Taken in.** The engine watches the file, and announces a change that is not its own write
    (`CommentsChanged`); an open panel reads it again. `PATCH` answers with the file as it now is.
  - **Escaping.** A file that escapes characters keeps escaping them; one that holds them raw, or has
    never had one, gets them raw. This applies to both sidecars.
- **Affected files:**
  - `src/Stemma.Engine/Workspace/CommentsPatch.cs` (new), `JsonText.cs` (new), `SidecarFile.cs`
    (new), `SidecarPatch.cs`, `CommentsSidecar.cs`, `StemmaEngine.cs`, `ExternalWatcher.cs`
  - `src/Stemma.Web/StemmaWebHost.cs`, `Services/EngineHost.cs`
  - `src/Stemma.Web.Client/src/lib/comments.ts`, `lib/signalr.ts`, `App.tsx`,
    `components/CommentsPanel.tsx`, `report/reportData.ts`
- [x] Fix implemented
- [x] Inviolable rules respected
- [x] No new data store / boundary intact — the file existed; it is now written like the other one

## 7. Regression test (required)

- [x] `tests/Stemma.Engine.Tests/CommentsPatchTests.cs` — every change against a Stemma-written and a
      hand-written file, compared whole with hand-written edits: adding, replying, resolving,
      removing, each at the start, end and only position; escaping; line endings; refusals.
- [x] `tests/Stemma.Engine.Tests/CommentsWriteTests.cs` — the BOM kept; a first comment creates the
      file; a no-op writes nothing; a conflicted file refused and left; an outside change announced
      once and the engine's own write not.
- [x] `tests/Stemma.Web.Tests/CommentsEndpointTests.cs` — `GET` returns the file; `PATCH` changes
      what it names and answers with the file; an unreadable file is refused by both; a reply to a
      removed comment is refused; `PUT` is gone.
- [x] `src/Stemma.Web.Client/src/lib/commentsSync.test.ts` — the client sends changes, reads a refusal
      as one, and turns a comment pack into the changes it brings.
- [x] `tests/journey/fidelity.spec.ts` — *a comment posted is that comment, and one pulled in
      meanwhile survives it*; *comments that cannot be read are said to be, and nothing is written
      over them*.

## 8. Verification

- [x] `dotnet test` green · `vitest` green · journeys green
- [x] Manually verified in the app, both themes: the pulled comment appears in the open panel; the
      conflicted file shows the warning and disables posting
- [x] Docs updated: ADR-0021 (decision 6), `data-flow-and-sync.md`, `engine-backend.md`, the bug
      board, the roadmap, the changelog
