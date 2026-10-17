# Bug: the type operations wrote members with no layout and removed them by the wrong rules

| Field | Value |
|---|---|
| **ID** | B-011 |
| **Status** | `Fixed` |
| **Severity** | `S3 minor` |
| **Area** | `engine` |
| **Reported by / Date** | Bartosz / 2026-10-17 |
| **Affected version / commit** | since the type operations were written |

## 1. Summary

The ten type operations (AddType … RemoveImplementation) are the class-level half of the operation
catalog. The canvas does not send them, but the operation protocol accepts them, so an agent or a
script can. Four of them had no test at all, and the rest were checked with `Contains`. Under the
fidelity suite, six of the ten were wrong:

- **AddProperty** appended the property with no indentation and no line ending, so it landed on the
  closing brace's line: `public decimal Tax { get; set; }}`.
- **AddType** into an existing file did the same with a whole type.
- **RemoveProperty** and **RemoveType** kept the removed member's indentation and its documentation
  comment, which then documented the next member, and left a blank line before a closing brace.
- **AddImplementation** into an existing base list wrote `IPriced,IAudited`, or, when the last base
  ended its line, put the comma at the start of the next one.
- **RemoveImplementation** of the last base took the line ending and the comment after it with it:
  `: Entity // the price…⏎{` became `: Entity    {`.
- **RemoveInheritance** removed the first entry of the base list by position, which for a type that
  implements interfaces and inherits from nothing is an interface.

And a new file from **AddType** used `Environment.NewLine`, so the same operation wrote LF on Linux
and CRLF on Windows.

## 2. Steps to reproduce

Apply each operation to `tests/Stemma.Engine.Tests/Fixtures/types/*.cs` and diff.

- **Expected:** the declaration's own lines and nothing else.
- **Actual:** as above.
- **Frequency:** always.
- **Environment:** any.
- **Evidence:** the first run of `TypeOperationFidelityTests` — 19 of 35 cases failed; the Renamer-based
  operations and the simple base-list changes passed.

## 3. Triage

- [x] **Severity & priority agreed** — S3. The same class of damage as [B-009](./B-009-edits-rebuild-the-declaration.md),
      but with no path from the UI today.
- [x] **Reproduced** — by the suite.
- [x] **Regression?** No.
- [x] **Pillar(s) affected:** Architecture.

## 4. UX / UI impact

- [x] **State involved:** none in the app; any client of the operation protocol.
- [x] **User-visible symptom:** a malformed diff, and for RemoveInheritance the wrong edit.
- [x] **Severity to trust:** the protocol is the surface agents use, and an agent cannot look at the
      result and notice.

## 5. Root cause

`AddMembers` and `RemoveNode(…, KeepLeadingTrivia)` used directly, and `SeparatedSyntaxList.Insert`
and `Add` for the base list, none of which consider layout; RemoveInheritance never checked what
the first base was.

## 6. Fix

- **Approach:** `TypeWriter`, the type-level counterpart of the architecture writer. A new member
  takes its neighbours' indentation and the file's line ending; a new type is separated from the
  last by a blank line, as the types above it are; a removed member takes its own lines, attributes
  and documentation comment, and leaves other comments and directives where they were; base-list
  edits go through `SeparatedEdits`. RemoveInheritance asks the compilation whether the type has a
  base class and is refused as `NoBaseClass` if not. A new file is written with LF.
- **Affected files:** `src/Stemma.Engine/Operations/TypeWriter.cs` (new),
  `src/Stemma.Engine/ArchModel/SeparatedEdits.cs` (`Trivia.KeptAbove`, now also used when a model
  declaration is removed), `src/Stemma.Engine/Workspace/StemmaEngine.cs`
- [x] Fix implemented
- [x] Inviolable rules respected
- [x] No new data store / boundary intact

## 7. Regression test (required)

- [x] **Test location:** `tests/Stemma.Engine.Tests/Fidelity/TypeOperationFidelityTests.cs`, against
      `Fixtures/types/{minimal,realistic,pathological}.cs`.
- **What it asserts:** every type operation on every fixture changes exactly the hand-written edits,
  and undo and redo reproduce the original and the edit byte for byte; a type added in a new file
  touches no other file and is removed by undo; RemoveInheritance on an interface-only type is
  refused and changes nothing.

## 8. Verification

- [x] `dotnet test` green
- [x] Manually verified: not applicable — no UI path
- [x] Docs updated: the bug board; the operations catalog follows in the same series
