# ADR-0026: A view is a scope and rules as well as a list, resolved in the engine

| Field | Value |
|---|---|
| **Status** | `Proposed` |
| **Date** | 2026-10-22 |
| **Deciders** | Bartosz |

## Context

A view is `View(Id, Name, BaseView, ElementIds)`: a lens and a list. For a seven-box figure the list is
the point. For an architecture view it is a liability — the audit's container view listed seventeen
ids, a missed one drops an arrow silently (`view/half-link`), and the list goes stale the day a container
is added ([`agent-architecture-workflow.md`](../../product/agent-architecture-workflow.md) A12). C4's
two most used diagrams — system context and container — are not lists at all: they are *a system, and
whatever it talks to*, with relationships to a container drawn to its system when the container is not
shown. Structurizr (`include *`) and LikeC4 (include/exclude predicates) state views this way.

Three questions: how a view states its rules, where they are resolved, and what is drawn for a
relationship whose end is not in the view.

## Decision

1. **`View` gains three optional arguments** — `Scope` (an element id), `Include` and `Exclude` (string
   arrays of selectors) — and `ElementIds` becomes optional. All are appended, so every existing view
   compiles unchanged. Members are the lens's, then `ElementIds`, then `Include`, minus `Exclude`.
2. **Two C4 lenses.** `BaseView: "systemContext"` and `BaseView: "container"`, each with a `Scope` naming a
   software system. Their members and their *implied* relationships are defined in
   [F-023](../../features/F-023-c4-views-and-views-by-rule.md) AC2–AC3.
3. **The selector language** — one language for views and, without the neighbourhood forms, for rules
   ([ADR-0028](./0028-architecture-rules-as-code.md)):

   ```
   selector   := neighbours | base
   neighbours := "->" base | base "->" | "->" base "->"
   base       := ( "*" | id | id ".*" | "kind:" kind ) filter*
   filter     := "[" attr ( "=" | "!=" ) value ( "|" value )* "]"
   ```

   `id.*` is the element's children (a system's containers; a context's modules and capabilities).
   `kind` and attribute names match case-insensitively; values compare case-insensitively. Attributes
   are the element's constructor arguments (`kind`, `role`, `technology`, `systemId`, …) plus `status`
   and `phase` (lifecycle) and `squad` and `domain` (ownership). `->X` adds what relates to X, `X->` what
   X relates to.
4. **Resolution happens in the engine** (`ViewProjection`), and its result — members, the provenance of
   each, the links drawn and the implied links — is what the API gives the canvas and what `validate`,
   `render` and `inspect` use. One rule, one implementation.
5. **An implied relationship is derived, never stored.** It has an id of its own shape
   (`__implied__<from>__<to>`), carries the ids of the relationships it stands for, and cannot be edited —
   like the `__about__` edges the canvas already draws.
6. **Editing a rule-based view keeps the rule.** The canvas adds to `ElementIds` and removes by adding to
   `Exclude`; `ViewsAdapter.Edit` edits each argument where it stands and appends a missing one as a named
   argument.

## Consequences

- **Positive:** C4 views in one line each; views that stay right as the model grows; one place where
  "what does this view draw" is answered.
- **Negative / trade-offs:** a view's members are no longer readable off its file at a glance — hence
  `stemma inspect`. The canvas waits for the server to resolve a view it edits (it already reloads views
  after a save).
- **Neutral:** `moduleMap`, `dependencyGraph` and `all` are unchanged; a view with only `ElementIds` behaves
  exactly as before.

## Alternatives considered

- **Resolve in the client** — the canvas would be right and `validate`/`render --check`/the report would
  each need a copy; the second implementation is the drift this product is against.
- **Selectors as C# lambdas** (`Include: e => e is Container c && …`) — readable, but the engine reads
  syntax and does not execute workspace code; a lambda it cannot evaluate is a view it cannot draw.
- **Store resolved members in the sidecar** — a cache of the model in the presentation store: the third
  store by another name.

## Relationship to the inviolable rules

Model-side and in C#: the view file is the source. No new store; implied links and boundaries are
derived. View edits remain in-place edits through `ViewsAdapter.Edit` (fidelity cases added). The
engine stays pure: the evaluator is a function of the model.

## References

- [F-023](../../features/F-023-c4-views-and-views-by-rule.md)
- `src/Stemma.Engine/ArchModel/ViewsAdapter.cs`
- [C4 model — diagrams](https://c4model.com/diagrams), [Structurizr DSL views](https://docs.structurizr.com/dsl/language#views), [LikeC4 views](https://likec4.dev/dsl/views/)
