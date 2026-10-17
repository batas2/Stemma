# Bug: setting an attribute or a tag rewrote the whole declaration, and removing one took the lines above it

| Field | Value |
|---|---|
| **ID** | B-009 |
| **Status** | `Fixed` |
| **Severity** | `S2 major` |
| **Area** | `engine` |
| **Reported by / Date** | Bartosz / 2026-10-17 |
| **Affected version / commit** | since the attribute and tag operations were written |

## 1. Summary

Half the operation catalog edited `Architecture.cs` by composing a fresh declaration from the model
and swapping it in for the old one. Moving a module to another context, setting what a Risk is
about, changing a flow's payload or a lifecycle status all deleted the comment above the line and
the one at the end of it, re-indented it with eight spaces and an LF, collapsed a multi-line
declaration onto one line, wrote `var mod=` without its space — and, for a tag, **deleted the RAPID
roles**, because the model reads squad and domain and nothing else. Removing an element or a link
deleted every blank line, comment and directive above it. Each of these passed its test, because
every test checked that the new literal was there and none checked what had gone.

## 2. Steps to reproduce

1. In `samples/StemmaArchitecture`, set the lifecycle of `DslWriter` (`mod_writer`) — the tag that
   spans four lines and carries `Recommend`, `Agree`, `Perform`, `Input` and `Decide`.
2. `git diff`.

- **Expected:** one changed literal.
- **Actual:** the four lines replaced by one, the RAPID roles and the comment above gone.
- **Frequency:** always, for SetElementContext, SetElementAttribute, SetLinkAttribute, SetLifecycle,
  SetOwnership, RemoveElement and RemoveLink.
- **Environment:** any.
- **Evidence:** the fidelity suite's first run. Two outcomes in it were worse than noise:
  - In the realistic fixture `#endregion` sits in the leading trivia of the next declaration, so
    rebuilding that declaration deleted it, the file stopped compiling, and the compile gate
    rejected the edit as `WouldBreakBuild` — a context change a user could not make at all.
  - Removing any element or link that had a `Tag.For` left the tag naming a variable that no longer
    existed, and was rejected the same way. The self-model has twenty.

Found on the way, by the pathological fixture:

- Declarations written with **named arguments** (`new Module(Id: "m", Name: "M")`) were invisible.
  The reader compared `Id` with `id`, so the element was not in the model and nothing could edit
  it; `RenameElement` on one replaced the `Id` instead of the `Name`.
- New declarations were always eight spaces and `\n`, so a tab-indented CRLF file gained a
  space-indented LF line, and `Model.Of(a, b)` became `Model.Of(a, b,c)`.
- Renaming a `Concept` gave its variable the prefix `v`.

## 3. Triage

- [x] **Severity & priority agreed** — S2. Silent loss of what the user wrote: comments, roles,
      layout. This is the failure the product's one promise is about.
- [x] **Reproduced** — 52 of 54 cases in the fidelity suite before the fix (two read-only cases
      passed), and the sample probe above.
- [x] **Regression?** No — the approach was wrong from the start; fragment assertions hid it.
- [x] **Pillar(s) affected:** Architecture.

## 4. UX / UI impact

- [x] **State involved:** every inspector edit of a context, an attribute, a payload, a lifecycle
      or an ownership; every delete.
- [x] **User-visible symptom:** none on the canvas. In review: comments disappearing, layout
      changing, roles vanishing, and a delete that is refused for no reason the user can see.
- [x] **Severity to trust:** the highest. The diff is the evidence, and it said Stemma was careless.

## 5. Root cause

- `DslWriter.SetElement` and `SetLinkAttribute` built a whole new statement with `ParseLocal` — a
  string with eight spaces, the arguments the kind is known to emit, and `\n` — and replaced the
  original `LocalDeclarationStatementSyntax` with it. The original's trivia, layout, named-argument
  form and any argument outside the known shape were discarded with the node.
- `BuildTagStatement` did the same for `Tag.For`, from an `ArchOwnership` that only ever held squad
  and domain.
- `RemoveStatementById` removed with `SyntaxRemoveOptions.KeepNoTrivia`, which takes the statement's
  *leading* trivia — every line above it back to the previous statement — along with it, and did
  not remove the statement's tags.
- `SeparatedSyntaxList.Add` and `Remove` choose separators without regard to layout.
- `DslReader.ExtractArgs` used named-argument names as written.

- [x] A fidelity rule violated — rules 2 (string reconstruction), 3 (whole-node re-emission) and 4
      (trivia not preserved).

## 6. Fix

- **Approach:** nothing is rebuilt.
  - An attribute is one argument: its literal is replaced with the old one's trivia, or the argument
    is removed or added through `SeparatedEdits`, which lays a new item out like the last and takes a
    removed one's line only when it had one to itself. An added argument is named when the call
    already names its arguments. A positional argument that later ones depend on is not removed:
    in a `Lifecycle`/`Ownership` it becomes `null`, elsewhere the edit is refused as
    `AttributeRequired`. An attribute the kind does not have is refused as `UnknownAttribute`
    instead of being silently ignored.
  - A tag is edited field by field inside `new Lifecycle(...)` / `new Ownership(...)`; fields the
    operation does not carry, such as RAPID roles, are not touched. An emptied part is removed, and
    an emptied tag with it.
  - Removing a declaration removes its own line and its tags' and its `Model.Of` entry; whatever
    stood above each line stays, because Stemma cannot tell a note about an element from the header
    of the section it is in.
  - New statements take their indentation from the statement they are placed beside and their line
    ending from the line above.
  - `DslVocabulary` is now the one table of constructor shapes, shared by the reader and the writer;
    the reader maps `Id:` to `id`, and reads a tag part by its type when it is positional.
- **Affected files:** `src/Stemma.Engine/ArchModel/DslWriter.cs`, `DslReader.cs`,
  `DslVocabulary.cs` (new), `SeparatedEdits.cs` (new); `src/Stemma.Engine/Workspace/StemmaEngine.cs`.
- [x] Fix implemented
- [x] Inviolable rules respected
- [x] No new data store / boundary intact

## 7. Regression test (required)

- [x] **Test location:** `tests/Stemma.Engine.Tests/Fidelity/` — the fidelity suite, against
      `Fixtures/arch/{minimal,realistic,pathological}.cs` — and `DslWriterContractTests.cs`.
- **What it asserts:** for every architecture operation on each fixture, the file after the edit
  equals the fixture with exactly the hand-written edits made — every other byte identical,
  including the BOM, tabs and mixed line endings — and edit → undo → redo reproduces the original
  and then the edit, byte for byte. The contract tests cover the refusals and the cases the fixtures
  do not reach; nine of their ten fail against the old writer.

## 8. Verification

- [x] `dotnet test` green
- [x] Verified on the self-model sample: seven edits — a RAPID tag's status and squad, a context,
      removing a person and a tagged flow, a rename and an add — each producing only its own lines
      in `diff -u`
- [x] Manually verified in the app, 2026-10-17: Phase, Squad, Status, Context, a rename and a
      remove through the inspector each changed only their own argument, declaration, tag and
      `Model.Of` entry
- [x] Docs updated: the bug board; the operations catalog and the testing guide follow in the same series
