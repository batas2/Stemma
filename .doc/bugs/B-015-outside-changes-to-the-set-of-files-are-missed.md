# Bug: a file added or deleted outside Stemma, or several changed at once, was not taken in

| Field | Value |
|---|---|
| **ID** | B-015 |
| **Status** | `Fixed` |
| **Severity** | `S2 major` |
| **Area** | `engine` |
| **Reported by / Date** | Bartosz / 2026-10-17 |
| **Affected version / commit** | since the watcher was written; B-008 fixed edits to files the engine already held, and only those |

## 1. Summary

A `git pull` does more than edit files. It adds them, deletes them, and touches several at once.
[B-008](./B-008-outside-edit-is-written-back-forever.md) made the engine take in an outside edit to a
file it held. Everything else about a pull still went wrong:

- **A file added outside was never seen.** Only `Architecture/` and files already in the workspace
  were watched. A view pulled in while the canvas was open was listed, because the list reads the
  disk, but the engine did not hold it. The first edit to it on the canvas wrote a *second* file
  declaring the same view id: `Views/Pulled.cs` and `Views/PulledFromATeammate.cs`.
- **A file deleted outside stayed in the engine.** It went on being compiled and read into the
  model. When it came back with the same text, after a `git checkout` for instance, the engine took
  that for the echo of its own write, so the canvas never heard about it.
- **Several files changed together counted as one.** The watcher's debounce kept only the last path
  of a burst. With a pull that touched three files, two of them stayed stale until something else
  changed them. The poller sometimes rescued one, which is why it was never noticed.

## 2. Steps to reproduce

1. Open a workspace in the app and make it a Git repository.
2. Write `Views/Pulled.cs` declaring `view_pulled` from outside, reload, open the view, and drag an
   element into it.
3. `git status`.

- **Expected:** `Views/Pulled.cs` modified.
- **Actual:** `Views/PulledFromATeammate.cs` created beside it, with the same id.
- **Same class:** `git rm Views/Shape.cs` then `git checkout HEAD -- Views/Shape.cs`, and the view
  does not come back on the canvas. Or write three model files within half a second, and only one
  of them is taken in.
- **Frequency:** always.
- **Environment:** any; both workspace kinds.
- **Evidence:** found in the in-app pass over B-006…B-012. The first run of the three tests below
  failed on every case.

## 3. Triage

- [x] **Severity & priority agreed:** S2. Duplicate declarations written into a team's code, and a
      model that silently disagrees with the disk after an ordinary pull.
- [x] **Reproduced:** in the app, and by the tests.
- [x] **Regression?** No.
- [x] **Pillar(s) affected:** Architecture: the engine's copy of the files is supposed to be the
      files.

## 4. UX / UI impact

- [x] **State involved:** any workspace that is pulled into, checked out or edited by tools while
      open.
- [x] **User-visible symptom:** duplicate views; deleted elements still on the canvas; a restored
      view missing.
- [x] **Severity to trust:** high. The duplicates are written by Stemma, into the repository.

## 5. Root cause

- `StemmaEngine.ShouldWatch` admitted only `Architecture/` and paths of existing documents.
- `TakeInFromDiskAsync` returned "changed" for a document that was gone, and did nothing with it.
- `ExternalWatcher.ScheduleEmit` replaced the pending path instead of adding to it.
- `PollOnce` never reported a path it had not seen before.

## 6. Fix

- **Approach:** the engine's set of files follows the disk, not only their contents.
  - **Watching:** the engine watches every source it would hold if the workspace were opened now:
    any `.cs` under the root that the loader would read (model-only), or under a project's
    directory (project workspaces). bin, obj and generated files are still excluded.
  - **Added files:** taken in without being written. For a project workspace, MSBuildWorkspace
    writes back the same bytes and adds a `Compile` item, and the project file is put back as it
    was, as it is for any commit.
  - **Deleted files:** let go of without trying to delete them, so a return with the same text is
    a change, not an echo.
  - **The watcher:** it reports every path of a burst. A rename reports both the old path and the
    new one, and the poller reports a file it has not seen before.
  - **Saving or removing a view:** the engine first brings its set of files up to date itself. A view
    is found by the id its file declares, and the watcher only notices a new file within a second.
    A reload and a drag fit inside that second, which the journey below showed.
- **Affected files:**
  - `src/Stemma.Engine/Workspace/StemmaEngine.cs`
  - `src/Stemma.Engine/Workspace/ExternalWatcher.cs`
  - `src/Stemma.Engine/Workspace/ModelWorkspaceLoader.cs`
- [x] Fix implemented
- [x] Inviolable rules respected
- [x] No new data store / boundary intact

## 7. Regression test (required)

- [x] **Test location:** `tests/Stemma.Engine.Tests/OutsideEditTests.cs`
  - `Files_added_and_deleted_outside_a_model_only_workspace_are_taken_in`
  - `…_a_project_workspace_are_taken_in`
  - `Several_files_changed_at_once_are_all_taken_in`
  - `A_view_written_a_moment_ago_is_edited_where_it_is_before_the_watcher_has_seen_it`
  - `src/Stemma.Web.Client/tests/journey/fidelity.spec.ts`, *a view pulled in while the canvas is
    open is edited where it is*
- **What it asserts:**
  - A view written outside becomes part of the workspace, unchanged.
  - Saving it edits that file and writes no other.
  - Deleting it takes it out of the workspace, tells the canvas, and nothing writes it back.
  - Writing back exactly the text the engine last held is taken in again, and the canvas is told.
  - For a project workspace, the project file is byte-identical at the end.
  - Three files written inside one debounce are all taken in.
  - A view saved straight after its file was written, with no watcher running, is still edited in
    that file.

## 8. Verification

- [x] `dotnet test` green
- [x] Manually verified in the app: a pulled view is edited in place; a deleted view leaves the list
      and comes back with its file
- [x] Docs updated: the bug board; `data-flow-and-sync.md`
