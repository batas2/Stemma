# Bug: The protocol promises `layoutMode` re-arranges a view on open; it never has

| Field | Value |
|---|---|
| **ID** | B-022 |
| **Status** | Fixed |
| **Severity** | S3 minor |
| **Area** | `docs` |
| **Reported by / Date** | Audit ([`agent-architecture-workflow.md`](../product/agent-architecture-workflow.md) §1, A3) / 2026-10-22 |
| **Affected version / commit** | `7264f79` |

## 1. Summary

[`authoring-a-diagram.md`](../protocol/authoring-a-diagram.md) §8 says *"`layoutMode: "force"`
re-runs a generator and overwrites positions on open"*. An agent that reads it writes
`"layoutMode": "hierarchical"` and gets exactly the picture it would have got without it, in the app
and in the render.

## 2. Steps to reproduce

1. Take the B-021 workspace; add `"views": { "custom:view_containers": { "layoutMode": "hierarchical" } }`.
2. Render it.

- **Expected (per the protocol):** a hierarchical arrangement.
- **Actual:** the same 1656×159 row as without the setting.
- **Frequency:** always.

## 3. Triage

- [x] **Severity & priority agreed** — S3: a wrong contract, nothing lost.
- [x] **Reproduced.**
- [x] **Regression?** The sentence was written with C1 (2026-08-08) and was never true.
- [x] **Pillar(s) affected:** Product (the protocol is the agent's product).

## 4. UX / UI impact

- [x] **User-visible symptom:** a setting with no effect.

## 5. Root cause

`layoutMode` is what the Layout panel remembers as the view's choice; the generators run only when
the panel sends `{ type: 'auto' }` (`ArchCanvas.tsx:2296`). Nothing reads the mode on open — and per
[`agent-authored-diagrams.md`](../product/agent-authored-diagrams.md) §8 · Q6 nothing should: a
generator re-run on every open is a picture that changes when the algorithm is tuned.

## 6. Fix

- **Approach:** the code is right and the protocol is wrong. The protocol says what `layoutMode` is
  (the panel's memory, not an instruction) and points at the `layered` constraint (F-021), which is
  the deterministic thing the agent wanted. `stemma validate` notes a heuristic `layoutMode` on a
  view with no positions — `layout/inert-mode` (info) — and says what to write instead.
- **Affected files:** `.doc/protocol/authoring-a-diagram.md`, `src/Stemma.Cli/WorkspaceCheck.cs`.
- **Implementation notes:** "no positions" is a view whose `nodes` is absent, null or empty; "no
  constraint" is a `layout` that is absent or null. A view with either is arranged by it, so its
  `layoutMode` is not reported. `manual` and any other value are not generators and are not reported.
- [x] Fix implemented
- [x] Inviolable rules respected
- [x] No new data store / boundary intact

## 7. Regression test (required)

- [x] A test that **fails before** the fix and **passes after**
- **Test location:** `tests/Stemma.Cli.Tests/WorkspaceCheckTests.cs` — `A_heuristic_layout_mode_on_a_view_with_nothing_arranged_is_said_to_do_nothing`,
  `A_layout_mode_beside_positions_or_a_constraint_is_not_reported`
- **What it asserts:** a view with `layoutMode: "hierarchical"` and no positions is reported as
  `layout/inert-mode`; one with positions, or with a `layout` constraint, is not.

## 8. Verification

- [x] `dotnet test` green
- [x] Protocol re-read against behaviour: §8 says what `layoutMode` is and points at the `layered` constraint.
