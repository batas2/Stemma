# Engine & Backend

The engine (`src/Stemma.Engine`) is the heart of Stemma. It loads a workspace, holds the canonical
model in memory, and applies edits as **fidelity-preserving Roslyn rewrites**. It depends only on
Roslyn and the Model project — never on the web or LLM layers.

## Loading a workspace

1. Open the folder as a Roslyn `MSBuildWorkspace`.
2. Parse `Architecture/Architecture.cs` — the engine finds the static `Build()` method and reads the
   `Model.Of(...)` call to materialise elements, links, and tags.
3. Parse `Views/*.cs` — each file exposes a static `Define()` returning a `View` (the `ViewsAdapter`).
4. Load the presentation sidecar `stemma.layout.json` (positions, styles, notes, shapes, per-view
   layout). It is a *pass-through* cache of presentation data; the engine round-trips it but does
   not interpret most of it.

The result is the in-memory **canonical model**. Nothing is persisted to a database; the files are
the database.

## Applying an operation

Edits arrive as **operations** (polymorphic JSON; see [`data-flow-and-sync.md`](./data-flow-and-sync.md)
for the catalog and wire format). The engine maps each to a targeted source rewrite:

- Operations are pure transformations expressed through `DocumentEditor` / `SyntaxNode.WithX(...)`.
- After a successful rewrite, the engine recomputes the in-memory model and emits a **delta** for
  the client.
- Failures return a structured reason; the client surfaces a toast and does not apply the change.

Undo/redo is an operation stack (`UndoStack`) for the session; Git is the durable history. What
undo guarantees is in [the catalog](#what-undo-guarantees) below.

## The fidelity contract (the most important constraint)

> For every operation applied to a source file `F`, the resulting `F'` differs from `F` **only** in
> the syntactic region the operation targets. All trivia outside that region is byte-identical.

"Trivia" includes: leading/trailing whitespace, blank lines, `//` `///` `/* */` comments,
`#region`/`#if` directives, attribute order on a member, member order (except an explicit move),
`using` order, and line-ending style.

### Inviolable engine rules

1. **Never call `SyntaxNode.NormalizeWhitespace()`.** It destroys trivia.
2. **Never reconstruct a file via string concatenation.** Use `DocumentEditor` or
   `SyntaxNode.WithX(...)` exclusively.
3. **Apply targeted node replacements only** — never re-emit a whole file.
4. **Preserve `SyntaxTrivia`** on every replaced node (copy it from the original before editing).
5. **Cross-file rename uses `Renamer.RenameSymbolAsync`**, which preserves trivia by design.
6. **Never invent a parallel data store.** Presentation-only state goes in `stemma.layout.json`; the
   model goes in code. If a feature seems to need a database, the feature is wrong.
7. **Never edit method bodies** (out of scope for v1) and **never edit generated files** (`*.g.cs` /
   generator output) — refuse the operation.

These rules are restated for contributors in [`../engineering/conventions.md`](../engineering/conventions.md)
and are the first thing the Software Architect checks.

## The operations catalog

Every operation the engine accepts, what it edits, and what it refuses. The fidelity suite
(`tests/Stemma.Engine.Tests/Fidelity/`) holds each one to this: run against a minimal, a realistic
and a pathological fixture, the file afterwards must equal the fixture with exactly the listed edit
made, and edit → undo → redo must reproduce the original and then the edit, byte for byte.

**Every write** goes through `StemmaEngine.CommitAsync` and is refused as:

- `WouldBreakBuild` — the edit introduced a compile error (one that was already there does not count);
  the files are put back.
- `ChangedOnDisk` — a file it would write has changed since the edit was computed from it, so writing
  would put old text back under the new change. The new text is taken in; a retry lands on top of it.

Project files are never changed: MSBuildWorkspace writes a `<Compile Include>` for a new document,
which in an SDK-style project duplicates the glob, so it is put back (unless the project sets
`EnableDefaultCompileItems` to false).

### Model operations (`Architecture.cs`)

| Operation | Edits exactly | Refuses |
|---|---|---|
| `AddElement` | a new `var x = new Kind(...)` before `return`; `x` appended to `Model.Of(...)` | — |
| `AddLink` | the same, for a `DataFlow` / `Dependency` / `Relation` | `FromNotFound`, `ToNotFound` |
| `RenameElement` | the name literal; the variable, where it follows the name, and its uses inside `Build()` — unless the new variable name is taken, when the old one is kept | `ElementNotFound` |
| `RemoveElement`, `RemoveLink` | the declaration's lines, every `Tag.For` naming its variable, and its `Model.Of` entry. Links, `aboutId`s and views that name it by id are left: they are references, the UI tells the user they are detached, and `stemma validate` reports them | `RemoveFailed` |
| `SetElementContext` | the `contextId` argument of a Module or Capability | `ElementNotFound`, `NotNestable`, `ContextNotFound`, `AttributeRequired`, `RewriteFailed` |
| `SetElementAttribute` | one constructor argument the kind has (`aboutId` on a Risk, `role` on a Person) | `ElementNotFound`, `UnknownAttribute`, `AttributeRequired`, `RewriteFailed` |
| `SetLinkAttribute` | one constructor argument of a link (`payload`, `direction`, `kind`, `label`) | `LinkNotFound`, `UnknownAttribute`, `AttributeRequired`, `RewriteFailed` |
| `SetLifecycle` | the fields inside `new Lifecycle(...)` in the element's `Tag.For`; a new `Tag.For` after the declaration when there is none; an emptied lifecycle is removed, and an emptied tag with it | `SetTagFailed`, `UnreadableTag` |
| `SetOwnership` | `Squad` and `Domain` inside `new Ownership(...)`. RAPID roles are not part of the operation and are not touched | `SetTagFailed`, `UnreadableTag` |
| `RestoreElement`, `RestoreLink` | internal: the fallback undo of a removal, re-declaring it before `return` | — |

`RewriteFailed` means the value is already what was asked, and nothing was written.
`AttributeRequired`: a positional argument cannot be removed while later positional arguments depend
on its position — the payload of a flow that has a direction. In a `Lifecycle` or `Ownership`, where
every parameter is nullable, it becomes `null` instead. `UnknownAttribute`: the kind has no such
parameter; nothing is written. A named-argument declaration (`new Module(Id: "m", Name: "M")`) is read
and edited like a positional one, and an argument added to it is named too.

### Type operations (any `.cs` file in the workspace)

Not sent by the canvas today; accepted by the operation protocol, so an agent can send them. Each
refuses `TypeNotFound` for an id the model does not have.

| Operation | Edits exactly | Refuses |
|---|---|---|
| `AddType` | a new file (LF, whatever the OS), or a new type after the last one in the file's namespace, a blank line above it | `NoProject` |
| `RenameType`, `RenameProperty` | the symbol and its references, through `Renamer` — not in strings, not in comments, not the file name | `SymbolNotFound` |
| `RemoveType`, `RemoveProperty` | the member's lines, its attributes and its documentation comment | `TypeNodeNotFound`, `PropertyNotFound` |
| `AddProperty` | a new property after the last member, indented like it | `TypeNodeNotFound` |
| `AddInheritance`, `AddImplementation` | the base list: a base class first, an interface last; a new list after the name | `AlreadyPresent` |
| `RemoveInheritance` | the base class — first in the list | `NoBaseClass` when the type only implements interfaces |
| `RemoveImplementation` | that interface | `InterfaceNotImplemented` |

### Views (`Views/*.cs`)

Saved and deleted through `PUT` / `DELETE /api/workspace/views`, which call
`StemmaEngine.SaveViewAsync` / `RemoveViewAsync`. A view is found by reading the id its `Define()`
declares, never by searching file text. Saving edits the name, the lens and the member ids in place
— in whatever form the file writes them — and keeps the file and class names; a new view gets a file
no other file or class is named after. Refuses `ViewNotFound`, `UnreadableView`. Not on the undo
stack: the client keeps the views list and would not hear about an undo.

### Layout: what "only the target" means

- **New code** takes its indentation from the line it is placed beside and its line ending from the
  line above it, so a tab-indented CRLF file stays one. A new list item is laid out like the last —
  on the same line, or a line of its own — and a new argument is named if the call names its others.
- **A replaced literal** keeps the old literal's trivia: a comment beside it stays beside it.
- **A removed declaration, member or list item** takes its own line when it had the line to itself,
  and otherwise itself and one comma. A comment on its own line goes with it; a documentation comment
  is its own and goes with it. Comments and directives on the lines *above* it stay — Stemma cannot
  tell a note about it from the header of the section it sits in, and deleting prose cannot be taken
  back. Blank lines that only separated it go, so no gap is left doubled.
- **Nothing is ever rebuilt.** A declaration is not composed from the model and swapped in: the model
  is a summary of the file, and a rebuild writes the summary back
  ([B-009](../bugs/B-009-edits-rebuild-the-declaration.md)).
- **Bytes below trivia**: the BOM, or its absence, survives every write
  ([B-006](../bugs/B-006-model-only-edit-adds-a-byte-order-mark.md)).

### What undo guarantees

Each edit's undo entry is the tree of every file it wrote, as it was before. Undo puts those trees
back, provided each file is still byte-for-byte what the edit wrote — so edit-then-undo is no
change at all. If a file has changed since (an outside edit), restoring old bytes would erase that
change, so undo falls back to the inverse operation (re-declare what was removed, put the old value
back), and with no inverse it is refused as `UndoConflict`. Redo re-applies the edit. A new edit,
or an outside one, discards the redo branch ([B-007](../bugs/B-007-undo-rebuilds-instead-of-restoring.md)).

An outside edit is taken in without being written back
([B-008](../bugs/B-008-outside-edit-is-written-back-forever.md)).

## Adding or changing an operation (the procedure)

1. Confirm the operation is in [the catalog](#the-operations-catalog) above. If it is not, write its
   row first: what it edits exactly, and what it refuses.
2. Ensure at least **three** round-trip fixtures exist — minimal, realistic, pathological. If not,
   add them first: a case in `Fidelity/FidelityCases.cs` (or `TypeFidelityCases.cs`) per fixture, with
   the edits written out by hand.
3. Implement in the engine with `DocumentEditor`.
4. Run the fidelity suite. **If it fails, fix the implementation — never the test.**

## Key types & files (orientation)

| Concern | Where |
|---|---|
| Engine entry / workspace | `Stemma.Engine/Workspace/StemmaEngine.cs` |
| Architecture-model operations | `Stemma.Engine/ArchModel/ArchOperations.cs` |
| DSL read / write | `Stemma.Engine/ArchModel/DslReader.cs`, `DslWriter.cs`; constructor shapes in `DslVocabulary.cs` |
| List and trivia edits | `Stemma.Engine/ArchModel/SeparatedEdits.cs` |
| Type operations' syntax edits | `Stemma.Engine/Operations/TypeWriter.cs` |
| Views | `Stemma.Engine/ArchModel/ViewsAdapter.cs` |
| Undo | `Stemma.Engine/Workspace/UndoStack.cs` |
| Presentation sidecar | `Stemma.Engine/Workspace/LayoutSidecar.cs` |
| Operation polymorphism | `Stemma.Engine/Operations/Operations.cs` |

## Testing

Backend tests are xUnit + FluentAssertions, with round-trip fidelity tests as the core gate. See
[`../engineering/testing.md`](../engineering/testing.md).
