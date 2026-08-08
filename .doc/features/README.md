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
| [F-002](./F-002-desktop-shell.md) | Desktop shell — run Stemma in its own window | Ready (shell pending) | Next | Bartosz |
| [F-003](./F-003-from-scratch-onboarding.md) | Designing from scratch — the first ten minutes | In progress | Now | Bartosz |
| [F-011](./F-011-diagnostics-and-logging.md) | Diagnostics & logging — a leveled, structured record of what the engine did | Draft | Next | Bartosz |

F-011 takes the next id after the block reserved below, and **blocks F-002** — the desktop shell's
"backend failed to start" state needs a log file to point at.

## Proposed — reserved, records not yet written

Ids reserved by [`../product/agent-authored-diagrams.md`](../product/agent-authored-diagrams.md), the
capability analysis for the **Essayist's Agent ("Ada")** persona. These are *not* records yet and
nothing here is buildable until each has one — the rule stands: **no record, no build.** The analysis
carries the problem statement, the decisions (§8) and the sequencing (§6) each record should inherit.

| ID | Feature | Horizon | Phase |
|---|---|---|---|
| F-004 | Headless diagram render (`stemma render`, `src/Stemma.Cli`) | Next | 1 |
| F-005 | Publication render profile & named export palettes | Next | 1–2 |
| F-006 | Declarative layout DSL in the presentation sidecar | Next | 2 |
| F-007 | Sidecar JSON Schema, protocol reference, workspace `STEMMA.md` | Next | 0–2 |
| F-008 | Render manifest & staleness detection | Later | 3 |
| F-009 | True vector output from the publication profile | Later | 3 |
| F-010 | The `Concept` element kind — **the one engine change; needs an ADR** | Next | 2 |

F-010 is the only one that touches `Stemma.Engine` and therefore the fidelity suite; it carries the
full operation procedure (spec → ≥3 round-trip fixtures → `DocumentEditor` → fidelity suite). The
rest are presentation-side.

**Phase 0 of that programme shipped on 2026-08-08** and correctly needed no record — it was
[B-001](../bugs/B-001-layout-sidecar-drops-shapes-and-edge-handles.md) plus three small fixes:
wrapping node titles, transparency and scale as image-export options, and a published JSON Schema for
the sidecar (`schema/stemma.layout.schema.json`). Parts of F-005 and F-007 are therefore already in
place; each record should open by saying what is left rather than restating the whole item.

> Keep this table in sync as records are added (the Product Manager
> and Docs Librarian own it). Already-shipped capabilities are
> summarised in [`../product/roadmap.md`](../product/roadmap.md); back-fill records for the ones that
> warrant a durable spec.
