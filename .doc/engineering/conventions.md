# Engineering Conventions

The rules every contributor follows. The first set is **inviolable** — violating it
breaks the product's core promise.

## Inviolable rules (do not break, ever)

1. **Never call `SyntaxNode.NormalizeWhitespace()`.** It destroys trivia and the fidelity contract.
2. **Never reconstruct a source file via string concatenation.** Use `DocumentEditor` /
   `SyntaxNode.WithX(...)` exclusively.
3. **Never invent a parallel data store.** Model → code; presentation → `verso.layout.json`. If a
   feature seems to need a third store, the feature is wrong.
4. **Never edit method bodies in v1.** Out of scope.
5. **Never edit `*.g.cs` or generator-output files.** Refuse the operation.
6. **Engine purity.** `Verso.Engine` depends only on Roslyn + `Verso.Model`. LLM/web concerns stay in
   `Verso.Web`.

Background and the full fidelity rationale: [`../architecture/engine-backend.md`](../architecture/engine-backend.md).

## Implementing an operation (procedure)

1. Confirm it's in the operations catalog; if not, write the spec first.
2. Ensure ≥3 round-trip fixtures exist (minimal / realistic / pathological); if not, add them first.
3. Implement in the engine with `DocumentEditor`.
4. Run the fidelity suite. **If it fails, fix the implementation, not the test.**

## Code style

- **Read like the neighbours.** Match the surrounding file's comment density, naming, and idiom.
- **Backend (C#):** records for model vocabulary; small, pure transforms in the engine; xUnit +
  FluentAssertions for tests.
- **Frontend (TS/React):** functional components; `zustand` store with **stable selectors**; Tailwind
  utilities and the shared tokens; comments explain *why*, not *what*.
- **No dead code / no speculative abstractions.** Build for the case in front of you.
- **Reference code as `path:line`** in discussions and reviews.

## Frontend store discipline (load-bearing)

- Prime the presentation sidecar **once** per workspace; never re-fetch mid-session.
- Preserve React Flow `selected` across node rebuilds; never rebuild node objects mid-drag.
- Keep model edits (operations) and presentation edits (sidecar) on their own paths.

## When you change behavior, update the docs

A change that alters a journey, a state, a token, a component contract, or a decision updates the
relevant `.doc/` file in the **same PR**. Stale docs are a defect. The
Docs Librarian enforces this.

## Definition of Done (every change)

- [ ] Behaves correctly across all relevant states (see [`../ux/states-and-interactions.md`](../ux/states-and-interactions.md)).
- [ ] Backend: round-trip fidelity suite green; new operations have ≥3 fixtures.
- [ ] Frontend: `tsc` clean, `vite build` clean, `vitest` green.
- [ ] No new data store; model/presentation boundary respected.
- [ ] Tokens used (no hard-coded colours/z-index); matches surrounding idiom.
- [ ] Docs updated where behavior changed.
