# Features

Living feature records — one Markdown file per feature, created from
[`../templates/feature-template.md`](../templates/feature-template.md).

## Conventions

- **File name:** `F-<NNN>-<slug>.md` (e.g. `F-014-edge-bundling.md`). Epics use `epic-<NN>-<slug>.md`
  ([`../templates/epic-template.md`](../templates/epic-template.md)).
- **One record per feature.** Keep it updated through its lifecycle (`Draft → Ready → In progress →
  Shipped`/`Cut`).
- Every record names a **persona**, a **roadmap horizon**, and its **Product / Architecture / UX /
  UI** impact. No record, no build.

## Index

| ID | Feature | Status | Horizon | Owner |
|---|---|---|---|---|
| [F-001](./F-001-architecture-report-export.md) | Architecture Report — single-file interactive HTML export | Shipped (v1) | Now | Bartosz |
| [F-002](./F-002-desktop-shell.md) | Desktop shell — run Stemma in its own window | Shipped (v1) | Next | Bartosz |
| [F-003](./F-003-from-scratch-onboarding.md) | Designing from scratch — the first ten minutes | Shipped (v1) | Now | Bartosz |
| [F-004](./F-004-headless-diagram-render.md) | Headless diagram render (`stemma render`) | Shipped (v1) | Next | Bartosz |
| [F-005](./F-005-publication-profile-and-palettes.md) | Publication render profile & named export palettes | Shipped (v1) | Next | Bartosz |
| [F-006](./F-006-declarative-layout-dsl.md) | Declarative layout DSL in the presentation sidecar | Shipped (v1) | Next | Bartosz |
| [F-007](./F-007-sidecar-schema-and-protocol.md) | Sidecar schema, protocol reference, workspace `STEMMA.md` | Shipped (v1) | Next | Bartosz |
| [F-008](./F-008-render-manifest.md) | Render manifest & staleness detection | Shipped (v1) | Later | Bartosz |
| [F-009](./F-009-vector-output.md) | True vector output from the publication profile | Shipped (v1) | Later | Bartosz |
| [F-010](./F-010-concept-element-kind.md) | The `Concept` element kind ([ADR-0018](../architecture/decisions/0018-concept-element-kind.md)) | Shipped (v1) | Next | Bartosz |
| [F-011](./F-011-diagnostics-and-logging.md) | Diagnostics & logging — a leveled, structured record of what the engine did | Shipped (v1, no UI panel) | Next | Bartosz |
| [F-012](./F-012-first-release.md) | The first release — a version, a way to cut one, and a one-command install | Shipped | Now | Bartosz |

F-011 **blocked F-002** — the desktop shell's "backend failed to start" state needs a log file to
point at, and now names `~/.stemma/logs/` in that surface.

F-004 through F-010 come from [`../product/agent-authored-diagrams.md`](../product/agent-authored-diagrams.md),
the capability analysis for the **Essayist's Agent ("Ada")** persona; that document carries the
problem statement, the six decisions (§8) and the sequencing (§6) each record inherits. F-010 is the
only one that touches `Stemma.Engine` and therefore the fidelity suite, and it is the only one that
needs an ADR.

> Keep this table in sync as records are added (the Product Manager
> and Docs Librarian own it). Already-shipped capabilities are
> summarised in [`../product/roadmap.md`](../product/roadmap.md); back-fill records for the ones that
> warrant a durable spec.
