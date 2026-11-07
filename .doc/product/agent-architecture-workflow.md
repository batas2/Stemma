# Agent-Built Architecture, Reviewed in Stemma

> Audit and programme: what Stemma needs before a coding agent (Claude Code, or anything with a
> shell) can build an architecture from a prompt as fluently as it draws one in Mermaid or draw.io —
> and before the human who receives it can review, check and present it in Stemma.
> Written **2026-10-22** against `master` (`7264f79`). Feature records it spawned are in §6.

## 0. Why this document exists

[`agent-authored-diagrams.md`](./agent-authored-diagrams.md) closed the gap for one agent workload:
a seven-box argument diagram for an essay, laid out by hand as a grid and rendered headlessly. That
work shipped. This document is about the workload that followed it and is now the more common one:

> *"Design the architecture for X. Show the containers and how an order flows."*

An agent working in a repository is asked for an architecture — fifteen to forty elements, typed,
with flows — and the person who asked reviews it, argues with it, and then presents it to the team
that will build it. Today that agent reaches for Mermaid, because the picture comes out readable on
the first try. In Stemma it does not, and this document says precisely why and what was done about
it.

### The new persona

> **The Architect's Agent ("Theo").** A coding agent in the architect's own repository. It is given
> a prompt, an existing system to describe, or both. It writes the model, the views and the checks;
> it renders the result to look at its own work; and it hands over to a human who opens the same
> files in Stemma, comments on what is wrong, and presents what is right. Theo succeeds when the
> first render is readable without anyone placing a box, when the model can be checked against what
> the architect said must hold, and when the human's review comes back to it as work to do.

Theo differs from Ada in three ways that change the requirements: the diagrams are large enough that
hand-placing is not an option; the model is real architecture whose rules matter; and there is a
human in the loop who reviews in the app.

## 1. The audit — what happened when an agent built one

A food-delivery platform was built exactly as an agent would build it, from the protocol reference
and the CLI alone: three people, eleven containers, three external systems, seventeen data flows,
one container view. Everything below was observed on that workspace and two smaller probes.

| # | Observation | Cause |
|---|---|---|
| A1 | The model was right first time: `stemma validate` reported no errors. Writing C# was not the problem. | — |
| A2 | Rendered with no `layout`, seventeen boxes came out in **one row**, people above, edges drawn through the boxes between their ends. | The default arrangement is `layoutHierarchical(elements, [])` — called **without the links** (`ArchCanvas.tsx:167`), so it can only tier by kind. [B-021](../bugs/B-021-default-arrangement-ignores-links.md) |
| A3 | `"layoutMode": "hierarchical"` in the sidecar changed nothing, in the app or the render — though the protocol says it re-arranges the view on open. | Generators run only from the Layout panel's button (`ArchCanvas.tsx:2296`). [B-022](../bugs/B-022-layout-mode-promised-to-run-on-open.md) |
| A4 | A hand-written six-column grid placed the boxes sensibly, but every edge is a Bézier between left and right dots: lines cross boxes, labels collide (`"assignments"` over `"status events"`). | There is no router. Edges dock on fixed sides and ignore what lies between. |
| A5 | A back edge in a row (C → A past B) is **invisible**: drawn straight through B, on top of the A → B line, its label hidden under B. | Same. Nothing reports it, so an agent cannot know. |
| A6 | Under the publication profile every line that passes under a card **strikes through its text**. | Publication cards have no fill (by design — the page shows through), and nothing keeps a line out of a card. [B-023](../bugs/B-023-publication-cards-let-lines-through-their-text.md) |
| A7 | The containers were not drawn inside their system. A C4 container diagram without its boundary reads as wrong to any architect. | Only a bounded context frames its children, and only modules. |
| A8 | `validate` warned `view/busy` — seventeen elements, "past 7 a diagram has usually stopped answering one question". | The essay rule applies to every view. [B-024](../bugs/B-024-busy-warning-on-every-architecture-view.md) |
| A9 | An element declared but left out of `Model.Of(...)` was drawn, and nothing said that the compiled model lacks it. | The reader reads declarations; the compiler reads `Model.Of`. [B-025](../bugs/B-025-element-left-out-of-model-of-is-unannounced.md) |
| A10 | `validate` did not report a data-flow cycle that the canvas marks in red. | The CLI never runs the engine's `RuleEngine`. [B-026](../bugs/B-026-validate-does-not-run-the-engine-rules.md) |
| A11 | There is no way to say what *must* hold — "only Payments talks to Stripe", "UIs go through the gateway". The only checks are id integrity and cycles. | No rule vocabulary. |
| A12 | Every view must enumerate its member ids; the container view listed seventeen, and a missed id silently drops an arrow (`view/half-link`). | Views are lists, not rules. |

**The diagnosis.** Stemma lost to Mermaid on exactly one axis — *the picture* — and on that axis it
lost badly: no automatic layout an agent can rely on, no routing, and no way for the agent to know
its picture was bad. On every other axis it was already ahead: typed vocabulary, views as code,
validation, a canvas a human can review in, and history from Git.

## 2. The research — what the field learned

The findings that shaped the decisions, with their sources:

1. **Everyone who let an LLM author coordinates retreated to automatic layout.** draw.io's own MCP
   server added ELK layout and libavoid routing as passes after generation
   ([jgraph/drawio-mcp](https://github.com/jgraph/drawio-mcp)); community Excalidraw servers give
   placement to a Sugiyama pass so "the AI never touches coordinates". Mermaid's quality *is*
   dagre/ELK's quality; D2 bundles ELK and, since v0.9, TALA. **This is A2–A5.**
2. **A validator loop solves syntax; the failures that remain are meaning and layout.** DiagramAgent
   (CVPR 2025) tops out at 58% pass@1 even with a check agent; a C4 study found cross-view naming
   consistency of 8–82%, because "agents lack a common, persistent data structure on which to ground
   nomenclature" ([arXiv 2510.22787](https://arxiv.org/html/2510.22787v1)). A typed model on disk is
   that structure — Stemma's thesis, measured from the other side.
3. **Vision models cannot be trusted to count crossings.** 41–76% accuracy on telling 0, 1 or 2
   line intersections apart ([arXiv 2407.06581](https://arxiv.org/abs/2407.06581)). tldraw's agent
   kit pairs the screenshot with structured shape data and lints
   ([tldraw starter kit](https://tldraw.dev/starter-kits/agent)). Geometry computed by the renderer
   is exact and cheap; looking is the last check, not the first.
4. **Architecture-as-code tools converge on: one model, views by selection, checks as code.**
   Structurizr's views `include *`; LikeC4's views are include/exclude predicates and its custom
   rules are tests over the model API ([likec4.dev](https://likec4.dev/guides/validate-your-model/));
   Structurizr sells its C4 hierarchy enforcement as a guardrail for LLMs
   ([docs.structurizr.com/ai](https://docs.structurizr.com/ai)). **This is A7, A11, A12.**
5. **Fitness functions belong with the architecture, and drift is the payoff.** ArchUnit,
   NetArchTest, jQAssistant; the Thoughtworks Radar (April 2026) puts *architecture drift reduction
   with LLMs* in Assess, pairing deterministic checks with LLM explanation, and *feedback sensors for
   coding agents* in Trial — deterministic checks that run during the session.
6. **For a coding agent, a CLI plus a skill beats an MCP server.** Claude Code's documentation calls
   CLI tools "the most context-efficient way to interact with external services"; LikeC4 ships an
   agent skill; draw.io ships a Claude Code plugin. MCP earns its place when the client cannot run a
   shell, or when a rendered image must come back as a tool result.

## 3. What this changes about the earlier decisions

[`agent-authored-diagrams.md`](./agent-authored-diagrams.md) §8 · Q6 split layouts into
*constraints* (deterministic, live, adjusted by offsets) and *generators* (heuristic, one-shot,
baked). The split stands, and its one-line test — *if re-running it tomorrow must give the same
picture, it is a constraint* — is what admits ELK's layered algorithm **as a constraint**: given the
same graph, the same sizes and a pinned version it gives the same picture, so it is solved live like
a grid and never baked. That is [ADR-0025](../architecture/decisions/0025-layered-layout-is-a-live-constraint.md).
The force-directed generator stays a generator.

Q2 (one renderer, the browser) holds and is relied on: ELK runs in the page, so the app and the
render cannot disagree. Q3 (`Concept`, no user-defined kinds) holds: C4 gains two fields, not kinds.

## 4. The programme

Seven pieces, chosen by the maintainer on 2026-10-22 from eight proposed (the review loop over
comments was left for later). Ordered by what each unblocks.

| # | Piece | Record | Why |
|---|---|---|---|
| 1 | **Fix what the audit found** — default arrangement, the inert `layoutMode`, struck-through publication cards, the busy warning, `Model.Of`, validate without the engine's rules | B-021 … B-026 | Days of work; each one cost the agent a wrong picture or a missed problem. |
| 2 | **Layered layout and routed edges** — ELK in the browser; a `layered` constraint; the default for a view nobody has arranged | [F-021](../features/F-021-layered-layout-and-routed-edges.md), [ADR-0025](../architecture/decisions/0025-layered-layout-is-a-live-constraint.md) | The axis Mermaid wins on. Nothing else matters to Theo until this does. |
| 3 | **The render says what is wrong with the picture** — geometry and a layout lint in the manifest and on stdout | [F-022](../features/F-022-render-geometry-and-layout-lint.md) | An agent cannot see crossings; the renderer can measure them. |
| 4 | **Stemma for Claude Code** — a plugin: a skill, three commands, a hook that validates after every edit | [F-026](../features/F-026-stemma-for-claude-code.md), [ADR-0030](../architecture/decisions/0030-agents-reach-stemma-through-the-cli.md) | The workflow, packaged where the agent already works. |
| 5 | **C4 views and views by rule** — system context and container lenses with boundaries; `Include`/`Exclude` selectors; description and technology | [F-023](../features/F-023-c4-views-and-views-by-rule.md), [ADR-0026](../architecture/decisions/0026-views-by-rule.md), [ADR-0027](../architecture/decisions/0027-description-and-technology.md) | The vocabulary architects expect, and no more seventeen-id lists. |
| 6 | **Architecture rules as code** — `Rules/*.cs`: forbid, only, layers, require; a C4 pack | [F-024](../features/F-024-architecture-rules-as-code.md), [ADR-0028](../architecture/decisions/0028-architecture-rules-as-code.md) | Validation of the design, not of the syntax. |
| 7 | **Conformance with the implementation** — map elements to projects; compare declared links with project references; `stemma scan` to start from code | [F-025](../features/F-025-conformance-with-the-implementation.md), [ADR-0029](../architecture/decisions/0029-conformance-against-the-implementation.md) | "The diagram cannot lie", extended from the picture to the code it describes. |

**Not chosen, recorded so it is not lost:** the review loop — the agent reading open comments from
`comments.stemma.json` as its to-do list, replying and resolving, with a semantic `stemma diff`
for the pull request. Every piece it needs exists (comments, What changed, the watcher).
*Built 2026-11-07* as [F-027](../features/F-027-the-review-loop.md).

## 5. What stays true

Checked against the inviolable rules in [`../engineering/conventions.md`](../engineering/conventions.md):

- **No new data store.** Rules and code maps are C# in the workspace, read off the syntax tree like
  views. Layout options are presentation in the sidecar. Geometry and lint are render output, beside
  the image in the manifest. Conformance results are computed and never kept.
- **Engine purity.** ELK is browser code; the engine gains a selector evaluator, a rules reader and
  a project-reference reader (`System.Xml.Linq`), nothing web-shaped.
- **Fidelity.** The new model fields are edited through the existing `SetElementAttribute` /
  `SetLinkAttribute` operations, each with minimal / realistic / pathological fixtures. A view's new
  arguments are edited in place by `ViewsAdapter.Edit`, like its members. Rules and code maps are
  read-only to the engine.
- **No new DSL.** The audit's first finding is that the agent wrote correct C# first time. Every
  addition is a parameter, a lens name or a selector string inside the C# it already writes.

## 6. Records

| Record | Title |
|---|---|
| [B-021](../bugs/B-021-default-arrangement-ignores-links.md) | A view nobody arranged is drawn in one long row |
| [B-022](../bugs/B-022-layout-mode-promised-to-run-on-open.md) | The protocol promises `layoutMode` re-arranges a view on open; it never has |
| [B-023](../bugs/B-023-publication-cards-let-lines-through-their-text.md) | Publication cards let a line run through their text |
| [B-024](../bugs/B-024-busy-warning-on-every-architecture-view.md) | `view/busy` warns on every architecture view |
| [B-025](../bugs/B-025-element-left-out-of-model-of-is-unannounced.md) | An element left out of `Model.Of` is drawn, and nothing says the compiled model lacks it |
| [B-026](../bugs/B-026-validate-does-not-run-the-engine-rules.md) | `validate` does not run the rules the canvas shows |
| [F-021](../features/F-021-layered-layout-and-routed-edges.md) | Layered layout and routed edges |
| [F-022](../features/F-022-render-geometry-and-layout-lint.md) | The render says what is wrong with the picture |
| [F-023](../features/F-023-c4-views-and-views-by-rule.md) | C4 views and views by rule |
| [F-024](../features/F-024-architecture-rules-as-code.md) | Architecture rules as code |
| [F-025](../features/F-025-conformance-with-the-implementation.md) | Conformance with the implementation |
| [F-026](../features/F-026-stemma-for-claude-code.md) | Stemma for Claude Code |
