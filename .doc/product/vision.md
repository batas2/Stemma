# Product Vision

## The problem

Architecture diagrams rot. They are drawn in standalone tools (draw.io, Lucidchart, Enterprise
Architect, Visio), saved as static artifacts, and immediately begin drifting from the code they
describe. A diagram drawn at sprint planning is wrong by the next deploy. Teams either accept the
drift or pour disproportionate effort into keeping diagrams in sync — usually the former.

Reverse-engineering tools (NDepend, Structure101, Roslyn class-diagram generators) read the code,
but they are **read-only**. An architect cannot *redesign* in the diagram and have the code follow.

## The thesis: code is the database

Stemma eliminates the gap between the architecture artifact and the source by treating **the code on
disk as the model database**. There is no separate file format, no export step, no synchronization
job. The `.cs` files (and a small committed presentation sidecar) *are* the model; the UI is a live
projection of them.

- Drag a new element onto the canvas → a real edit appears in `Architecture.cs`.
- Rename a concept in the UI → a Roslyn rewrite updates the source, preserving every comment and blank line.
- Open a pull request that changes the architecture → reviewers see the diff in both the code and the canvas.

The promise that makes this trustworthy is **round-trip fidelity**: a UI edit produces a `git diff`
containing *only* the intended structural change — no reordering, no whitespace churn, no comment
loss. That contract is the spine of the whole product.

## Who it's for

Stemma serves **solution and data architects** first — the people who work at the level of abstract
domain models that must evolve over years, span products, and live across organizations. Everyone
else is served through **views projected from the architects' canonical model**.

See [`users-and-personas.md`](./users-and-personas.md) for the full audience breakdown.

## What makes a Stemma model special

- **Long-lived.** A model is meant to outlive any one repository, product, or org chart. It is
  started for a program, evolved as concepts split/merge/rename/retire, forked and re-merged with
  standard Git, and versioned via tags and branches so any past state is recoverable and any
  decision is auditable.
- **Broader than code.** The canonical model is language-agnostic and intentionally richer than a
  class diagram: bounded contexts, capabilities, data flows, dependencies, decisions, risks,
  questions, assumptions, ownership and lifecycle are **first-class**, not annotations.
- **Git-native.** Persistence is the source files in Git. There is no runtime database — while you
  work, the model lives in memory; on save it is the files on disk.

## Non-goals

- **Not a browser IDE.** Method bodies, control flow, and inline logic are out of scope.
- **Not a runtime observability tool.** Stemma models *structure*, not behavior.
- **Not a parallel data store.** There is no SQLite/Postgres/embedded DB. If a feature seems to need
  one, the feature is wrong. (Presentation-only state lives in the committed sidecar — see
  [`../architecture/data-flow-and-sync.md`](../architecture/data-flow-and-sync.md).)

## Success criteria

1. **Fidelity:** editing via the UI yields a diff with only the intended change. (If this breaks,
   trust is lost and is not recoverable.)
2. **Adoption:** a team uses Stemma for a real architecture review and chooses to keep using it.
3. **Drift becomes meaningless:** "is this diagram current?" stops being a question, because the
   diagram *is* the code.
