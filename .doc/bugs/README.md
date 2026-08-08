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

## Known failure modes to check first (Stemma-specific)

Before deep-diving, rule these out — they cause a recurring class of canvas bugs:

- **Sidecar re-fetched mid-session** → unflushed edits clobbered (boxes jump back, routing reverts,
  canvas blinks). Prime once; never re-fetch.
- **Node objects rebuilt mid-drag** or `selected` not preserved across rebuilds → drag snaps back;
  multi-selection wiped by the ~1.5 s poll.
- **Stale store selector** returning a fresh object each snapshot → render loop.
- **Model/presentation boundary crossed** → data in the wrong place; fidelity or sync breaks.
- **A fidelity rule violated** (`NormalizeWhitespace`, string-rebuild) → noisy, untrusted diffs.
- **A closed C# type inside a pass-through format** → members the client writes are silently dropped
  on bind, before anything is written. The round-trip test still passes, because it only asserts what
  the type declares. Any nested type in `LayoutSidecar` needs `[JsonExtensionData]` — see
  [B-001](./B-001-layout-sidecar-drops-shapes-and-edge-handles.md).

The QA / Test Engineer owns this board.
