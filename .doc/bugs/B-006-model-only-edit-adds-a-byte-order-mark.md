# Bug: the first edit to a model-only workspace gives the file a byte-order mark it never had

| Field | Value |
|---|---|
| **ID** | B-006 |
| **Status** | `Fixed` |
| **Severity** | `S2 major` |
| **Area** | `engine` |
| **Reported by / Date** | Bartosz / 2026-10-17 |
| **Affected version / commit** | `8e82df9` (the SDK-free load path, ADR-0016) onward |

## 1. Summary

A model-only workspace — the kind every from-scratch model is ([F-003](../features/F-003-from-scratch-onboarding.md))
— wrote a UTF-8 byte-order mark at the start of `Architecture.cs` on the first edit, whether or not
the file had one. So the user's first diff was their change **and** line 1, which no editor shows
and every `git diff` does.

## 2. Steps to reproduce

1. Create a model from the start screen, or any folder with `Architecture/Architecture.cs` and no
   project file, saved without a BOM (which is what every editor on Linux and macOS writes).
2. Add an element.
3. `git diff Architecture/Architecture.cs`.

- **Expected:** one added declaration and one changed `return Model.Of(...)` line.
- **Actual:** the same, plus `-using Stemma.Model;` / `+using Stemma.Model;` on line 1 — identical
  text, differing by three invisible bytes.
- **Frequency:** always, on the first write to each BOM-less file.
- **Environment:** any OS; model-only workspaces only. Workspaces with a `.csproj` or `.sln` load
  through MSBuild, which detects the encoding correctly.
- **Evidence:** found by the byte-exact fidelity suite. On its first run, every case against the two
  BOM-less fixtures that got as far as writing failed on line 1 with `<BOM>using Stemma.Model;`.

## 3. Triage

- [x] **Severity & priority agreed** — S2. A diff with a change the user did not make is the exact
      failure the fidelity contract exists to rule out.
- [x] **Reproduced** — by the suite on the minimal and realistic fixtures, and in isolation by the
      regression test below.
- [x] **Regression?** No — wrong since the model-only path was written.
- [x] **Pillar(s) affected:** Architecture.

## 4. UX / UI impact

- [x] **State involved:** the first edit of a session on each file.
- [x] **User-visible symptom:** an unexplained change to line 1 in `git diff` and in review.
- [x] **Severity to trust:** high, and quiet: the canvas shows nothing wrong, and the one person who
      sees it — the reviewer — sees Stemma editing a line nobody asked it to.

## 5. Root cause

`ModelWorkspaceLoader.Load` read each file with
`SourceText.From(stream, Encoding.UTF8, …)`. The second argument is the encoding assumed when the
file has **no** BOM, and `Encoding.UTF8` is the instance that *emits* one. `FileBackedWorkspace`
then writes with `text.Encoding`, faithfully, so the assumption became a preamble on disk.

The existing test (`File_encoding_and_bom_survive_a_write`) only covered a file that already had a
BOM, which is the one case the wrong default cannot break.

- [x] A fidelity rule violated — rule 4 ("preserve trivia"), at the byte level below trivia.

## 6. Fix

- **Approach:** assume `new UTF8Encoding(encoderShouldEmitUTF8Identifier: false)` for a file without
  a BOM. A file *with* one is still detected as UTF-8-with-BOM by `SourceText` and written back with it.
- **Affected files:** `src/Stemma.Engine/Workspace/ModelWorkspaceLoader.cs`
- [x] Fix implemented
- [x] Inviolable rules respected
- [x] No new data store / boundary intact

## 7. Regression test (required)

- [x] **Test location:** `tests/Stemma.Engine.Tests/ModelOnlyWorkspaceTests.cs` —
      `A_file_without_a_bom_does_not_gain_one`; and the MSBuild path's counterpart,
      `ArchModelTests.An_edit_through_a_project_workspace_does_not_add_a_byte_order_mark`, which
      already passed and is there so the two load paths cannot drift apart.
- **What it asserts:** after an edit, a file saved without a BOM still starts with `using`, not
  `EF BB BF`. The fidelity suite asserts the same thing for every operation, because it compares
  the whole file including its first three bytes.

## 8. Verification

- [x] `dotnet test` green
- [x] Manually verified in the app, 2026-10-17: the first edit through the inspector to a BOM-less
      model-only workspace leaves it without one
- [x] Docs updated: the bug board
