# ADR-0028: Architecture rules are C# in `Rules/`, read off the syntax tree, never executed

| Field | Value |
|---|---|
| **Status** | `Proposed` |
| **Date** | 2026-10-22 |
| **Deciders** | Bartosz |

## Context

The architect's constraints — *only Payments talks to Stripe*, *the apps go through the gateway*,
*services never share a database* — are the part of an architecture a reviewer most needs checked and
the part Stemma cannot express ([`agent-architecture-workflow.md`](../../product/agent-architecture-workflow.md)
A11). The engine has a `RuleEngine` of built-in rules (id integrity, cycles) and `stemma.rules.json` to
switch them off or change their severity. ArchUnit and NetArchTest express such rules as code over a
model of the code; LikeC4 as tests over its model API. Stemma's model is code already.

Questions: where rules live, how they are written, and whether the engine runs them or reads them.

## Decision

1. **Rules are C# files in a `Rules/` folder of the workspace**, each a static class returning a
   `RuleSet` (`RuleSet.Of(Rule.Forbid(…), Rule.Only(…), …)`), compiling against `Stemma.Model` like the
   model and the views do.
2. **They are read off the syntax tree, never executed.** The reader finds `Rule.<Kind>(…)` invocations
   and reads their literal arguments by parameter name, as `DslReader` reads a declaration. A workspace
   with no project file needs no compiler; Stemma never runs workspace code.
3. **A small, closed vocabulary**: `Forbid`, `Only`, `Layers`, `Require`, `Use` — defined in
   [F-024](../../features/F-024-architecture-rules-as-code.md) AC2 — over the selector language of
   [ADR-0026](./0026-views-by-rule.md) (no neighbourhood forms). Each has an id and an optional
   `because`, which is shown wherever its violations are.
4. **Declared rules run through the `RuleEngine`**, beside the built-in ones, so the canvas and
   `validate` show the same violations, and `stemma.rules.json` overrides their severity the same way.
5. **Built-in packs are opt-in.** `Rule.Use("c4")` turns on the C4 checklist rules; a workspace that does
   not ask for them is not judged by them.
6. **A rule Stemma cannot read is a violation**, not silence (`rule/unreadable`, `rule/bad-selector`, …).

## Consequences

- **Positive:** the design is checked, not only the syntax; an agent's proposal can be validated against
  the architect's intent before a human reads it; the rule sits beside the model in the same review.
- **Negative / trade-offs:** a closed vocabulary will not express every rule; the escape is a new rule
  kind through this ADR's process, not a general predicate.
- **Neutral:** `stemma.rules.json` keeps its job; it gains no rules of its own.

## Alternatives considered

- **Rules in `stemma.rules.json`** — rules are claims about the system, so they belong with the model in
  code, not in a configuration file beside the presentation.
- **Compile and run C# predicates** — the most expressive, and it makes Stemma execute arbitrary
  workspace code on open, and makes rules unreadable without a compiler.
- **Rules as unit tests in the workspace's own test project** (the ArchUnit way) — possible today for a
  workspace with a project; invisible on the canvas, and absent from workspaces without one.

## Relationship to the inviolable rules

No new store: rules are model, in code. The engine reads and never writes them, so fidelity is
untouched. Purity holds: a syntax reader and an evaluator over the model.

## References

- [F-024](../../features/F-024-architecture-rules-as-code.md), [B-026](../../bugs/B-026-validate-does-not-run-the-engine-rules.md)
- `src/Stemma.Engine/Validation/RuleEngine.cs`
- [ArchUnitNET](https://github.com/TNG/ArchUnitNET), [LikeC4 — validate your model](https://likec4.dev/guides/validate-your-model/)
