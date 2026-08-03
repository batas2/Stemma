# Architecture Decisions (ADRs)

Architecture Decision Records capture *why* the system is the way it is. New ADRs are written with
[`../../templates/adr-template.md`](../../templates/adr-template.md), numbered sequentially, and
start at `Proposed` until a maintainer accepts them.

The 13 historical ADRs are not published with this repository; the table below is the
**curated index** — what each decided and whether it still holds, given the engine was deliberately
slimmed (single Roslyn adapter + presentation sidecar; YAML/Markdown/Discovery/projection layers
removed).

| # | Decision | Status today |
|---|---|---|
| 0001 | **Roslyn as the engine** — parse/edit C# via Roslyn `DocumentEditor`. | ✅ Current — foundational. |
| 0002 | **Git as storage** — no runtime DB; the working tree is the database. | ✅ Current — foundational. |
| 0003 | **Layout sidecar** — presentation state in a committed `stemma.layout.json`, not the code. | ✅ Current — see [`../data-flow-and-sync.md`](../data-flow-and-sync.md). |
| 0004 | **In-memory canonical model** — the model lives in memory while open. | ✅ Current. |
| 0005 | **Projection system** — views as pure functions of the model. | 🟡 Partial — views exist (`moduleMap`/`dependencyGraph`/custom); the standalone projection layer and code/Mermaid projections are not built. |
| 0006 | **Heterogeneous storage formats** (.cs/.md/.yaml adapters). | 🗄️ Historical — the multi-adapter design was removed; the engine is Roslyn-only today. |
| 0007 | **Discovery as cache** (`discovered.stemma.json` regenerable). | 🗄️ Historical — discovery subsystem removed. |
| 0008 | **LLM via the Web layer** — engine stays pure; LLM calls live in `Stemma.Web`. | ✅ Current — engine purity boundary. |
| 0009 | **Canvas shapes in the layout sidecar** — free-form shapes are presentation. | ✅ Current. |
| 0010 | **Comments as a Git sidecar.** | 🟡 Partial — revisit if comments are reintroduced. |
| 0011 | **YAML adapter shape.** | 🗄️ Historical — YAML adapter removed. |
| 0012 | **View Books governance concept.** | 🟡 Directional — see [`../../product/roadmap.md`](../../product/roadmap.md). |
| 0013 | **Cross-adapter references.** | 🗄️ Historical — single adapter now. |
| [0014](./0014-architecture-report-rendering-and-comment-pack.md) | **Architecture report** — embedded-JSON standalone renderer + comment-pack round-trip. | ✅ Current — see [F-001](../../features/F-001-architecture-report-export.md). |
| [0015](./0015-project-name-and-market-positioning.md) | **Name and positioning** — the project is Stemma; the pitch is one source both humans and agents edit. | ✅ Current — see [value-proposition](../../product/value-proposition.md). |
| [0016](./0016-sdk-free-model-only-workspaces.md) | **SDK-free model-only workspaces** — a second load path with no MSBuild, so a model opens without a .NET SDK. | ✅ Current — see [F-003](../../features/F-003-from-scratch-onboarding.md). |
| [0017](./0017-desktop-shell-photino.md) | **Photino as the desktop shell** — one .NET process hosting Kestrel and a native window. | 🟡 Accepted, pending the WebKitGTK benchmark — see [F-002](../../features/F-002-desktop-shell.md). |

## Legend

- ✅ **Current** — actively true; build on it.
- 🟡 **Partial / Directional** — partly realised or aspirational; check before relying.
- 🗄️ **Historical** — superseded by the lean architecture; kept for context, do not build on it.

## When to write a new ADR

Write one when a decision is hard to reverse, affects a boundary (engine purity, model-vs-sidecar,
fidelity), or future contributors will ask "why is it like this?" Reference the ADR from any code or
doc that depends on it. The Software Architect owns this
index.
