# ADR-0021: The sidecar is written as changes to the file as it is, not as a copy of it

| Field | Value |
|---|---|
| **Status** | `Proposed` |
| **Date** | 2026-10-17 |
| **Deciders** | Bartosz |

## Context

`stemma.layout.json` is the second of Stemma's two stores ([ADR-0003](./README.md)). It is
committed, reviewed in pull requests, and written by hand and by agents as well as by the canvas;
its schema is published for exactly that ([`schema/stemma.layout.schema.json`](../../../schema/stemma.layout.schema.json)).

Until now the canvas read it once per session and wrote all of it back on every edit:
`PUT /api/workspace/layout` with the session's copy, which the server bound to `LayoutSidecar` and
serialized again. Two failures follow from that, both recorded in
[B-014](../../bugs/B-014-the-sidecar-is-written-whole-from-a-stale-copy.md):

- **Every edit rewrites the file.** Dragging one box into a view of the self-model produced a
  102-line diff: the server's property order replaced the author's, and every default the C# type
  has — an empty `nodes` in every view, an empty `annotations` — was written out.
- **A change made outside during a session is lost.** The session's copy predates it, and the next
  edit writes that copy over it. The rule that the client never re-reads mid-session exists because
  re-reading once threw away unsent edits; it also means nothing written after the read is seen.

The C# side solved the same two problems in [B-009](../../bugs/B-009-edits-rebuild-the-declaration.md)
and [B-008](../../bugs/B-008-outside-edit-is-written-back-forever.md): edit the target in place,
take outside changes in. The sidecar needs the same contract.

## Decision

1. **The client sends changes, not the file.** It keeps the copy it last read or wrote, and on each
   write sends the difference between that and its current copy: a list of
   `{ path, value }` and `{ path, remove: true }`, where `path` is the chain of keys, down to the
   smallest value that changed. `PATCH /api/workspace/layout` replaces `PUT`.
2. **The server applies each change to the file's text.** It finds the value's span in the file as it
   is on disk now and replaces, inserts or removes only that. Everything else stays byte for byte:
   order, unknown keys, escaping, number formats, compact arrays, line endings, the final newline.
   New text is laid out like its neighbours. `SidecarPatch` in the engine does this; the file is
   not passed through `LayoutSidecar` on the way.
3. **Outside changes are taken in.** The engine watches the sidecar along with the sources and
   announces a change that is not the echo of its own write. The client reads the file again and
   lays its unsent changes over it. The rule becomes *never re-read over unsent edits*, not
   *never re-read*.
4. **An unreadable sidecar is never written.** If the file does not parse — a merge conflict, a
   half-saved edit — `GET` and `PATCH` refuse it as `UnreadableSidecar`, and the canvas writes
   nothing until it can be read. Until now it was read as empty, and the next edit replaced it.
5. **`GET` returns the file as it is,** not the C# type's reading of it, so the client sees what the
   file says, unknown keys included.
6. **The comments sidecar follows the same rules** (*added 2026-10-17,
   [B-018](../../bugs/B-018-comments-written-whole-and-read-as-empty.md)*). `comments.stemma.json`
   was written whole from the panel's copy and read a file it could not parse as empty. Comments are
   a list, so its changes name a comment by its id rather than by a path of keys: add one, reply to
   one, resolve one, remove one (`PATCH /api/workspace/comments`, `CommentsPatch`). Adding what is
   there and removing what is gone change nothing, so a change sent twice, or a comment pack
   imported twice, is harmless. Decisions 2–5 apply unchanged: the change is made to the text on
   disk, the engine watches the file and announces a change it did not make (`CommentsChanged`),
   an unreadable file is refused by `GET` and `PATCH`, and `GET` returns the file as it is.

## Consequences

- **Positive:**
  - The diff of a presentation edit is that edit.
  - A pull, a teammate's hand edit or an agent writing the sidecar during a session survives the
    next drag.
  - The sidecar now keeps the same promise as the code.
- **Negative / trade-offs:**
  - A second text editor to maintain, for JSON. It is small, because JSON has no trivia beyond
    whitespace, but it is ours.
  - A file Stemma did not create is no longer stamped with `$schema` on its first write, since that
    would be a change nobody asked for. A sidecar Stemma creates still starts with it.
  - Two writers changing the same value at once: the last write wins, as it does in any editor.
- **Neutral:** `LayoutSidecar` remains the typed reader for the render path and the CLI, and its
  `Write` for creating a file from nothing. The comments have no typed reader any more; nothing
  but the canvas and the report reads them.
- **Neutral:** both editors share one span reader and layout (`JsonText`). A file that escapes
  characters keeps escaping them; one that holds them raw, or has never had one, gets them raw,
  emoji included. An escape JSON requires (a control character) or one System.Text.Json writes
  whatever it is told (an emoji's surrogate pair) does not make a file one that escapes.

## Alternatives considered

- **Round-trip through `JsonNode`.** Keeps order and unknown keys, but re-escapes every string with
  one encoder, expands every array onto lines, and drops the final newline. A hand-formatted file
  would be rewritten on its first edit.
- **Optimistic concurrency (an ETag on `PUT`).** Detects the lost update but still writes the whole
  file, and still answers a conflict by re-reading and retrying.
- **One file per view.** Narrows each write but changes the format every workspace and agent already
  writes, and still rewrites whole files.

## Relationship to the inviolable rules

This extends the fidelity contract, rule 1 in spirit, to the presentation store: never re-serialize
a file to change part of it. Engine purity holds, because `SidecarPatch` uses only
`System.Text.Json`. The model/presentation boundary is unchanged: the sidecar holds the same things
it did.

## References

- [B-014](../../bugs/B-014-the-sidecar-is-written-whole-from-a-stale-copy.md)
- `src/Stemma.Engine/Workspace/SidecarPatch.cs`, `src/Stemma.Engine/Workspace/StemmaEngine.cs`
  (`PatchSidecarAsync`)
- `src/Stemma.Web.Client/src/lib/layout.ts` (`sidecarChanges`, `rereadLayoutSidecar`)
- [B-018](../../bugs/B-018-comments-written-whole-and-read-as-empty.md);
  `src/Stemma.Engine/Workspace/CommentsPatch.cs`, `JsonText.cs`, `SidecarFile.cs`;
  `src/Stemma.Web.Client/src/lib/comments.ts`
- [`../data-flow-and-sync.md`](../data-flow-and-sync.md), rules 2, 4 and 6
