# ADR-0022: Books are presentation, and live in the layout sidecar

| Field | Value |
|---|---|
| **Status** | `Proposed` |
| **Date** | 2026-10-18 |
| **Deciders** | Bartosz |

## Context

A book is an ordered walk through the model for one audience: each page shows a view, says what to
look at, and carries the words to say over it ([F-013](../../features/F-013-books.md)). Books have
existed since Epic 08, stored in `Concepts/view-book.stemma.yaml` and read by the YAML adapter that
the decision index lists as historical. Nothing wrote that file. The canvas let you create a book and
edit a page's narrative, and both were gone on the next reload.

Books need a writer. Where they are written is the question, because rule 3 is explicit: the model
lives in code, presentation lives in `stemma.layout.json`, and a feature that seems to need a third
store is the wrong feature.

A book asserts nothing about the system. Deleting one leaves the architecture exactly as true as it
was. Its pages point at views and elements by id, and say how to frame them. That is presentation,
in the same sense as a position or a style.

## Decision

1. **Books live in `stemma.layout.json`, under a top-level `books` object keyed by book id.** The
   YAML file is no longer read; the samples carry their books in their sidecars, and the YAML
   adapter loses its book types.
2. **Pages are an object keyed by page id, with the order in a separate `order` array.** The client
   sends the smallest value that changed ([ADR-0021](./0021-sidecar-written-as-changes.md)), and
   arrays are values. With pages in an array, editing one narrative would replace the whole list.
   Keyed, it is one change at `books.<book>.pages.<page>.narrative`: one line in the diff. A
   reorder is the `order` line and nothing else. Pages the `order` does not mention are shown after
   the ones it does, in file order, so a hand-written book without an `order` still presents.
3. **A page refers to the model, and copies nothing out of it.** `view` is a view id (`moduleMap`,
   `dependencyGraph`, or the id of a view in `Views/`), and `focus` lists element ids. A rename in
   code changes the name everywhere a page shows it. A deleted element or view makes the page
   visibly broken in the editor and an error from `stemma validate`; it never silently shows
   something else.
4. **The client owns the section's schema,** as it does for styles and shapes. The engine stores it
   as written, `schema/stemma.layout.schema.json` describes it for anyone authoring by hand, and
   `stemma validate` reads it to check the references.
5. **Presenting writes nothing.** Moving between pages changes the camera and the view on screen,
   never the sidecar. The canvas is read-only while a book is presented.

## Consequences

- **Positive:**
  - Books persist, travel with the repository, and are reviewed in the same pull request as the
    model they describe. A presentation is versioned with the architecture it presents.
  - The diff of a book edit is that edit, through the writer and the outside-change handling the
    sidecar already has. No new store, endpoint family or watcher.
  - An agent can write a book with the format it already writes for layouts, and validate it.
- **Negative / trade-offs:**
  - A narrative is a JSON string, so a paragraph break is `\n`. That reads acceptably in a diff,
    one line per page, but is awkward to write by hand. The editor is the intended way to write
    prose.
  - The sidecar grows with prose. A large book makes `stemma.layout.json` long, and every view's
    layout shares that file.
- **Neutral:** `GET /api/workspace/books` goes away; the client reads books from the sidecar it
  already holds.

## Alternatives considered

- **Keep `Concepts/view-book.stemma.yaml` and write it.** That is a third store with a second
  parser, a second watcher and a second text editor to keep byte for byte, for data that is
  presentation by any definition the project uses.
- **Books as C# in `Books/*.cs`, rewritten through Roslyn.** It puts prose in string literals and
  needs a family of operations, each with three fidelity fixtures, for edits that assert nothing
  about the system. Views are code because they are a claim about which part of the model belongs
  together. A book is not a claim.
- **One Markdown file per book.** The best format for long prose and for review, but it is a
  third store. Revisit it if narratives outgrow JSON strings, with the sidecar keeping the
  structure and the Markdown only the words.
- **Pages as an array.** Simpler to write by hand, but every edit to a page re-sends the array, and
  a file formatted by hand is reformatted the first time a narrative changes.

## Relationship to the inviolable rules

Rule 3 is the reason for this decision: presentation goes to `stemma.layout.json`, and this moves a
presentation store that had drifted out of it back in. Rules 1 and 2 are unaffected; no source file
is touched. The engine stays pure: it stores the section without interpreting it.

## References

- [F-013](../../features/F-013-books.md)
- [ADR-0021](./0021-sidecar-written-as-changes.md) — the sidecar is written as changes
- `src/Stemma.Web.Client/src/lib/books.ts`, `src/Stemma.Cli/WorkspaceCheck.cs`
- `schema/stemma.layout.schema.json` (`books`)
