# Users & Personas

Stemma has one source-of-truth audience and several projection audiences. The architect owns the
canonical model; everyone else consumes views derived from it.

## Primary — Solution Architect ("Aria")

- **Job-to-be-done:** design and continuously evolve bounded contexts, capability maps, integration
  topologies, and target-state transitions for a domain that spans products and years.
- **Needs:** one living model whose properties she can change as understanding deepens; rich
  relationship semantics; confidence that the picture matches reality.
- **Pain today:** diagrams drift; redesign means re-drawing; decisions are lost in wikis.
- **Stemma for Aria:** the canvas *is* the model; every change is a real, reviewable code edit;
  decisions/risks/assumptions live next to the elements they concern.

## Primary — Data Architect ("Devin")

- **Job-to-be-done:** model domain concepts, resource hierarchies, ownership and access boundaries,
  and how data flows between bounded contexts.
- **Needs:** evolve a model without losing prior decisions; express ownership, lifecycle, and data
  flow explicitly.
- **Stemma for Devin:** `DataFlow` and `Dependency` relationships, `Ownership`/`Lifecycle` tags, and
  views that isolate a single data path.

## Secondary — Senior Engineer ("Sam")

- **Job-to-be-done:** consume a code projection of the architects' model to scaffold real services,
  and push structural refinements back upstream.
- **Stemma for Sam:** opens the same workspace, reads the C# model and the dependency view, edits a
  module, and the architect sees it in their canvas.

## Producing, headlessly — The Essayist's Agent ("Ada")

The one persona here that is not a human, and the only one that never opens the UI.

- **Job-to-be-done:** turn a written argument or a system description into a correct, on-palette
  image on disk, in one pass, from a repository that is not Stemma's.
- **Needs:** a documented text format it can author from memory; layout expressed as intent rather
  than pixels; a single deterministic command that produces the file; a way to be told it got the
  model wrong.
- **Cannot:** click, drag, see the canvas, or ask a human to nudge a box. Ambient state — an
  already-open workspace, a `localStorage` entry, a browser session — is invisible to it and
  therefore unusable.
- **Fails when:** a capability is reachable only through a gesture. Every mouse-only affordance is,
  for Ada, a missing feature.
- **Stemma for Ada:** writes `Architecture.cs`, a `Views/<Name>.cs`, and a layout constraint in
  `stemma.layout.json`; runs one render command; reads a manifest to confirm the picture contains
  what it asked for.

Ada is the projection half of "humans and agents edit the same model": the diff half is served
today, the picture half is not. The gap analysis and the decisions behind the work are in
[`agent-authored-diagrams.md`](./agent-authored-diagrams.md).

> Ada is a *forcing function*, not a niche. Everything Ada needs — a documented format, headless
> render, layout as data, output that can be checked — is something Aria and Devin benefit from the
> moment they want a diagram in a document rather than on a screen.

## Consuming — Non-technical stakeholders ("Priya", product/exec/security/compliance)

- **Job-to-be-done:** understand capability maps, decisions, and governance overlays without
  touching code.
- **Stemma for Priya:** dedicated **views** (capability map, ownership, risk) projected from the same
  model — never editing code, always seeing the current truth.

## Persona → perspective map

| Persona | Cares most about | Primary docs |
|---|---|---|
| Solution Architect | Model correctness, evolution, fidelity | `architecture/`, `product/` |
| Data Architect | Relationships, ownership, data flow | `architecture/domain-model.md` |
| Senior Engineer | Onboarding speed, conventions | `architecture/`, `engineering/` |
| Essayist's Agent | Authorable format, headless output | `agent-authored-diagrams.md`, `architecture/domain-model.md` |
| Stakeholder | Clarity of the projected view | `ux/`, `ui/` |

When writing a feature spec, name **which persona** it serves and **which view/perspective** it
touches. A feature that serves no named persona is a candidate for the cutting room.
