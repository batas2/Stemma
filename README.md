# Stemma

> **Your architecture, written in your source.** Humans and AI agents edit the same model, and every
> change arrives as a reviewable diff. UI edits become Roslyn rewrites of real `.cs` files — the
> diagram can't drift from the code, because the diagram *is* the code.

Stemma is a web-based architecture modeling tool for **solution and data architects**. You build one
long-living model — bounded contexts, capabilities, containers, data flows, dependencies, decisions,
risks, ownership — on a canvas, and project it into audience-specific **views**. Every change
round-trips into `Architecture/Architecture.cs` with full fidelity: the resulting `git diff` contains
*only* the intended change.

There is no runtime database. While a workspace is open the model lives in memory; permanent storage
is the source files in Git plus a small committed presentation sidecar (`stemma.layout.json`).

The name comes from manuscript scholarship: a *stemma codicum* is the family tree showing how every
surviving copy of a text descends from a single archetype. That is what this tool draws — the
architecture, its lineage, and every version of it, from one canonical source.

## Why

draw.io / Lucidchart / Enterprise Architect drift the moment they're saved. Reverse-engineering tools
read code but can't edit it. Stemma closes the loop — and guarantees **round-trip fidelity** so the
loop is trustworthy. See [`.doc/product/value-proposition.md`](./.doc/product/value-proposition.md).

## What ships today

- **Canvas modeling** — Module Map, Dependencies, and saved custom views; bounded-context grouping;
  pan/zoom/minimap; PNG/SVG export.
- **Model editing** — add/rename/remove elements and links, re-parent modules, lifecycle and
  ownership tags, risks/questions/assumptions, undo/redo, external-edit sync — all as fidelity-safe
  Roslyn rewrites.
- **Rich presentation** (committed sidecar) — per-view auto-layout (organic/hierarchical/by-type/
  custom, tunable), node & edge styling, draw.io-style edge docking, free-form shapes, and
  markdown-backed notes with a full rich-text editor.

## Documentation — start in [`.doc/`](./.doc/)

`.doc/` is the Single Source of Truth, organised by the four pillars — **Product, Architecture, UX,
UI** — plus engineering standards and actionable templates.

| If you want to… | Read |
|---|---|
| Understand why Stemma exists | [`.doc/product/vision.md`](./.doc/product/vision.md) |
| Understand how it's built | [`.doc/architecture/overview.md`](./.doc/architecture/overview.md) |
| Know the one rule that overrides all | [`.doc/architecture/engine-backend.md`](./.doc/architecture/engine-backend.md) (round-trip fidelity) |
| Build a feature / file a bug | [`.doc/templates/`](./.doc/templates/) |
| Contribute | [`.doc/engineering/contributing.md`](./.doc/engineering/contributing.md) |

Pre-refactor docs are archived (not authoritative) under [`.doc.legacy/`](./.doc.legacy/).

## Repository layout

```
stemma/
├── .doc/                 — Single Source of Truth (product · architecture · ux · ui · templates)
├── .doc.legacy/          — archived pre-refactor docs (reference only)
├── README.md  CONTRIBUTING.md
├── src/
│   ├── Stemma.Model/      — the DSL vocabulary (records) user workspaces reference
│   ├── Stemma.Engine/     — Roslyn workspace, operations, DSL reader/writer, layout sidecar
│   ├── Stemma.Web/        — ASP.NET Core 10 host + SignalR + (LLM access)
│   └── Stemma.Web.Client/ — React 19 + Vite + @xyflow/react + zustand + Tailwind
└── samples/              — demo workspaces (NetworkAggregation, SupplierNetwork, EnterpriseApi, …)
```

## Build & test

```bash
dotnet build && dotnet test                 # backend (incl. the round-trip fidelity suite)

cd src/Stemma.Web.Client
npx tsc --noEmit -p tsconfig.json           # typecheck
npx vite build                              # build
npx vitest run                              # tests
```

A good first workspace to open is [`samples/NetworkAggregation`](./samples/NetworkAggregation/) — a
full model exercising every feature across three perspective views.
