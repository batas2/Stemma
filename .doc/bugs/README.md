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
| [B-001](./B-001-layout-sidecar-drops-shapes-and-edge-handles.md) | `stemma.layout.json` silently discards free-form shapes and edge dock handles | S2 major | sidecar | Fixed (pending in-app verification) |
| [B-002](./B-002-render-ignores-authored-node-positions.md) | `stemma render` ignores authored `nodes` positions, so a hand-written layout is silently auto-arranged | S2 major | layout | Fixed |
| [B-003](./B-003-render-transparent-emits-opaque-png.md) | `stemma render` writes an opaque PNG while recording `transparent: true` in its manifest | S2 major | web | Fixed |
| [B-004](./B-004-bad-constraint-shape-kills-or-silently-changes-a-render.md) | A constraint field of the wrong shape either kills the render with an unreadable error or silently redraws the picture | S2 major | layout | Fixed |
| [B-005](./B-005-cors-policy-refuses-the-page-the-host-is-serving.md) | The CORS allow-list names the dev server, so the host refuses the page it is serving and floods the log | S3 minor | web | Fixed |
| [B-006](./B-006-model-only-edit-adds-a-byte-order-mark.md) | The first edit to a model-only workspace gives the file a byte-order mark it never had | S2 major | engine | Fixed |
| [B-007](./B-007-undo-rebuilds-instead-of-restoring.md) | Undo rebuilds what an edit removed instead of putting it back | S2 major | engine | Fixed |
| [B-008](./B-008-outside-edit-is-written-back-forever.md) | An edit made outside Stemma is written back to disk, again and again, without its BOM | S2 major | engine | Fixed |

## Known failure modes to check first (Stemma-specific)

Before deep-diving, rule these out — they cause a recurring class of canvas bugs:

- **Sidecar re-fetched mid-session** → unflushed edits clobbered (boxes jump back, routing reverts,
  canvas blinks). Prime once; never re-fetch.
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
- **A closed C# type inside a pass-through format** → members the client writes are silently dropped
  on bind, before anything is written. The round-trip test still passes, because it only asserts what
  the type declares. Any nested type in `LayoutSidecar` needs `[JsonExtensionData]` — see
  [B-001](./B-001-layout-sidecar-drops-shapes-and-edge-handles.md).

The QA / Test Engineer owns this board.
