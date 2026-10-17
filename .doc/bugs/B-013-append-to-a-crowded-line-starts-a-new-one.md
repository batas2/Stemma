# Bug: an id added to a list laid out several to a line went on a line of its own, at column 0

| Field | Value |
|---|---|
| **ID** | B-013 |
| **Status** | `Fixed` |
| **Severity** | `S3 minor` |
| **Area** | `engine` |
| **Reported by / Date** | Bartosz / 2026-10-17 |
| **Affected version / commit** | `d80fa9d` (the in-place view edit, B-010) |

## 1. Summary

A view's ids are often laid out several to a line, each followed by a comma:

```csharp
ElementIds: new[]
{
    "cnt_client", "cnt_web", "cnt_cli", "cnt_desktop",
    "sys_git", "sys_roslyn",
});
```

Adding one from the canvas wrote it on a new line with no indentation:

```diff
     "sys_git", "sys_roslyn",
+"cnt_desktop",
```

`SeparatedEdits.Append` handled a list whose items each carry their own comma by copying the
indentation of the last item onto the new one. That works when the last item starts its line. Here
the last item, `"sys_roslyn"`, sits in the middle of its line, so it has no indentation, and there
was nothing to copy.

## 2. Steps to reproduce

1. Open `samples/StemmaArchitecture` and the view *What ships* (`Views/Shape.cs`).
2. Remove *Desktop shell* from the view in the sidebar, then drag it back onto the canvas.
3. `git diff Views/Shape.cs`.

- **Expected:** `"sys_git", "sys_roslyn", "cnt_desktop",`
- **Actual:** the id on a line of its own, at column 0.
- **Frequency:** always, for a list laid out this way.
- **Environment:** any.
- **Evidence:** found in the in-app pass over B-006…B-012. The fidelity suite's view cases all list
  ids one to a line.

## 3. Triage

- [x] **Severity & priority agreed:** S3. A malformed diff in a file someone laid out by hand. No
      data is lost.
- [x] **Reproduced:** in the app, and by the test below.
- [x] **Regression?** No. The case was not handled when the edit became in-place.
- [x] **Pillar(s) affected:** Architecture.

## 4. UX / UI impact

- [x] **State involved:** saving a view whose ids are laid out several to a line.
- [x] **User-visible symptom:** the diff.
- [x] **Severity to trust:** the diff is where Stemma's promise is checked.

## 5. Root cause

`src/Stemma.Engine/ArchModel/SeparatedEdits.cs`, `Append`, the branch for `commas.Count == items.Count`.
It always gave the new item a line of its own, laid out with an indentation the last item may not
have.

## 6. Fix

- **Approach:** when the last item does not start its line, the new one goes at the end of that line,
  after a space, which is where it would be typed. Whatever ended the line, a note or the line break,
  now follows the new item. The test for "starts its line" reads only the list itself, because an
  earlier edit in the same save may have detached it from its tree: in Roslyn, leading whitespace
  exists only at the start of a line.
- **Affected files:** `src/Stemma.Engine/ArchModel/SeparatedEdits.cs`
- [x] Fix implemented
- [x] Inviolable rules respected
- [x] No new data store / boundary intact

## 7. Regression test (required)

- [x] **Test location:** `tests/Stemma.Engine.Tests/ViewWriteTests.cs`,
      `Adding_to_ids_laid_out_several_to_a_line_continues_the_last_line`
- **What it asserts:** for a line of ids ending in a comma, and for one ending in a comma and a
  note, the new id lands on that line, before the note. The whole file is compared.

## 8. Verification

- [x] `dotnet test` green
- [x] Manually verified in the app: the same remove-then-add on *What ships* gives the expected line
- [x] Docs updated: the bug board
