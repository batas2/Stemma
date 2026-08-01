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
| [F-002](./F-002-desktop-shell.md) | Desktop shell — run Stemma in its own window | Draft | Next | Bartosz |
| [F-003](./F-003-from-scratch-onboarding.md) | Designing from scratch — the first ten minutes | Draft | Now | Bartosz |

> Keep this table in sync as records are added (the Product Manager
> and Docs Librarian own it). Already-shipped capabilities are
> summarised in [`../product/roadmap.md`](../product/roadmap.md); back-fill records for the ones that
> warrant a durable spec.
