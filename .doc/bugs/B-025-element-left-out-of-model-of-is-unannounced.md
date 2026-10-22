# Bug: An element left out of `Model.Of` is drawn, and nothing says the compiled model lacks it

| Field | Value |
|---|---|
| **ID** | B-025 |
| **Status** | Fixed |
| **Severity** | S3 minor |
| **Area** | `cli` |
| **Reported by / Date** | Audit ([`agent-architecture-workflow.md`](../product/agent-architecture-workflow.md) §1, A9) / 2026-10-22 |
| **Affected version / commit** | `7264f79` |

## 1. Summary

Stemma reads the model off the declarations in `Build()`; the C# compiler — and every test an engineer
writes against `Architecture.Build()` — reads what `Model.Of(...)` collects. An agent that declares
`var orphan = new Container(...)` and forgets to add `orphan` to `Model.Of` gets a box on the canvas
and a model that, compiled, does not contain it. Nothing reports the difference.

## 2. Steps to reproduce

1. Declare an element, use it in a view, leave it out of `Model.Of`.
2. `stemma validate` → *nothing to report*.

- **Expected:** a warning naming the variable.
- **Actual:** silence.

## 3. Triage

- [x] **Severity & priority agreed** — S3.
- [x] **Reproduced.**
- [x] **Pillar(s) affected:** Architecture (two readings of one file disagree).

## 4. UX / UI impact

- [x] **User-visible symptom:** none in Stemma, which is the problem.

## 5. Root cause

`DslReader.TryRead` (`src/Stemma.Engine/ArchModel/DslReader.cs:44`) collects every element and link
declaration in `Build()` and never looks at the `return`. That is correct for Stemma — the engine's
`AddElement` writes both, and a declaration is the claim — but leaves the second reading unchecked.

## 6. Fix

- **Approach:** the reader records the locals the `return Model.Of(...)` names. `validate` reports a
  declared element or link whose variable is not among them as `model/not-collected` (warning): *"cnt_orphan
  is declared in Architecture.cs:14 but not collected in Model.Of(...); Stemma draws it, the compiled
  model does not have it. Add `orphan` to Model.Of."* A `Build()` whose return is not a `Model.Of` call
  with plain identifiers is not checked (nothing can be said about it).
- **Affected files:** `src/Stemma.Engine/ArchModel/DslReader.cs`, `ArchModel.cs`,
  `src/Stemma.Cli/WorkspaceCheck.cs`.
- **Implementation notes:** the reader records each element's and link's local and line
  (`ArchModel.Locals`) and the locals `Model.Of` names (`ArchModel.Collected`, null when unknown). "Plain
  identifiers" is read strictly: every argument must be a local of `Build()` holding an element, a link
  or a tag (one the reader left out included). A local holding anything else — `var all = new object[]
  { … }; return Model.Of(all);` — could collect anything, so that file is not checked. A merged model
  keeps every file's locals and no collection of its own; `validate` checks each file's declarations
  against that file's return.
- [x] Fix implemented
- [x] Inviolable rules respected
- [x] No new data store / boundary intact

## 7. Regression test (required)

- [x] A test that **fails before** the fix and **passes after**
- **Test location:** `tests/Stemma.Cli.Tests/WorkspaceCheckTests.cs` — the section *Model.Of (B-025)*;
  `tests/Stemma.Engine.Tests/DslReaderTests.cs` — the section *what Model.Of collects (B-025)*.
- **What it asserts:** a declared, uncollected element is reported with its variable; a collected one,
  a tag local and a model whose return is not `Model.Of` are not.

## 8. Verification

- [x] `dotnet test` green
