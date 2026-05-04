# Contributing

This repository currently holds specifications and planning documents only. There is no production code yet. The contribution model below applies as soon as Phase 1 begins.

## Working principles

- **Round-trip fidelity is sacred.** Any change that risks fidelity needs a test before a merge.
- **Code is the database.** Resist any feature that introduces a parallel, non-Git source of truth.
- **Operations are pure.** Treat every UI gesture as a function. No hidden side effects.
- **Stay narrow.** Verso is not an IDE. If a feature feels like one, push back.

## How to propose a change

1. **Specs and ADRs**: open a PR that updates `docs/` or `specs/`. Discuss before implementing.
2. **New operations**: add a section to `specs/operations-catalog.md` *first*, with at least three round-trip fixtures listed. Implement after the spec is merged.
3. **Architectural decisions**: write a new ADR in `docs/decisions/`, status `Proposed`, and request review.

## Spec edits

Specs are not aspirational. If a spec disagrees with the code, fix one of them in the same PR. Stale specs are worse than no specs.

## Round-trip tests

For every operation, every fixture must pass:

```
1. load fixture input
2. apply operation
3. assert: textual diff between input and output equals the fixture's expected diff
```

A failing fidelity test blocks merge. There are no exceptions.

## Naming

Use the terms in `docs/GLOSSARY.md`. Do not invent synonyms (no "diagram", no "schema" as substitutes for "model graph"; no "save event" as a substitute for "delta").

## Commit messages

Conventional Commits. Subject ≤ 50 chars. Body only when "why" is non-obvious.

```
feat(engine): add RemoveProperty op
fix(sync): close gap when delta version skips
docs(adr): mark ADR-0003 accepted
```

## Reviews

- Two approvals for any change to `specs/round-trip-fidelity.md`.
- One approval for everything else.
- A maintainer must sign off on any new ADR going to `Accepted`.
