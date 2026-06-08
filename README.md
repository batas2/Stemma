# Verso

> Architecture modeling where **the source code is the model database**. UI edits become Roslyn
> rewrites of real `.cs` files — so the diagram can't drift from the code, because the diagram *is*
> the code.

Verso is a web-based architecture modeling tool for **solution and data architects**. You build one
long-living model — bounded contexts, capabilities, containers, data flows, dependencies, decisions,
risks, ownership — on a canvas, and project it into audience-specific **views**. Every change
round-trips into `Architecture/Architecture.cs` with full fidelity: the resulting `git diff` contains
*only* the intended change.

There is no runtime database. While a workspace is open the model lives in memory; permanent storage
is the source files in Git plus a small committed presentation sidecar (`verso.layout.json`).

The name comes from bookbinding: the *verso* is the reverse side of a page. The UI is the verso of
the code — same content, different face.

## Why

draw.io / Lucidchart / Enterprise Architect drift the moment they're saved. Reverse-engineering tools
read code but can't edit it. Verso closes the loop — and guarantees **round-trip fidelity** so the
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
| Understand why Verso exists | [`.doc/product/vision.md`](./.doc/product/vision.md) |
| Understand how it's built | [`.doc/architecture/overview.md`](./.doc/architecture/overview.md) |
| Know the one rule that overrides all | [`.doc/architecture/engine-backend.md`](./.doc/architecture/engine-backend.md) (round-trip fidelity) |
| Build a feature / file a bug | [`.doc/templates/`](./.doc/templates/) |
| Contribute | [`.doc/engineering/contributing.md`](./.doc/engineering/contributing.md) |

Pre-refactor docs are archived (not authoritative) under [`.doc.legacy/`](./.doc.legacy/).

## Repository layout

```
verso/
├── .doc/                 — Single Source of Truth (product · architecture · ux · ui · templates)
├── .doc.legacy/          — archived pre-refactor docs (reference only)
├── README.md  CONTRIBUTING.md
├── src/
│   ├── Verso.Model/      — the DSL vocabulary (records) user workspaces reference
│   ├── Verso.Engine/     — Roslyn workspace, operations, DSL reader/writer, layout sidecar
│   ├── Verso.Web/        — ASP.NET Core 10 host + SignalR + (LLM access)
│   └── Verso.Web.Client/ — React 19 + Vite + @xyflow/react + zustand + Tailwind
└── samples/              — demo workspaces (NetworkAggregation, SupplierNetwork, EnterpriseApi, …)
```

## Build & test

```bash
dotnet build && dotnet test                 # backend (incl. the round-trip fidelity suite)

cd src/Verso.Web.Client
npx tsc --noEmit -p tsconfig.json           # typecheck
npx vite build                              # build
npx vitest run                              # tests
```

A good first workspace to open is [`samples/NetworkAggregation`](./samples/NetworkAggregation/) — a
full model exercising every feature across three perspective views.
