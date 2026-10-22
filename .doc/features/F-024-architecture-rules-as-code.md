# Feature: Architecture rules as code

| Field | Value |
|---|---|
| **ID** | F-024 |
| **Status** | In progress |
| **Owner** | Bartosz |
| **Persona served** | The Architect's Agent ("Theo"); Solution Architect ("Aria") |
| **Roadmap horizon** | Next |
| **Created / Updated** | 2026-10-22 / 2026-10-22 |

## 1. Product — why

- **Problem:** the architect's real constraints — *only the Payment Service talks to Stripe; the apps go
  through the gateway; no database has two writers* — live in their head or a wiki page. Stemma checks
  ids and cycles, nothing else (A11). An agent that proposes a change has nothing to check it against,
  and a reviewer has to remember every rule while reading the diagram.
- **Why now:** agents produce designs faster than people can review them; the review has to be partly
  mechanical, and the mechanism has to be something the architect can read.
- **Value:** *validation of the design, not of the syntax* — fitness functions (ArchUnit, NetArchTest,
  jQAssistant) for the architecture model itself, written next to it, shown on the canvas where the
  violation is.
- **Out of scope:** rules over code (that is [F-025](./F-025-conformance-with-the-implementation.md));
  editing rules from the canvas; arbitrary C# predicates (rules are read, not executed).

## 2. User story & acceptance criteria

> As **an architect**, I want to **write down what must hold, next to the model**, so that **the agent's
> proposals are checked against it and I see a violation where it happens**.

- [ ] **AC1 — Rules in the workspace.** Any `.cs` file in a `Rules/` folder may hold rules:
  `Rule.Forbid`, `Rule.Only`, `Rule.Layers`, `Rule.Require`, `Rule.Use`, collected by `RuleSet.Of(...)`.
  They are read off the syntax tree, like views; a workspace with no project file needs no compiler.
- [ ] **AC2 — What each says** ([ADR-0028](../architecture/decisions/0028-architecture-rules-as-code.md)):
  - `Forbid(id, from, to, because?, via?, severity?)` — no relationship from anything `from` selects to
    anything `to` selects.
  - `Only(id, from, to, ...)` — only what `from` selects may have a relationship to what `to` selects.
  - `Layers(id, layers, because?, via?, severity?)` — each element belongs to the first layer selector
    that matches it; a relationship from a lower layer to a higher one is a violation.
  - `Require(id, of, has, because?, severity?)` — everything `of` selects has a non-empty `has`
    (an attribute, `status`, `squad`…); `of` may select links (`link:dataFlow`).
  - `Use("c4")` — turns on the built-in C4 pack (AC6).
  `via` narrows the relationships considered (`dataFlow`, `dependency`, or both — the default).
  `Relation`s, which claim nothing, are never checked.
- [ ] **AC3 — Shown where it happens.** A violation marks the elements and links involved on the canvas,
  through the existing violations surface, with the rule's id and its `because`.
- [ ] **AC4 — Reported by `validate`.** As `rule/<id>` findings, with the severity the rule gives (or
  `stemma.rules.json` overrides). `validate` also runs the built-in rules (B-026).
- [ ] **AC5 — Mistakes in rules are reported.** `rule/bad-selector` (with the position), `rule/dangling-id`
  (an id a selector names that does not exist), `rule/duplicate-id`, `rule/unreadable` (an argument
  written as something other than a literal), `rule/unknown` (`Rule.Something`).
- [ ] **AC6 — The C4 pack.** `container-technology` (warning: a container without a technology),
  `described` (info: a person, system or container without a description), `flow-technology` (info),
  `flow-labelled` (warning: a data flow with an empty payload). In `validate` only, `view/mixed-levels`
  (info: a view drawing containers and modules together).
- [ ] **AC7 — Live.** Editing a rules file outside Stemma updates the violations on the canvas.

## 3. Architecture impact

- [x] **Model or presentation?** Model: rules are C#, in the workspace, beside the model they constrain.
- [x] **New/changed operations:** none — the engine reads rules and never writes them.
- [x] **Fidelity:** untouched.
- [x] **Engine purity:** a reader and an evaluator over the model; no execution of workspace code.
- [x] **Sidecar:** none. `stemma.rules.json` keeps its job (severity overrides, switching a rule off).
- [x] **ADR needed?** [ADR-0028](../architecture/decisions/0028-architecture-rules-as-code.md).
- **Affected files/areas:** `src/Stemma.Model/Rules.cs` (new: `Rule`, `RuleSet`, `ArchitectureRule`);
  `src/Stemma.Engine/Validation/DeclaredRules.cs` (reader), `DeclaredRuleEvaluator.cs`, `C4Pack.cs`,
  `RuleEngine.cs`; `StemmaEngine.RunValidationAsync` and the watcher; `src/Stemma.Cli/WorkspaceCheck.cs`,
  `WorkspaceRules.cs`; client `ViolationsPanel.tsx` (shows `because`).

## 4. UX impact

- [x] **Journey(s) touched:** reading violations on the canvas.
- [x] **States defined:** a rules file that cannot be read is a violation of its own (`rule/unreadable`),
  never silence.
- [x] **Interactions:** none new; the violations panel lists the rule and why.
- [x] **Accessibility:** unchanged.

## 5. UI impact

- [x] **Components touched/added:** violations panel row shows the rule's `because` under its message.
- [x] **Tokens:** existing.
- [x] **Both themes:** checked.

## 6. Technical prerequisites & dependencies

- [x] The selector language of [ADR-0026](../architecture/decisions/0026-views-by-rule.md) (F-023).
- [x] F-025 adds `Code.At` / `Code.Map` to the same files.

## 7. Test plan

- [ ] Reader tests — every rule form, named and positional, arrays as `new[] {…}` and `[…]`; unreadable
  arguments; files outside `Rules/` ignored.
- [ ] Evaluator tests — each rule on a model built to violate it and one built not to; `via`; severity;
  `Relation`s ignored; the C4 pack.
- [ ] `WorkspaceCheckTests` — `rule/<id>` findings and the rule-mistake findings.
- [ ] Engine test — a rules file changed outside updates `RunValidationAsync`.
- [ ] The C4 sample carries rules, one of them violated on purpose in a test copy.

## 8. Definition of Done

- [ ] All ACs met and demoed
- [ ] `dotnet test` green · `tsc` clean · `vite build` clean · `vitest` green
- [ ] Model/presentation boundary respected; no new data store
- [ ] Docs: `domain-model.md`, protocol (a section on rules), engine-backend
- [ ] Reviewed against all four pillars
