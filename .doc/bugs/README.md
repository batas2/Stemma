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
| _—_ | _No open bug records. File the first with the template._ | | | |

## Known failure modes to check first (Verso-specific)

Before deep-diving, rule these out — they cause a recurring class of canvas bugs:

- **Sidecar re-fetched mid-session** → unflushed edits clobbered (boxes jump back, routing reverts,
  canvas blinks). Prime once; never re-fetch.
- **Node objects rebuilt mid-drag** or `selected` not preserved across rebuilds → drag snaps back;
  multi-selection wiped by the ~1.5 s poll.
- **Stale store selector** returning a fresh object each snapshot → render loop.
- **Model/presentation boundary crossed** → data in the wrong place; fidelity or sync breaks.
- **A fidelity rule violated** (`NormalizeWhitespace`, string-rebuild) → noisy, untrusted diffs.

The QA / Test Engineer owns this board.
