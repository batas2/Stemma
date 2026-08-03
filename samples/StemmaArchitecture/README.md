# StemmaArchitecture — Stemma modelling itself

A Stemma workspace whose subject **is Stemma**. The architecture of the tool described in
[`.doc/architecture/`](../../.doc/architecture/) is expressed here in Stemma's own DSL, so the model
doubles as a self-referential feature demo and as living documentation of the system.

It mirrors the structure of the reference [`AuroraRail`](../AuroraRail/) sample:
deployable units → C4 Containers, layers → Bounded Contexts, subsystems → Modules, references →
Dependencies, documented runtime flows → DataFlows, and the inviolable rules → Risks / Questions /
Assumptions with lifecycle / ownership tags.

## The three dedicated views

| View | Lens | Story |
|---|---|---|
| **System & Sync Flow** (`view_sync`) | `moduleMap` | Runtime. Actors, the React SPA and the ASP.NET host, the `StemmaEngine` facade, and every neighbouring system, wired by the write path (gesture → operation → `DocumentEditor` rewrite → delta), the load path (open → Roslyn parse → snapshot), the presentation path (debounced PUT → `stemma.layout.json` → prime), and the AI path (prompt → LLM service → operations). *"How an edit travels."* |
| **Code & Ownership** (`view_code`) | `moduleMap` | Structure. The five layer Bounded Contexts (Client, Web, Engine, Model, Quality) with their Modules, Capabilities, and use cases, plus the open Risks / Questions / Assumptions — the fidelity contract, the no-parallel-store rule, prime-the-sidecar-once, engine purity. *"How the code is organised, who owns it, what's open."* |
| **Dependency Graph** (`view_deps`) | `dependencyGraph` | Build / call time. The module "uses / calls" graph across the four layers (the lens renders modules, so containers and external systems are scoped out — their edges live in the model and surface in the Flow view). Makes the **purity boundary** visible: Web and Client modules point inward to the Engine, the Engine points inward to the Model — and **no** Engine module ever points out to a Web, LLM, or Client module. *"What depends on what."* |

## How it maps to the real source

| Model element | Real artefact |
|---|---|
| `ctx_model` · `mod_concepts`, `mod_modelof` | `src/Stemma.Model` (`Concepts.cs`, `Model.cs`) |
| `ctx_engine` · `mod_stemmaengine`, `mod_dslreader`, `mod_dslwriter`, `mod_archops`, `mod_viewsadapter`, `mod_operations`, `mod_undo`, `mod_sidecar`, `mod_validation` | `src/Stemma.Engine` (`Workspace/`, `ArchModel/`, `Operations/`, `Validation/`) |
| `ctx_web` · `mod_rest`, `mod_hub`, `mod_llmservice` | `src/Stemma.Web` (REST endpoints, `Hubs/`, `Services/`) |
| `ctx_client` · `mod_store`, `mod_layoutcache`, `mod_canvas`, `mod_inspector`, … | `src/Stemma.Web.Client` (`lib/store.ts`, `lib/layout.ts`, `components/ArchCanvas.tsx`, …) |
| `cnt_web`, `cnt_client` | the ASP.NET host and the served React SPA bundle |
| `sys_git`, `sys_roslyn`, `sys_llm` | the Git working tree, Roslyn `MSBuildWorkspace`, the LLM provider |

The Risks / Questions / Assumptions encode the inviolable rules from
[`conventions.md`](../../.doc/engineering/conventions.md) and
[`engine-backend.md`](../../.doc/architecture/engine-backend.md):
round-trip fidelity, never `NormalizeWhitespace()`, never a third data store, prime the sidecar once,
and engine purity (ADR-0008).

## Files

```
StemmaArchitecture/
├── StemmaArchitecture.csproj      # references src/Stemma.Model (DSL vocabulary only)
├── Architecture/Architecture.cs  # static Build() → Model.Of(...)
├── Views/
│   ├── SystemAndSyncFlow.cs      # view_sync
│   ├── CodeAndOwnership.cs        # view_code
│   └── DependencyGraph.cs         # view_deps
└── stemma.layout.json             # presentation sidecar: positions, styles, notes, custom props
```

> The C# compiler does **not** check the string ids used in flows / dependencies / `AboutId` / views.
> A typo there is a dangling reference, not a build error — so the ids in this workspace are
> cross-checked against the declared elements.
