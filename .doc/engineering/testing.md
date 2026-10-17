# Testing

Tests are how Stemma keeps its central promise. The fidelity suite is not optional polish — it is the
product's load-bearing wall.

## The pyramid

| Level | Backend | Frontend |
|---|---|---|
| **Unit** | Operation handlers, DSL read/write, sidecar, model transforms — xUnit + FluentAssertions | Pure logic: `autoLayout`, `markdownDom`, `edgeDock`, `layout` sidecar, store reducers — vitest |
| **Integration** | Round-trip fidelity against real source files; workspace load/apply/snapshot | Component/dom behavior where it carries logic (happy-dom) |
| **End-to-end** | Full edit → rewrite → delta flows | Journeys in `tests/journey/` (Playwright, the production server, installed Chrome) |

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

### And driven through the app

The suite proves what an operation writes. It cannot see the path to it: the inspector that sends
it, the browser's copy of the workspace, the watcher, two reads racing on open. Each of those broke
the contract while the suite was green:
- opening a workspace wrote its sidecar ([B-012](../bugs/B-012-the-browser-outranks-the-repository.md));
- a view pulled in mid-session was saved into a second file
  ([B-015](../bugs/B-015-outside-changes-to-the-set-of-files-are-missed.md)).

`tests/journey/fidelity.spec.ts` drives the same checks through the UI, on a scratch copy of
`samples/StemmaArchitecture`:
- opening writes nothing;
- an inspector edit changes its own argument, and undo puts every byte back;
- an outside edit is shown and not written back;
- a pulled view is edited where it is;
- moving a box adds its lines to the sidecar and changes none;
- a sidecar note changed outside survives the next drag.

Journeys run one at a time (`workers: 1`), because the backend holds one workspace per process.

## Commands

```bash
# Backend
dotnet test                                   # full suite incl. fidelity

# Frontend (from src/Stemma.Web.Client)
npx tsc --noEmit -p tsconfig.json             # typecheck (must be clean)
npx vite build                                # build (must succeed)
npx vitest run                                # unit/integration (must be green)
npx vitest run src/lib/autoLayout.test.ts     # a single file
npm run test:journey                          # journeys: builds, starts the server, drives Chrome
STEMMA_BASE_URL=http://127.0.0.1:5050 npm run test:journey   # against a server already running
```

## What to test (by area)

- **New operation** → a case per fixture in the fidelity suite + a test for each refusal it can return.
- **Anything that writes a file** → what happens when the file changed on disk since it was read
  (`OutsideEditTests`), and that undo puts back every byte (`UndoTests`).
- **Auto-layout change** → a property the layout must hold (e.g. an `aboutId` annotation stays near
  its target; connected nodes end closer than disconnected; no overlaps).
- **Markdown bridge change** → a round-trip test (`md → DOM → md` is stable) for the new element.
- **Sidecar change** → that edits survive a re-prime (no clobber) and the model/presentation split
  holds; that nothing is written before the sidecar has been read; and that an entry the sidecar no
  longer has is not brought back from `localStorage` (`browserCache.test.ts`). A change to how the
  file is *written* is a `SidecarPatchTests` case: the whole file against hand-written edits, on a
  Stemma-written fixture and a hand-formatted one.
- **Bug fix** → a regression test that fails before the fix and passes after (link it from the bug
  record in [`../bugs/`](../bugs/)).

## Per-change requirement

A change is not done until its tests are green and it added the tests its category requires (see the
Definition of Done in [`conventions.md`](./conventions.md)). The
QA / Test Engineer owns coverage and triage.
