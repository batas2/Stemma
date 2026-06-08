# Engine & Backend

The engine (`src/Verso.Engine`) is the heart of Verso. It loads a workspace, holds the canonical
model in memory, and applies edits as **fidelity-preserving Roslyn rewrites**. It depends only on
Roslyn and the Model project — never on the web or LLM layers.

## Loading a workspace

1. Open the folder as a Roslyn `MSBuildWorkspace`.
2. Parse `Architecture/Architecture.cs` — the engine finds the static `Build()` method and reads the
   `Model.Of(...)` call to materialise elements, links, and tags.
3. Parse `Views/*.cs` — each file exposes a static `Define()` returning a `View` (the `ViewsAdapter`).
4. Load the presentation sidecar `verso.layout.json` (positions, styles, notes, shapes, per-view
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

Undo/redo is an operation stack (`UndoStack`) layered over Git — `save = commit`, model history is
recoverable via Git as well.

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
6. **Never invent a parallel data store.** Presentation-only state goes in `verso.layout.json`; the
   model goes in code. If a feature seems to need a database, the feature is wrong.
7. **Never edit method bodies** (out of scope for v1) and **never edit generated files** (`*.g.cs` /
   generator output) — refuse the operation.

These rules are restated for contributors in [`../engineering/conventions.md`](../engineering/conventions.md)
and are the first thing the Software Architect checks.

## Adding or changing an operation (the procedure)

1. Confirm the operation is in the operations catalog (archived at
   `../.doc.legacy/specs/operations-catalog.md`; the live catalog moves into this section as it is
   curated). If it is not listed, write the spec first.
2. Ensure at least **three** round-trip fixtures exist — minimal, realistic, pathological. If not,
   add them first.
3. Implement in the engine with `DocumentEditor`.
4. Run the fidelity suite. **If it fails, fix the implementation — never the test.**

## Key types & files (orientation)

| Concern | Where |
|---|---|
| Engine entry / workspace | `Verso.Engine/Workspace/VersoEngine.cs` |
| Architecture-model operations | `Verso.Engine/ArchModel/ArchOperations.cs` |
| DSL read / write | `Verso.Engine/ArchModel/DslReader.cs`, `DslWriter.cs` |
| Views | `Verso.Engine/ArchModel/ViewsAdapter.cs` |
| Undo | `Verso.Engine/Workspace/UndoStack.cs` |
| Presentation sidecar | `Verso.Engine/Workspace/LayoutSidecar.cs` |
| Operation polymorphism | `Verso.Engine/Operations/Operations.cs` |

## Testing

Backend tests are xUnit + FluentAssertions, with round-trip fidelity tests as the core gate. See
[`../engineering/testing.md`](../engineering/testing.md).
