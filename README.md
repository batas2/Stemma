# Verso

> Architecture modeling tool where **source code is the database** and the model is multi-audience by design.

Verso is a web-based architecture modeling tool for **solution and data architects**. Architects build a single, long-living, abstract model — capabilities, services, data entities, processes, decisions, governance — and project it into audience-specific views: capability maps for executives, component diagrams for engineers, ACL trees for security, generated C# stubs for implementation teams.

There is no runtime database. While a workspace is open, the canonical model lives in process memory; permanent storage is heterogeneous source files in Git (`.cs`, `.md`, `.verso.yaml`). Every UI change is translated into a write to the appropriate file format via storage adapters.

The name **Verso** comes from bookbinding: the *verso* is the reverse side of a page. The UI is the verso of the code — same content, different face.

## Status

**Spike 01 complete** — a working web modeler with C# code as the only storage. See `docs/spike-01-status/STATE.md`.

To run locally:

```bash
./run.sh                                          # dev mode (Vite + backend, HMR)
./run.sh --prod                                   # production mode (single backend, bundled SPA)
./run.sh --dev --workspace samples/DemoSolution   # auto-open the demo workspace
```

Tests:

```bash
./scripts/test.sh
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
    ├── operations-catalog.md  — supported UI operations
    ├── sync-protocol.md       — UI ↔ backend synchronization
    ├── projections.md         — multi-audience view system
    └── spike-01-web-modeler.md — first spike spec (web canvas + C# storage)
```

## Reading order

If you are new to the project, read in order:

1. `docs/VISION.md`
2. `docs/discovery-corpus-analysis.md` (the empirical basis for the abstract model)
3. `docs/ARCHITECTURE.md`
4. `docs/DOMAIN-MODEL.md`
5. `specs/round-trip-fidelity.md`
6. `specs/projections.md`

## Next Step

Run the round-trip spike (see `docs/ROADMAP.md`, Phase 0). If round-trip fidelity holds, proceed to Phase 1.
