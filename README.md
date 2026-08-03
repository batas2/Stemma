# Stemma

[![CI](https://github.com/batas2/Stemma/actions/workflows/ci.yml/badge.svg)](https://github.com/batas2/Stemma/actions/workflows/ci.yml)
[![License: PolyForm Noncommercial 1.0.0](https://img.shields.io/badge/license-PolyForm%20Noncommercial%201.0.0-blue)](./LICENSE)
[![Project page](https://img.shields.io/badge/project%20page-bfrackowiak.pl%2Fstemma-0f766e)](https://bfrackowiak.pl/stemma/)
[![Essays](https://img.shields.io/badge/essays-bfrackowiak.pl-6366f1)](https://bfrackowiak.pl/)

> **Your architecture, written in your source.** Humans and AI agents edit the same model, and every
> change arrives as a reviewable diff. UI edits become Roslyn rewrites of real `.cs` files — the
> diagram can't drift from the code, because the diagram *is* the code.

**→ [bfrackowiak.pl/stemma](https://bfrackowiak.pl/stemma/)** — the illustrated tour: a rename shown
as a diff, the full vocabulary, the views, story books, and the roadmap.

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

The argument in full, and why a diagram that *can* drift always does:
**[The Diagram That Cannot Lie](https://bfrackowiak.pl/blog/the-diagram-that-cannot-lie/)**.

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

## Repository layout

```
stemma/
├── .doc/                 — Single Source of Truth (product · architecture · ux · ui · templates)
├── README.md  CONTRIBUTING.md
├── src/
│   ├── Stemma.Model/      — the DSL vocabulary (records) user workspaces reference
│   ├── Stemma.Engine/     — Roslyn workspace, operations, DSL reader/writer, layout sidecar
│   ├── Stemma.Web/        — ASP.NET Core 10 host + SignalR + (LLM access)
│   └── Stemma.Web.Client/ — React 19 + Vite + @xyflow/react + zustand + Tailwind
└── samples/              — demo workspaces (AuroraRail, StemmaArchitecture, DemoSolution)
```

## Quick start

Needs the **.NET 10 SDK** and **Node 24+**. Nothing else — no database, no container.

```bash
git clone https://github.com/batas2/Stemma.git
cd Stemma
./run.sh --dev --workspace samples/AuroraRail
```

`--dev` runs the backend on `:5050` and Vite on `:5173`; `--prod` bundles the client and serves
everything from `:5050`. A model-only workspace (no `.csproj`) opens without the SDK entirely.

[`samples/AuroraRail`](./samples/AuroraRail/) is the reference workspace: a fictional rail-ticketing
platform with 66 elements, four saved views and three narrative books, exercising every part of the
DSL. [`samples/StemmaArchitecture`](./samples/StemmaArchitecture/) is Stemma modelling itself.

## Build & test

```bash
dotnet build && dotnet test                 # backend (incl. the round-trip fidelity suite)

cd src/Stemma.Web.Client
npx tsc --noEmit -p tsconfig.json           # typecheck
npx vite build                              # build
npx vitest run                              # tests
```

## The thinking behind it

Stemma came out of a weekly essay series on software architecture and the organisations that produce
it — [**bfrackowiak.pl**](https://bfrackowiak.pl/) ([RSS](https://bfrackowiak.pl/feed.xml)). The
pieces that explain what this tool is arguing with:

| Essay | Why it matters here |
|---|---|
| [The Diagram That Cannot Lie](https://bfrackowiak.pl/blog/the-diagram-that-cannot-lie/) | The premise: a model that physically cannot drift from the code. |
| [The Bottleneck Moved](https://bfrackowiak.pl/blog/the-bottleneck-moved/) | Why every edit here lands as a reviewable diff, not a canvas state. |
| [A Feature Is Not a Service](https://bfrackowiak.pl/blog/a-feature-is-not-a-service/) | The bounded-context vocabulary the DSL is built on. |
| [Prompt-Driven Architecture](https://bfrackowiak.pl/blog/prompt-driven-architecture/) | Why humans and agents edit the same model through the same operations. |
| [Multi-Agent Is an Org Chart](https://bfrackowiak.pl/blog/multi-agent-is-an-org-chart/) | Where ownership and RAPID tags in the model came from. |

## License

Stemma is **source-available, not open source**, under the
[PolyForm Noncommercial License 1.0.0](./LICENSE).

- **Free** for any noncommercial purpose — personal use, study, hobby projects, and use by
  charities, educational institutions, public research bodies and government.
- **Not free** for commercial use of any kind: using it inside a business, building paid services
  on it, or selling it or a derivative. That needs a commercial licence —
  <kontakt@bfrackowiak.pl>.

You may read, modify and share the source within those limits. Contributions are welcome on the same
terms; see [CONTRIBUTING.md](./CONTRIBUTING.md).

---

Built by **[Bartosz Frąckowiak](https://bfrackowiak.pl/about/)** — solution architect, writing
weekly at [bfrackowiak.pl](https://bfrackowiak.pl/) about architecture, the people around it, and the
corporate machine they form together. Project page: [bfrackowiak.pl/stemma](https://bfrackowiak.pl/stemma/).
Commercial licence enquiries: <kontakt@bfrackowiak.pl>.
