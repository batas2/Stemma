# Bug: `validate` does not run the rules the canvas shows

| Field | Value |
|---|---|
| **ID** | B-026 |
| **Status** | In progress |
| **Severity** | S2 major |
| **Area** | `cli` |
| **Reported by / Date** | Audit ([`agent-architecture-workflow.md`](../product/agent-architecture-workflow.md) §1, A10) / 2026-10-22 |
| **Affected version / commit** | `7264f79` |

## 1. Summary

The canvas marks violations from the engine's `RuleEngine` — a data-flow cycle, a module naming a
context that does not exist, a link to a missing element. `stemma validate`, which is the agent's only
view of the same model, never runs it. An agent can produce a model that is red in the app and clean
on the command line.

## 2. Steps to reproduce

1. Three data flows a → b → c → a.
2. Open the workspace: the three cards are marked. `stemma validate` → *nothing to report*.

- **Expected:** the cycle reported by both.
- **Actual:** reported by the canvas only.

## 3. Triage

- [x] **Severity & priority agreed** — S2: two verdicts on one model.
- [x] **Reproduced.**
- [x] **Pillar(s) affected:** Product, Architecture.

## 4. UX / UI impact

- [x] **User-visible symptom:** a reviewer sees problems the agent was told were not there.

## 5. Root cause

`WorkspaceCheck.Run` (`src/Stemma.Cli/WorkspaceCheck.cs:30`) assembles its own checks and does not call
`RuleEngine.Default(root).Run(model)`, which `StemmaEngine.RunValidationAsync` does for the canvas.

## 6. Fix

- **Approach:** `validate` runs the same `RuleEngine` with the same `stemma.rules.json`, and reports each
  violation as `rule/<rule-id>` at the severity the rules file gives it. Where an engine rule and a
  `validate` check say the same thing (`link-endpoints-exist` and `link/dangling-endpoint`), the engine
  rule is not reported twice. From F-024 on, the same call carries the workspace's own rules.
- **Affected files:** `src/Stemma.Cli/WorkspaceCheck.cs`.
- [ ] Fix implemented
- [x] Inviolable rules respected
- [x] No new data store / boundary intact

## 7. Regression test (required)

- [ ] A test that **fails before** the fix and **passes after**
- **Test location:** `tests/Stemma.Cli.Tests/WorkspaceCheckTests.cs`
- **What it asserts:** a three-flow cycle produces `rule/no-circular-dataflows`; disabling it in
  `stemma.rules.json` removes it; a dangling endpoint is reported once.

## 8. Verification

- [ ] `dotnet test` green
