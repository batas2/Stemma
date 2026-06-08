# Testing

Tests are how Verso keeps its central promise. The fidelity suite is not optional polish — it is the
product's load-bearing wall.

## The pyramid

| Level | Backend | Frontend |
|---|---|---|
| **Unit** | Operation handlers, DSL read/write, sidecar, model transforms — xUnit + FluentAssertions | Pure logic: `autoLayout`, `markdownDom`, `edgeDock`, `layout` sidecar, store reducers — vitest |
| **Integration** | Round-trip fidelity against real source files; workspace load/apply/snapshot | Component/dom behavior where it carries logic (happy-dom) |
| **End-to-end** | Full edit → rewrite → delta flows | Manual + sample-workspace smoke (see `samples/`) |

The base of the pyramid is wide and fast; meaningful assertions only — no trivial "it renders" tests.

## The fidelity suite (the core gate)

Every operation has **three** round-trip fixtures:

- **Minimal** — the smallest file that exercises the operation.
- **Realistic** — a production-shaped file with comments, attributes, regions, blank lines.
- **Pathological** — adversarial trivia (mixed line endings, dense comments, `#if` blocks).

For each: apply the operation, then assert the diff contains **only** the intended change. A failing
fidelity test means the **implementation** is wrong — fix the code, never the test.

## Commands

```bash
# Backend
dotnet test                                   # full suite incl. fidelity

# Frontend (from src/Verso.Web.Client)
npx tsc --noEmit -p tsconfig.json             # typecheck (must be clean)
npx vite build                                # build (must succeed)
npx vitest run                                # unit/integration (must be green)
npx vitest run src/lib/autoLayout.test.ts     # a single file
```

## What to test (by area)

- **New operation** → its three fidelity fixtures + a unit test for the success/failure contract.
- **Auto-layout change** → a property the layout must hold (e.g. an `aboutId` annotation stays near
  its target; connected nodes end closer than disconnected; no overlaps).
- **Markdown bridge change** → a round-trip test (`md → DOM → md` is stable) for the new element.
- **Sidecar change** → that edits survive a re-prime (no clobber) and the model/presentation split
  holds.
- **Bug fix** → a regression test that fails before the fix and passes after (link it from the bug
  record in [`../bugs/`](../bugs/)).

## Per-change requirement

A change is not done until its tests are green and it added the tests its category requires (see the
Definition of Done in [`conventions.md`](./conventions.md)). The
QA / Test Engineer owns coverage and triage.
