# Verso

> Architecture modeling tool where **source code is the database** and the model is multi-audience by design.

Verso is a web-based architecture modeling tool for **solution and data architects**. Architects build a single, long-living, abstract model — capabilities, services, data entities, processes, decisions, governance — and project it into audience-specific views: capability maps for executives, component diagrams for engineers, ACL trees for security, generated C# stubs for implementation teams.

There is no runtime database. While a workspace is open, the canonical model lives in process memory; permanent storage is heterogeneous source files in Git (`.cs`, `.md`, `.verso.yaml`). Every UI change is translated into a write to the appropriate file format via storage adapters.

The name **Verso** comes from bookbinding: the *verso* is the reverse side of a page. The UI is the verso of the code — same content, different face.

## Status

Verso was deliberately **refocused on its core**: open a workspace → edit the architecture
model on a canvas → every change round-trips into `Architecture.cs` with full fidelity. A
large simplification pass removed the scope-creep accumulated across earlier epics —
discovery / metrics / AI views, the data-layer YAML views, decisions + Markdown narratives,
the C4 view, and the Epic-13 navigation layer (lens navigator, Model/Present mode, audience
switch). The keep/cut decisions are recorded in `docs/CAPABILITY-AUDIT.md`.

What ships today:

- **Two architecture lenses** — **Module Map** (the universal canvas; renders every element
  kind, grouped by bounded context) and **Dependencies** — both editable, both projected
  from `Architecture/Architecture.cs`.
- **Architecture-model editing** — add / rename / remove elements and links, lifecycle and
  ownership tags, undo / redo, external-edit sync, validation, custom (saved) views,
  free-form shapes, stencils, comments, View Books, and PNG / SVG / Mermaid / draw.io / PDF
  export.
- **Code-layer engine** — the Roslyn type / property / inheritance ops remain as the
  round-trip fidelity proof; they are no longer surfaced as a UI view.

Tests: engine + web + frontend green (frontend **96/96**; web **7/7**). The engine
`ArchModelTests.WouldBreakBuild` failures are a pre-existing temp-workspace environment
baseline, unrelated to this pass.

To run locally:

```bash
./run.sh                                                # dev mode (Vite + backend, HMR)
./run.sh --prod                                         # production (bundled SPA + backend)
./run.sh --dev --workspace samples/SupplierNetwork      # arch-modelling demo (Epic 02)
./run.sh --dev --workspace samples/DemoSolution         # code-shape demo (Epic 01)
```

Docker:

```bash
docker compose -f docker/docker-compose.yml up --build
```

## Why

Most architecture tools (draw.io, Lucidchart, Enterprise Architect) drift from the codebase the moment they are saved. Reverse-engineering tools generate diagrams from code but cannot edit it. Verso closes the loop: the diagram *is* the code, the code *is* the diagram.

## Repository Layout

```
verso/
├── README.md                 — this file
├── CONTRIBUTING.md           — how to work on this project
├── docs/
│   ├── VISION.md             — product vision and target users
│   ├── ARCHITECTURE.md       — high-level system architecture
│   ├── DOMAIN-MODEL.md       — the typed graph behind the UI
│   ├── ROADMAP.md            — phased delivery plan
│   ├── GLOSSARY.md           — shared vocabulary
│   ├── USE-CASES.md          — primary user journeys
│   ├── API.md                — planned API surface
│   └── decisions/            — Architecture Decision Records (ADRs)
└── specs/
    ├── round-trip-fidelity.md — model↔storage preservation contract (per adapter)
    ├── operations-catalog.md  — implemented + planned operations
    ├── sync-protocol.md       — UI ↔ backend synchronization
    ├── projections.md         — multi-audience view system
    └── epic-01-web-modeler.md — first epic spec (web canvas + C# storage)

src/
├── Verso.Engine/              — Roslyn workspace + DSL reader/writer + ops
├── Verso.Web/                 — ASP.NET Core 10 host + SignalR
├── Verso.Web.Client/          — React 19 + Vite + xyflow + Tailwind
└── Verso.Model/               — meta-model package referenced by user workspaces

samples/
├── SupplierNetwork/           — model-first demo (3 contexts, 9 modules, 9 flows)
├── DemoSolution/              — code-shape demo (engineer view)
└── EnterpriseApi/             — Epic 08 demo: Concepts/*.verso.yaml + onboarding book
```

## Reading order

If you are new to the project, read in order:

1. `docs/VISION.md`
2. `docs/discovery-corpus-analysis.md` (the empirical basis for the abstract model)
3. `docs/ARCHITECTURE.md`
4. `docs/DOMAIN-MODEL.md`
5. `specs/round-trip-fidelity.md`
6. `specs/operations-catalog.md`
7. `specs/projections.md`
8. `docs/EPICS.md` — index of every epic and its current status
9. `docs/epic-06-discovery-metrics-ai/STATE.md` — most recent close-out (the freshest snapshot of what is built)

## Next Step

Epic 08 close-out left a handful of cuts queued (data-layer view renderers, cross-adapter rename propagation, book authoring polish, YAML op-stream wire-up) — those bundle naturally into the next epic. Three open candidates in priority order:

- **Epic 09 — Multi-Repo Discovery and Federation.** Bind cross-repo phantom endpoints from Epic 06 into a federated graph spanning every member of a meta-workspace. Plan stub in `docs/epic-06-discovery-metrics-ai/NEXT-EPIC.md` § 13.
- **Epic 10 — Comparison View and Cross-Adapter Diff.** Git-ref-aware diff overlay on the canvas plus the cross-adapter diff debt Epic 08 introduced (`Architecture.cs` says X, `Concepts/*.verso.yaml` says Y).
- **Epic 11 — Drift Watchers and Governance Gates.** Continuous discovery on file change, metric thresholds as CI gates, automatic Decisions raised when distance-from-main-sequence crosses a band.
