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
| 0010 | **Comments as a Git sidecar.** | 🟡 Partial — comments live in `comments.stemma.json`, changed by id as [ADR-0021](./0021-sidecar-written-as-changes.md) decision 6 sets out ([B-018](../../bugs/B-018-comments-written-whole-and-read-as-empty.md)). |
| 0011 | **YAML adapter shape.** | 🗄️ Historical — YAML adapter removed. |
| 0012 | **View Books governance concept.** | 🗄️ Historical — superseded by [ADR-0022](./0022-books-in-the-layout-sidecar.md). |
| 0013 | **Cross-adapter references.** | 🗄️ Historical — single adapter now. |
| [0014](./0014-architecture-report-rendering-and-comment-pack.md) | **Architecture report** — embedded-JSON standalone renderer + comment-pack round-trip. | ✅ Current — see [F-001](../../features/F-001-architecture-report-export.md). |
| [0015](./0015-project-name-and-market-positioning.md) | **Name and positioning** — the project is Stemma; the pitch is one source both humans and agents edit. | ✅ Current — see [value-proposition](../../product/value-proposition.md). |
| [0016](./0016-sdk-free-model-only-workspaces.md) | **SDK-free model-only workspaces** — a second load path with no MSBuild, so a model opens without a .NET SDK. | ✅ Current — see [F-003](../../features/F-003-from-scratch-onboarding.md). |
| [0017](./0017-desktop-shell-photino.md) | **Photino as the desktop shell** — one .NET process hosting Kestrel and a native window. | 🟡 Accepted, pending the WebKitGTK benchmark — see [F-002](../../features/F-002-desktop-shell.md). |
| [0018](./0018-concept-element-kind.md) | **A `Concept` element kind** — a box that asserts nothing, so a figure need not pretend to be a `Module`. | ✅ Current — see [F-010](../../features/F-010-concept-element-kind.md). |
| [0019](./0019-relation-link-kind.md) | **A `Relation` link kind** — an arrow that asserts nothing, the same escape for links. | ✅ Current. |
| [0020](./0020-diagnostics-contract.md) | **The diagnostics contract** — levels, categories, and no network sink. | ✅ Current — see [F-011](../../features/F-011-diagnostics-and-logging.md). |
| [0021](./0021-sidecar-written-as-changes.md) | **The sidecars are written as changes** to the file as it is, and re-read when someone else changes them — the layout and, since B-018, the comments. | 🟡 Proposed — see [B-014](../../bugs/B-014-the-sidecar-is-written-whole-from-a-stale-copy.md), [B-018](../../bugs/B-018-comments-written-whole-and-read-as-empty.md). |
| [0022](./0022-books-in-the-layout-sidecar.md) | **Books live in the layout sidecar** — presentation, keyed pages with an `order`, references by id, presenting writes nothing. | 🟡 Proposed — see [F-013](../../features/F-013-books.md). |
| [0023](./0023-view-headers-in-the-layout-sidecar.md) | **A view's header lives with the view in the layout sidecar** — title, message, context and a legend computed from what is drawn; drawn in screen space; part of the slide, not of the figure. | 🟡 Proposed — see [F-014](../../features/F-014-self-explaining-views.md). |
| [0024](./0024-history-read-from-git.md) | **What the model was is read from Git, never kept by Stemma** — `git show` through `Stemma.Web`, parsed by the engine's reader, compared in the client; nothing written. | 🟡 Proposed — see [F-017](../../features/F-017-what-changed.md). |
| [0025](./0025-layered-layout-is-a-live-constraint.md) | **A layered layout, solved by ELK in the browser, is a live constraint** — stored as intent, nudged by offsets, the default for a view nobody arranged; edges routed. | 🟡 Proposed — see [F-021](../../features/F-021-layered-layout-and-routed-edges.md). |
| [0026](./0026-views-by-rule.md) | **A view is a scope and rules as well as a list** — `Scope`/`Include`/`Exclude`, two C4 lenses, one selector language, resolved in the engine; implied links derived. | 🟡 Proposed — see [F-023](../../features/F-023-c4-views-and-views-by-rule.md). |
| [0027](./0027-description-and-technology.md) | **Description and technology in the model** — on people, systems and containers; technology on data flows. | 🟡 Proposed — see [F-023](../../features/F-023-c4-views-and-views-by-rule.md). |
| [0028](./0028-architecture-rules-as-code.md) | **Architecture rules are C# in `Rules/`**, read off the syntax tree, never executed; run with the built-in rules. | 🟡 Proposed — see [F-024](../../features/F-024-architecture-rules-as-code.md). |
| [0029](./0029-conformance-against-the-implementation.md) | **Conformance is a rule** — elements mapped to projects; project references compared with declared links; never stored. | 🟡 Proposed — see [F-025](../../features/F-025-conformance-with-the-implementation.md). |
| [0030](./0030-agents-reach-stemma-through-the-cli.md) | **Agents reach Stemma through the CLI**, packaged as a Claude Code plugin; MCP deferred. | 🟡 Proposed — see [F-026](../../features/F-026-stemma-for-claude-code.md). |

## Legend

- ✅ **Current** — actively true; build on it.
- 🟡 **Partial / Directional** — partly realised or aspirational; check before relying.
- 🗄️ **Historical** — superseded by the lean architecture; kept for context, do not build on it.

## When to write a new ADR

Write one when a decision is hard to reverse, affects a boundary (engine purity, model-vs-sidecar,
fidelity), or future contributors will ask "why is it like this?" Reference the ADR from any code or
doc that depends on it. The Software Architect owns this
index.
