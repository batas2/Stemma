# Verso

> Architecture modeling tool where **source code is the database** and the model is multi-audience by design.

Verso is a web-based architecture modeling tool for **solution and data architects**. Architects build a single, long-living, abstract model — capabilities, services, data entities, processes, decisions, governance — and project it into audience-specific views: capability maps for executives, component diagrams for engineers, ACL trees for security, generated C# stubs for implementation teams.

There is no runtime database. While a workspace is open, the canonical model lives in process memory; permanent storage is heterogeneous source files in Git (`.cs`, `.md`, `.verso.yaml`). Every UI change is translated into a write to the appropriate file format via storage adapters.

The name **Verso** comes from bookbinding: the *verso* is the reverse side of a page. The UI is the verso of the code — same content, different face.

## Status

- **Epics 01–07 complete.** Roslyn engine + web canvas → meta-model DSL → living model + validation + sidecar → decisions + Markdown narratives → UX tokens + accessibility → discovery + metrics + AI views → free-form canvas shapes + stencil library + comments + UX stability. Index in `docs/EPICS.md`.
- **Epic 08 candidate** — multi-repo discovery + federation. Plan stub in `docs/epic-06-discovery-metrics-ai/NEXT-EPIC.md` § 13.
- **Epic 09 candidate** — comparison view + multi-page. Surfaced in `docs/epic-07-canvas-shapes-ux/MARKET-COMPARISON.md`.
- **Epic 10 candidate** — drift watchers + governance gates.

Tests: **84/84 backend + 53/53 frontend = 137/137 green** as of Epic 07 close.

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
└── DemoSolution/              — code-shape demo (engineer view)
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

Three open candidates in priority order:

- **Epic 08 — Multi-Repo Discovery and Federation.** Bind cross-repo phantom endpoints from Epic 06 into a federated graph spanning every member of a meta-workspace. Plan stub in `docs/epic-06-discovery-metrics-ai/NEXT-EPIC.md` § 13.
- **Epic 09 — Comparison View and Multi-Page.** Git-ref-aware diff overlay on the canvas + multi-page navigation among views. Surfaced as ranks 5 and 6 in `docs/epic-07-canvas-shapes-ux/MARKET-COMPARISON.md`.
- **Epic 10 — Drift Watchers and Governance Gates.** Continuous discovery on file change, metric thresholds as CI gates, automatic Decisions raised when distance-from-main-sequence crosses a band.
