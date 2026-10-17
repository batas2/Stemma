# Testing

Tests are how Stemma keeps its central promise. The fidelity suite is not optional polish — it is the
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

### Where it lives, and the rule it enforces

`tests/Stemma.Engine.Tests/Fidelity/`, against `Fixtures/arch/` (an `Architecture.cs` written three
ways) and `Fixtures/types/` (an ordering domain written three ways). The three fixtures in each
describe the *same* model, so the same operations run against all of them and only the expected
text differs. The pathological ones carry a BOM, tabs, CRLF and LF in one file, `#region` / `#if`,
block comments inside argument lists, named arguments and declarations split over lines; they are
`-text` in `.gitattributes`, because normalising them would delete the case and leave the suite
passing.

A case is an operation and the **edits it is allowed to make**, written out by hand as
`(from, to)` pairs. The test applies the operation and compares the **whole file** — every byte,
BOM included — with the fixture after exactly those edits. It then undoes and compares with the
original, and redoes and compares with the edit. Never assert a fragment with `Contains`: a check for
the new literal passes while the comment two lines up disappears, and that is how
[B-009](../bugs/B-009-edits-rebuild-the-declaration.md) went unnoticed through every existing test.

To add an operation: add its row to the [catalog](../architecture/engine-backend.md#the-operations-catalog),
then one case per fixture in `FidelityCases.cs` (or `TypeFidelityCases.cs`), then implement until
they pass. Refusals and edge cases the fixtures do not reach go in `DslWriterContractTests.cs`.

## Commands

```bash
# Backend
dotnet test                                   # full suite incl. fidelity

# Frontend (from src/Stemma.Web.Client)
npx tsc --noEmit -p tsconfig.json             # typecheck (must be clean)
npx vite build                                # build (must succeed)
npx vitest run                                # unit/integration (must be green)
npx vitest run src/lib/autoLayout.test.ts     # a single file
```

## What to test (by area)

- **New operation** → a case per fixture in the fidelity suite + a test for each refusal it can return.
- **Anything that writes a file** → what happens when the file changed on disk since it was read
  (`OutsideEditTests`), and that undo puts back every byte (`UndoTests`).
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
