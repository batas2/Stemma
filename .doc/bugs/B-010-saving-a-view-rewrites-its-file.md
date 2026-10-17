# Bug: saving a view from the canvas regenerated its file, and deleting one removed any file that quoted its id

| Field | Value |
|---|---|
| **ID** | B-010 |
| **Status** | `Fixed` |
| **Severity** | `S2 major` |
| **Area** | `web` |
| **Reported by / Date** | Bartosz / 2026-10-17 |
| **Affected version / commit** | since views were saved from the canvas |

## 1. Summary

`PUT /api/workspace/views` wrote `Views/<Name>.cs` from a string template on every save — adding a
box to a view, renaming it, changing its lens. Whatever the file said beyond the four fields was
lost: the doc comment explaining what question the view answers, comments on its ids, its layout.
The file was named after the view's *current* name, so renaming a view moved its file, and to make
room the endpoint deleted every other file in `Views/` whose text contained the view's id in
quotes. `DELETE` deleted the first file whose text contained the id. A view that mentioned another
view in its narrative could be deleted in its place.

None of this went through the engine, so none of it was compile-gated, verified, or protected
against overwriting a version of the file Stemma had not seen.

## 2. Steps to reproduce

1. Open `samples/StemmaArchitecture` and the view *What ships* (`Views/Shape.cs`, with a doc comment).
2. Add an element to it on the canvas.
3. `git status` and `git diff`.

- **Expected:** one id added to `Shape.cs`.
- **Actual:** `Shape.cs` deleted and `WhatShips.cs` created from the template, without the comment.
- **Frequency:** always.
- **Environment:** any.
- **Evidence:** `ViewsAdapter.Render` was the only writer of view files; the endpoint's
  `existingContent.Contains($"\"{view.Id}\"")` was the only way it found one. A view name with a
  backslash produced a file that did not compile, because only quotes were escaped.

## 3. Triage

- [x] **Severity & priority agreed** — S2. Lost prose and a delete that can hit the wrong file.
- [x] **Reproduced** — from the endpoint code; each case is now a test below. (The old endpoint
      cannot be run against them: the template it called no longer exists in that form.)
- [x] **Regression?** No.
- [x] **Pillar(s) affected:** Architecture.

## 4. UX / UI impact

- [x] **State involved:** every change to a saved view.
- [x] **User-visible symptom:** none in the app; a deleted and recreated file in the diff.
- [x] **Severity to trust:** high — the self-model's six hand-written views would have been the
      first casualties of anyone trying the sample.

## 5. Root cause

The view endpoints wrote and deleted files directly instead of asking the engine, and identified a
view by searching file text instead of reading the file. The engine had a reader for view files and
no writer except the template.

- [x] A fidelity rule violated — rules 2 and 3: a whole file re-emitted from a string.

## 6. Fix

- **Approach:** `StemmaEngine.SaveViewAsync` / `RemoveViewAsync`, which the endpoints now call.
  - A view is found by reading each file's `Define()` for its id.
  - An existing view is edited in place by `ViewsAdapter.Edit`: the name and lens literals replaced,
    ids no longer wanted removed with their own lines, new ids appended like the last, in whichever
    form the file uses (`new[] { … }` or `[ … ]`, one per line or not, trailing comma or not). The
    file and the class keep their names.
  - A new view gets a file whose name no file and no class already has; the template is used for
    that new file only, with every literal escaped by Roslyn.
  - Both go through `CommitAsync`, so they are compile-gated, verified, and refused as
    `ChangedOnDisk` over an unseen version — and are not on the undo stack, because the client keeps
    the views list and would not hear about an undo.
- Found on the way, and fixed with it:
  - **MSBuildWorkspace adds an explicit `<Compile Include>` for a new file**, which in an SDK-style
    project duplicates the glob and breaks the user's next build. This also affected `AddType`.
    `CommitAsync` now puts project files back as they were unless the project disables default
    compile items.
  - **The 1.5-second "this write is ours" window swallowed a real save made inside it**, so the
    engine never saw that save. Echoes are now recognised by content ([B-008](./B-008-outside-edit-is-written-back-forever.md)),
    which made the window unnecessary; it is gone.
- **Affected files:** `src/Stemma.Engine/ArchModel/ViewsAdapter.cs`, `DslVocabulary.cs`,
  `DslWriter.cs`, `SeparatedEdits.cs`; `src/Stemma.Engine/Workspace/StemmaEngine.cs`;
  `src/Stemma.Web/StemmaWebHost.cs`
- [x] Fix implemented
- [x] Inviolable rules respected
- [x] No new data store / boundary intact

## 7. Regression test (required)

- [x] **Test location:** `tests/Stemma.Engine.Tests/ViewWriteTests.cs`,
      `tests/Stemma.Web.Tests/ViewEndpointTests.cs`
- **What it asserts:** saving a hand-written view changes exactly its member lines and leaves the
  doc comment and a comment on an id alone; renaming changes the name literal and keeps the file;
  a second view with the same name gets a new file and the first is byte-identical; deleting a view
  removes only the file that declares it even when another file quotes its id; a name with quotes
  and a backslash reads back exactly; a view can be emptied and refilled; a new view in a project
  workspace leaves the `.csproj` byte-identical; and over HTTP, a view saved twice is one file
  edited in place, keeps a hand-written comment, and is deleted by its id.

## 8. Verification

- [x] `dotnet test` green
- [ ] Manually verified in the app — not done here
- [x] Docs updated: the bug board
