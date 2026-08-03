# Contributing

How work flows into Stemma. The short version lives in the repository root
[`CONTRIBUTING.md`](../../CONTRIBUTING.md).

## Before you start

1. Read [`../architecture/overview.md`](../architecture/overview.md) and
   [`conventions.md`](./conventions.md) — especially the **inviolable rules**.
2. For anything non-trivial, create a record first:
   - A feature → [`../templates/feature-template.md`](../templates/feature-template.md) in
     [`../features/`](../features/).
   - A bug → [`../templates/bug-template.md`](../templates/bug-template.md) in [`../bugs/`](../bugs/).
   - A boundary decision → [`../templates/adr-template.md`](../templates/adr-template.md) in
     [`../architecture/decisions/`](../architecture/decisions/).

## Branching & commits

- Branch off `main` (or the team's working branch); never commit straight to the default branch.
- Small, focused commits with clear messages; reference `path:line` and the feature/bug id.
- Open a PR — the architecture change should read cleanly in *both* the code diff and the canvas.
- Commit/push only when asked; keep the working tree green.

## The change checklist (Definition of Done)

- [ ] States handled (empty/loading/error/optimistic/conflict — [`../ux/states-and-interactions.md`](../ux/states-and-interactions.md)).
- [ ] Backend: `dotnet test` green; fidelity fixtures added for new operations.
- [ ] Frontend: `tsc` clean · `vite build` clean · `vitest` green.
- [ ] Model vs presentation boundary respected; no new data store.
- [ ] Tokens used; matches surrounding idiom.
- [ ] Docs updated in the **same PR** where behavior changed.
- [ ] A regression test accompanies every bug fix.

## Working with samples

Sample workspaces in [`../../samples/`](../../samples/) are living documentation and test fixtures.
When you add a feature, consider exercising it in a sample. When you generate a sample, **validate
that every string id resolves** (the C# compiler does not check flow/dep/view ids).

## Reviews

Reviews check all four pillars (Product / Architecture / UX / UI). The
lenses are the pillars themselves; a reviewer adopts the
relevant one. The fidelity suite and the model/presentation boundary are non-negotiable gates.

