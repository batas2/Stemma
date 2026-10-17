# Bugs — Triage Board

Living bug records — one Markdown file per bug, created from
[`../templates/bug-template.md`](../templates/bug-template.md).

## Conventions

- **File name:** `B-<NNN>-<slug>.md` (e.g. `B-031-drag-snaps-back.md`).
- **A bug is not understood until** root cause is identified (cite `path:line`) and a **regression
  test** is named. Every fix ships with that test.
- **Severity:** `S1 blocker` · `S2 major` · `S3 minor` · `S4 cosmetic`. Anything that makes edits feel
  *unsafe* (lost work, jump-back, silent change) is **at least S2** — trust is the product.

## Board

| ID | Bug | Severity | Area | Status |
|---|---|---|---|---|
| [B-001](./B-001-layout-sidecar-drops-shapes-and-edge-handles.md) | `stemma.layout.json` silently discards free-form shapes and edge dock handles | S2 major | sidecar | Fixed |
| [B-002](./B-002-render-ignores-authored-node-positions.md) | `stemma render` ignores authored `nodes` positions, so a hand-written layout is silently auto-arranged | S2 major | layout | Fixed |
| [B-003](./B-003-render-transparent-emits-opaque-png.md) | `stemma render` writes an opaque PNG while recording `transparent: true` in its manifest | S2 major | web | Fixed |
| [B-004](./B-004-bad-constraint-shape-kills-or-silently-changes-a-render.md) | A constraint field of the wrong shape either kills the render with an unreadable error or silently redraws the picture | S2 major | layout | Fixed |
| [B-005](./B-005-cors-policy-refuses-the-page-the-host-is-serving.md) | The CORS allow-list names the dev server, so the host refuses the page it is serving and floods the log | S3 minor | web | Fixed |
| [B-006](./B-006-model-only-edit-adds-a-byte-order-mark.md) | The first edit to a model-only workspace gives the file a byte-order mark it never had | S2 major | engine | Fixed |
| [B-007](./B-007-undo-rebuilds-instead-of-restoring.md) | Undo rebuilds what an edit removed instead of putting it back | S2 major | engine | Fixed |
| [B-008](./B-008-outside-edit-is-written-back-forever.md) | An edit made outside Stemma is written back to disk, again and again, without its BOM | S2 major | engine | Fixed |
| [B-009](./B-009-edits-rebuild-the-declaration.md) | Setting an attribute or a tag rewrote the whole declaration, and removing one took the lines above it | S2 major | engine | Fixed |
| [B-010](./B-010-saving-a-view-rewrites-its-file.md) | Saving a view from the canvas regenerated its file, and deleting one removed any file that quoted its id | S2 major | web | Fixed |
| [B-011](./B-011-type-operations-ignore-layout.md) | The type operations wrote members with no layout and removed them by the wrong rules | S3 minor | engine | Fixed |
| [B-012](./B-012-the-browser-outranks-the-repository.md) | The browser's copy of a workspace outranked the repository, and could replace its sidecar | S2 major | sidecar | Fixed |
| [B-013](./B-013-append-to-a-crowded-line-starts-a-new-one.md) | An id added to a list laid out several to a line went on a line of its own, at column 0 | S3 minor | engine | Fixed |
| [B-014](./B-014-the-sidecar-is-written-whole-from-a-stale-copy.md) | The sidecar is written whole from the session's copy: one drag rewrites it, and a pull made meanwhile is lost | S2 major | sidecar | Fixed |
| [B-015](./B-015-outside-changes-to-the-set-of-files-are-missed.md) | A file added or deleted outside Stemma, or several changed at once, was not taken in | S2 major | engine | Fixed |
| [B-016](./B-016-tarball-render-needs-the-dotnet-it-ships-without.md) | `stemma render` from the tarball needs the `dotnet` the tarball is built to do without | S2 major | cli | Fixed |

## Known failure modes to check first (Stemma-specific)

Before deep-diving, rule these out — they cause a recurring class of canvas bugs:

- **Sidecar re-fetched mid-session** → unflushed edits clobbered (boxes jump back, routing reverts,
  canvas blinks). Prime once; re-read only when someone else changed the file, with the unsent edits
  laid over it (ADR-0021).
- **Node objects rebuilt mid-drag** or `selected` not preserved across rebuilds → drag snaps back;
  multi-selection wiped by the ~1.5 s poll.
- **Stale store selector** returning a fresh object each snapshot → render loop.
- **Model/presentation boundary crossed** → data in the wrong place; fidelity or sync breaks.
- **A fidelity rule violated** (`NormalizeWhitespace`, string-rebuild) → noisy, untrusted diffs.
- **A headless render that reports success** → `stemma render` exits `0` and prints dimensions
  whatever it drew. Nothing below the image asserts the image: every unit in the layout and capture
  path can pass while the picture is wrong. Two of the three bugs on this board were invisible to
  the whole suite and visible in one glance at a PNG — when touching the render path, assert the
  *output*, not the call. See [B-002](./B-002-render-ignores-authored-node-positions.md),
  [B-003](./B-003-render-transparent-emits-opaque-png.md).
- **A sidecar value of the wrong type** → the sidecar is hand-written and agent-written, so a field
  holds whatever the author's editor accepted. A nullish check (`?? default`) passes a string, an
  array and an object; the arithmetic downstream then produces `NaN`, which `JSON.stringify` writes
  as `null`, and the error finally raised names a JSON type rather than the field. Validate the
  *shape*, not just the presence — see
  [B-004](./B-004-bad-constraint-shape-kills-or-silently-changes-a-render.md).
- **A development constant written down as an invariant** → the allow-list, the port, the origin.
  A value that never varies while you build the thing looks like a constant and is usually a
  *topology*: change how the app is served and it is wrong, silently, because the case that proves
  it is the case you never run. See [B-005](./B-005-cors-policy-refuses-the-page-the-host-is-serving.md).
- **A rewrite checked with `Contains`** → the test asserts the new literal is present, and passes
  while the comment above the line, the line's layout and every argument the model does not read are
  gone. Six operations rebuilt whole declarations, from the day they were written, behind tests like
  that. Assert the whole file against hand-written edits — see
  [B-009](./B-009-edits-rebuild-the-declaration.md) and the fidelity suite in
  [`../engineering/testing.md`](../engineering/testing.md).
- **"Ours" decided by timing** → a write within some window of Stemma's own was taken for its echo,
  so a real save inside the window was never seen; and an echo arriving late was taken in again and
  written back, forever. Tell the engine's own writes apart by **content** — the file says what the
  workspace holds — never by the clock. See [B-008](./B-008-outside-edit-is-written-back-forever.md).
- **"The committed copy wins" written as a merge** → `{ ...local, ...committed }` lets the committed
  copy win where both have an entry, and keeps every entry only the browser has. That covers what a
  teammate removed and what a checkout went back past, and it comes back on every open. A cache is
  *replaced* by what it caches. The same goes for writes: a write sent before the file was read
  sends the cache, which is not the file. See [B-012](./B-012-the-browser-outranks-the-repository.md).
- **Watching the files' contents, not the set of files** → a pull adds and deletes as well as edits,
  and touches several files at once. An engine that only takes in edits to files it already holds
  keeps compiling what was deleted, never sees what arrived, and writes a second copy of it. A
  debounce that keeps the last path drops the others. See
  [B-015](./B-015-outside-changes-to-the-set-of-files-are-missed.md).
- **A shared file written whole from a copy read once** → every write re-serializes the file
  (a diff of all of it for a one-line change) and puts back what anyone else changed since the read.
  Write the change, onto the file as it is now. See
  [B-014](./B-014-the-sidecar-is-written-whole-from-a-stale-copy.md).
- **A closed C# type inside a pass-through format** → members the client writes are silently dropped
  on bind, before anything is written. The round-trip test still passes, because it only asserts what
  the type declares. Any nested type in `LayoutSidecar` needs `[JsonExtensionData]` — see
  [B-001](./B-001-layout-sidecar-drops-shapes-and-edge-handles.md).
- **A distribution tried on the machine that built it** → every tool the build needed is on that
  machine, so whatever the package quietly still depends on is found there and nowhere else. Try a
  package unpacked somewhere new with the things it promises to do without hidden. See
  [B-016](./B-016-tarball-render-needs-the-dotnet-it-ships-without.md) and
  `scripts/package/smoke-test.sh`.

The QA / Test Engineer owns this board.
