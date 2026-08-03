# Contributing

The full contribution guide lives in
[`.doc/engineering/contributing.md`](./.doc/engineering/contributing.md). This is the short version.

## Licensing of contributions

Stemma is source-available under the [PolyForm Noncommercial License 1.0.0](./LICENSE), and
commercial licences are sold separately by the copyright holder. By opening a pull request you agree
that your contribution is licensed to the project under those same terms, and that the copyright
holder may include it in commercially licensed builds. If that does not work for you, open an issue
instead — a described problem is a contribution too.

## Working principles (non-negotiable)

- **Round-trip fidelity is sacred.** Any change that risks it needs a test before merge. A failing
  fidelity test blocks merge — no exceptions.
- **Code is the database.** Resist any feature that introduces a parallel, non-Git source of truth.
  Model → code; presentation → `stemma.layout.json`; never a third store.
- **Operations are pure.** Treat every UI gesture as a function; no hidden side effects.
- **Stay narrow.** Stemma is not an IDE. If a feature feels like one, push back.

Full rules: [`.doc/engineering/conventions.md`](./.doc/engineering/conventions.md).

## How to propose a change

1. **Feature** → create a record from
   [`.doc/templates/feature-template.md`](./.doc/templates/feature-template.md) in
   [`.doc/features/`](./.doc/features/) (name a persona, value, ACs, and Product/Architecture/UX/UI
   impact).
2. **Bug** → [`.doc/templates/bug-template.md`](./.doc/templates/bug-template.md) in
   [`.doc/bugs/`](./.doc/bugs/) (root cause + a named regression test).
3. **New operation** → spec it, add ≥3 round-trip fixtures (minimal/realistic/pathological),
   implement with `DocumentEditor`, run the fidelity suite.
4. **Boundary decision** → an ADR via
   [`.doc/templates/adr-template.md`](./.doc/templates/adr-template.md) in
   [`.doc/architecture/decisions/`](./.doc/architecture/decisions/), status `Proposed`.

## Definition of Done

See the checklist in
[`.doc/engineering/contributing.md`](./.doc/engineering/contributing.md#the-change-checklist-definition-of-done):
states handled · `dotnet test` green · `tsc`/`vite build`/`vitest` green · boundary respected · tokens
used · **docs updated in the same PR** · a regression test for every bug fix.

## Vocabulary, commits, reviews

- Use the terms in [`.doc/engineering/glossary.md`](./.doc/engineering/glossary.md). Don't invent
  synonyms.
- **Commits:** Conventional Commits; subject ≤ 50 chars; body only when the "why" is non-obvious.
  ```
  feat(engine): add RemoveProperty op
  fix(canvas): preserve selection across node rebuild
  docs(adr): mark ADR-0003 accepted
  ```
- **Reviews:** changes to the fidelity contract get extra scrutiny; a maintainer signs off any ADR
  going to `Accepted`. Reviews check all four pillars — adopt the relevant
  pillar lens.
