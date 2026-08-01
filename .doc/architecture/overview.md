# Architecture Overview

## The shape of the system

Stemma is a .NET backend that owns a Roslyn-parsed model and a React frontend that renders and edits
it. There is **no runtime database** — the model is the source files in Git, held in memory while a
workspace is open.

```
┌──────────────────────────────────────────────────────────────┐
│  Client  ·  src/Stemma.Web.Client                             │
│  React 19 + Vite + @xyflow/react canvas + zustand + Tailwind │
│  Renders the active view; emits operations; applies deltas.  │
└──────────────────────────────────────────────────────────────┘
            ▲ REST (load/snapshot/layout/views/violations)
            ▼ SignalR (operation stream + deltas)
┌──────────────────────────────────────────────────────────────┐
│  Web  ·  src/Stemma.Web                                        │
│  ASP.NET Core 10 · REST endpoints · SignalR hub · LLM access │
│  Translates wire operations (polymorphic JSON) into engine.  │
└──────────────────────────────────────────────────────────────┘
            ▲ ▼
┌──────────────────────────────────────────────────────────────┐
│  Engine  ·  src/Stemma.Engine   (pure, no web/LLM deps)       │
│  Roslyn MSBuildWorkspace · in-memory model · operations ·    │
│  DocumentEditor rewrites · DSL reader/writer · layout sidecar│
└──────────────────────────────────────────────────────────────┘
            ▲ ▼
┌──────────────────────────────────────────────────────────────┐
│  Model  ·  src/Stemma.Model                                   │
│  The DSL vocabulary: elements, links, tags, views (records). │
└──────────────────────────────────────────────────────────────┘
            ▲ ▼
┌──────────────────────────────────────────────────────────────┐
│  Storage  ·  the Git working tree                            │
│  Architecture/Architecture.cs · Views/*.cs · stemma.layout.json│
│  No SQLite, no Postgres, no embedded store.                  │
└──────────────────────────────────────────────────────────────┘
```

## What each layer owns

- **Model** ([`domain-model.md`](./domain-model.md)) — the C# record vocabulary an architect writes
  (`Module`, `BoundedContext`, `DataFlow`, `Tag`, `View`, …) and `Model.Of(...)`.
- **Engine** ([`engine-backend.md`](./engine-backend.md)) — loads a workspace through Roslyn, holds
  the canonical model in memory, applies **operations** as targeted `DocumentEditor` rewrites,
  reads/writes the DSL, manages undo and the layout sidecar. Pure Roslyn — **no web or LLM
  dependencies** (ADR: LLM access is a Web-layer concern).
- **Web** — REST for workspace load/snapshot, layout PUT, views, violations, books; a SignalR hub
  for the operation stream and delta broadcast; the only place LLM calls live.
- **Client** ([`client-frontend.md`](./client-frontend.md)) — renders the active view as nodes and
  edges, captures gestures as operations, and patches the local graph from deltas. Holds no
  authoritative model state; a refresh re-fetches the snapshot.

## The reality vs. the aspiration

The archived `VISION`/`ARCHITECTURE` describe a broader five-layer system with multiple storage
adapters (YAML, Markdown) and a rich projection layer. **The current implementation is intentionally
lean:** a single Roslyn adapter for the model plus a committed JSON presentation sidecar. The
YAML/Markdown/Discovery adapters and the standalone projection layer were removed to keep the engine
pure and the fidelity contract enforceable. Treat the broader vision as *directional* (see
[`../product/roadmap.md`](../product/roadmap.md)); treat this document as *current*.

## The non-negotiable: round-trip fidelity

A UI edit must produce a `git diff` containing **only** the intended change. Everything in the engine
is shaped around this. The hard rules (no `NormalizeWhitespace`, no string-concatenation file
rebuilds, no parallel data store, no method-body edits, no editing generated files) are documented
in [`engine-backend.md`](./engine-backend.md) and enforced in [`../engineering/conventions.md`](../engineering/conventions.md).

## Where things live

| Concern | Path |
|---|---|
| DSL vocabulary | `src/Stemma.Model/` |
| Engine, operations, sidecar | `src/Stemma.Engine/` |
| Web host, SignalR, REST, LLM | `src/Stemma.Web/` |
| Frontend | `src/Stemma.Web.Client/` |
| Sample workspaces | `samples/` |
| Architecture decisions | [`decisions/README.md`](./decisions/README.md) |
