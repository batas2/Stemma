# Bug: `view/busy` warns on every architecture view

| Field | Value |
|---|---|
| **ID** | B-024 |
| **Status** | Fixed |
| **Severity** | S3 minor |
| **Area** | `cli` |
| **Reported by / Date** | Audit ([`agent-architecture-workflow.md`](../product/agent-architecture-workflow.md) §1, A8) / 2026-10-22 |
| **Affected version / commit** | `7264f79` |

## 1. Summary

`stemma validate` warns `view/busy` above seven elements. Seven boxes is the essay's house rule for an
argument diagram; a C4 container view of a modest system has fifteen to thirty. Every architecture
workspace therefore carries a standing warning, and an agent learns to ignore warnings — which is how
the warning that matters gets ignored too.

## 2. Steps to reproduce

1. Any view of more than seven structural elements; `stemma validate`.

- **Expected:** silence for an architecture view of ordinary size.
- **Actual:** `warning view/busy … past 7 a diagram has usually stopped answering one question`.

## 3. Triage

- [x] **Severity & priority agreed** — S3.
- [x] **Reproduced.**
- [x] **Pillar(s) affected:** Product.

## 4. UX / UI impact

- [x] **User-visible symptom:** noise in the agent's main feedback channel.

## 5. Root cause

`WorkspaceCheck.BusyViewThreshold = 7` (`src/Stemma.Cli/WorkspaceCheck.cs:28`) applies to every view.
The rule was written for figures, when figures were the only agent workload.

## 6. Fix

- **Approach:** the threshold follows the register `view/mixed-register` already computes. A view that
  is mostly `Concept`s is a figure: past 7, a warning, as now. Any other view is architecture: past
  **30**, an *info* — the point where a C4 diagram has usually stopped being one diagram, said as
  information rather than as a fault.
- **Affected files:** `src/Stemma.Cli/WorkspaceCheck.cs`, `.doc/protocol/authoring-a-diagram.md` §7.
- **Implementation notes:** "mostly `Concept`" is the test `model/is-a-figure` already makes — more
  than half the view's members. The count is of the members the view resolves to (from F-023 on, its
  lens and rules as well as its list).
- [x] Fix implemented
- [x] Inviolable rules respected
- [x] No new data store / boundary intact

## 7. Regression test (required)

- [x] A test that **fails before** the fix and **passes after**
- **Test location:** `tests/Stemma.Cli.Tests/WorkspaceCheckTests.cs` — `A_crowded_figure_is_a_warning_rather_than_an_error`,
  `An_architecture_view_of_ordinary_size_is_not_busy`, `An_architecture_view_past_thirty_is_noted_rather_than_warned_about`
- **What it asserts:** 17 containers produce no `view/busy`; 31 produce an info; 8 Concepts still
  produce a warning.

## 8. Verification

- [x] `dotnet test` green
