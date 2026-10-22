# Feature: Architecture rules as code

| Field | Value |
|---|---|
| **ID** | F-024 |
| **Status** | Shipped |
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

- [x] **AC1 — Rules in the workspace.** Any `.cs` file in a `Rules/` folder may hold rules:
  `Rule.Forbid`, `Rule.Only`, `Rule.Layers`, `Rule.Require`, `Rule.Use`, collected by `RuleSet.Of(...)`.
  They are read off the syntax tree, like views; a workspace with no project file needs no compiler.
- [x] **AC2 — What each says** ([ADR-0028](../architecture/decisions/0028-architecture-rules-as-code.md)):
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
- [x] **AC3 — Shown where it happens.** A violation marks the elements and links involved on the canvas,
  through the existing violations surface, with the rule's id and its `because`.
- [x] **AC4 — Reported by `validate`.** As `rule/<id>` findings, with the severity the rule gives (or
  `stemma.rules.json` overrides). `validate` also runs the built-in rules (B-026).
- [x] **AC5 — Mistakes in rules are reported.** `rule/bad-selector` (with the position), `rule/dangling-id`
  (an id a selector names that does not exist), `rule/duplicate-id`, `rule/unreadable` (an argument
  written as something other than a literal), `rule/unknown` (`Rule.Something`).
- [x] **AC6 — The C4 pack.** `container-technology` (warning: a container without a technology),
  `described` (info: a person, system or container without a description), `flow-technology` (info),
  `flow-labelled` (warning: a data flow with an empty payload). In `validate` only, `view/mixed-levels`
  (info: a view drawing containers and modules together).
- [x] **AC7 — Live.** Editing a rules file outside Stemma updates the violations on the canvas.

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

- [x] Reader tests — every rule form, named and positional, arrays as `new[] {…}` and `[…]`; unreadable
  arguments; files outside `Rules/` ignored.
- [x] Evaluator tests — each rule on a model built to violate it and one built not to; `via`; severity;
  `Relation`s ignored; the C4 pack.
- [x] `WorkspaceCheckTests` — `rule/<id>` findings and the rule-mistake findings.
- [x] Engine test — a rules file changed outside updates `RunValidationAsync`.
- [x] The C4 sample carries rules, one of them violated on purpose in a test copy.

## 8. Definition of Done

- [x] All ACs met and demoed
- [x] `dotnet test` green · `tsc` clean · `vite build` clean · `vitest` green — `dotnet test` green; the
  client is untouched by this change
- [x] Model/presentation boundary respected; no new data store
- [x] Docs: `domain-model.md`, protocol (a section on rules), engine-backend
- [x] Reviewed against all four pillars

## 9. Implementation notes

Where the record left a call open, this is the call made.

- **Where the code is.** `src/Stemma.Model/Rules.cs` (`Rule`, `RuleSet`, `ArchitectureRule`,
  `ArchitectureRuleKind`; `Code`, `CodeRoot`, `CodeMap` for F-025); `src/Stemma.Engine/Validation/`
  `DeclaredRules.cs` (reader), `DeclaredRuleEvaluator.cs`, `C4Pack.cs`, `WorkspaceRules.cs` (how they join the
  `RuleEngine`); the link selectors in `ArchModel/Selectors.cs`; `src/Stemma.Cli/WorkspaceCheck.cs`. No
  `WorkspaceRules.cs` in the CLI: the engine's `RuleEngine.Default(root)` already reads the rules, and the
  CLI and the canvas both run it.
- **The API.** Parameter names are lowercase, as written in AC2 and the samples. `ArchitectureRule` is one
  record for all kinds (a `Kind` and nullable fields); `Rule.Use` returns one too, its `Id` the pack's name.
  `RuleSet.Of` throws on an item that is neither a rule nor a `Code` item — stricter than `Model.Of`, since
  only an engineer's own test ever runs it and silence there helps no one. The reader's table of
  parameters is held to the model's by reflection (`DeclaredRulesReaderTests`).
- **Read from disk, not from the workspace.** Rules are read from the files on every ask, each parsed
  again only when its time or length changes. So AC7 holds with no watcher, and a rules file a project
  leaves out of its build still counts. The canvas's 1.5 s poll costs a walk of the workspace's `.cs`
  files, as the watcher's own poll does.
- **A relationship** is a `DataFlow` or a `Dependency` between two elements, from `FromId` to `ToId` as
  declared; a `twoway` flow is not reversed. Links with an end that is not an element are left to
  `link-endpoints-exist`.
- **`Only` is strict:** a relationship into `to` from anything `from` does not select is a violation, even
  from inside `to`.
- **`Layers`:** the first layer is the top; each element is in the first layer selecting it; an element no
  layer selects is not checked; sideways is allowed.
- **`Require` over links:** `link:dataFlow` and `link:dependency`, with filters over `payload`, `technology`,
  `direction`, `kind` (with their defaults), `label` (a flow's payload, a dependency's kind), `id`, and the
  link's tags. `link:relation` is refused as a bad selector. The `link:` form is parsed only for `of`;
  elsewhere — and in every view — `link:x` is still an id, so no view reads differently. A `has` no element
  (or link) can have is `rule/unknown`, since such a rule would fail everything.
- **Violations** carry the two elements and the link for a relationship rule, the element for `Require` on
  elements, and the link and its ends for `Require` on links. The message names them by id and ends with
  ` — <because>`; the panel shows it as it is.
- **Mistakes are rules too:** `rule/bad-selector`, `rule/dangling-id`, `rule/duplicate-id`,
  `rule/unreadable`, `rule/unknown` are engine rules with those ids, all errors, so `stemma.rules.json` can
  quieten one. `rule/unreadable` also covers a required argument missing or `null`, an empty id, and a
  rule built with `new ArchitectureRule(…)`; an unreadable `because` is a warning and keeps the rule.
  `rule/unknown` also covers an unknown pack, `via`, `severity`, `has` or parameter name. A rule with a
  mistake is not evaluated — except a duplicate id, where both are, and a dangling id, which only empties
  that selector. A declared id equal to a built-in rule's, a pack's, a mistake's or conformance's is a
  duplicate; so is a second `Code.At` (the first is used). Arguments of `RuleSet.Of` that are not
  `Rule`/`Code` calls are not policed — a helper in another rules file may hold them — but a rule
  constructed directly is reported.
- **The C4 pack:** `c4/flow-technology` does not ask a flow from or to a person for a technology — using an
  app goes over no protocol, and C4's own examples leave it off. `view/mixed-levels` counts the members as
  the canvas draws them (the dependency lens keeps only modules, contexts and capabilities).
- **Names in `validate`:** a declared rule is `rule/<id>`, the pack's `rule/c4/<name>`, a mistake keeps its
  own `rule/<mistake>` (never `rule/rule/…`), and conformance keeps `conformance/<finding>`.
- **Samples.** Dishwise's `rule_layers` failed: the model had the event bus pushing up to the services
  that consume from it. The model was fixed, not the rule — the consumers now point at the bus
  (`flow_dispatch_bus`, `flow_notify_bus`, *consumes …*), as a service points at its database.
- **The violations panel (2026-10-22).** No separate *because* row was needed: a violation is said by name
  and by reason — *Customer App → Orders DB (flow_app_db) is not allowed — Every client call is authenticated
  at the gateway* — and the panel shows the message as it is. The selectors are said only for a rule with no
  `because`. A bare declared id that would print as a mistake (`dangling-id`) is reserved (review).
