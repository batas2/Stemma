# ADR-0027: People, systems and containers have a description; containers and data flows a technology

| Field | Value |
|---|---|
| **Status** | `Proposed` |
| **Date** | 2026-10-22 |
| **Deciders** | Bartosz |

## Context

A C4 element is a name, a type, a technology and a sentence: *Order Service — Container: .NET 8 —
accepts orders and tracks their state*. A C4 relationship is a description and a technology: *places
orders [HTTPS/JSON]*. Stemma's `Container` has a name and a free-text `Kind`; nothing has a description;
a `DataFlow` has a payload and a direction. Technology lives, when it lives anywhere, in a custom
property in the presentation sidecar (`customProps.tech`) — a fact about the system kept in the store
for how it looks. The C4 review checklist asks of every element its technology and description
([c4model.com/diagrams/checklist](https://c4model.com/diagrams/checklist)), and an agent writing C4
writes both by habit and has nowhere to put them.

[ADR-0018](./0018-concept-element-kind.md) declined an open vocabulary. This is not that: two named
fields on the kinds C4 defines them for.

## Decision

1. **New optional parameters, appended:**
   `Person(…, Role, Description = null)`, `SoftwareSystem(…, Description = null)`,
   `Container(…, Kind, Technology = null, Description = null)`,
   `DataFlow(…, Direction, Technology = null)`.
   Not on `Module`, `BoundedContext` or `Capability` — their prose is the element's notes — and not on
   `Concept` (ADR-0018 keeps it poor).
2. **They are model, read off the syntax tree like every argument** (`DslVocabulary`), and edited by the
   existing `SetElementAttribute` / `SetLinkAttribute` operations — a missing one appended as a named
   argument, as those operations already do.
3. **They are drawn.** The card's kind line carries the technology; its body, the description. A flow's
   label reads `payload [technology]`. The publication card adds the technology, small, under the name.
4. **`customProps.tech` is left alone.** It is the user's own property; the container's property
   suggestions stop offering `tech` now that the model has the field.

## Consequences

- **Positive:** C4 cards say what C4 cards say; the C4 rule pack (ADR-0028) can ask for them; an agent's
  habitual output has a home.
- **Negative / trade-offs:** more constructor arguments to read on a long declaration; a hand-written
  `customProps.tech` and a model `Technology` can disagree, and only the model's is drawn on the kind line.
- **Neutral:** every existing workspace compiles unchanged (all parameters optional and last).

## Alternatives considered

- **Keep technology in `customProps`** — a fact about the system in the presentation store, invisible to
  `validate`, rules and anything that reads the model.
- **A generic `Properties` dictionary on every element** — the open vocabulary ADR-0018 declined, through
  a side door.
- **`Description` on every kind** — the notes already carry prose for modules and contexts; a second
  place for the same sentence would drift from the first.

## Relationship to the inviolable rules

Model in code; edits through the existing operations with three fidelity fixtures each; no new store;
the engine reads the arguments with the reader it has.

## References

- [F-023](../../features/F-023-c4-views-and-views-by-rule.md)
- `src/Stemma.Model/Concepts.cs`, `src/Stemma.Engine/ArchModel/DslVocabulary.cs`
