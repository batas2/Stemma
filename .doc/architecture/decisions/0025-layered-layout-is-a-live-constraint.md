# ADR-0025: A layered layout, solved by ELK in the browser, is a live constraint

| Field | Value |
|---|---|
| **Status** | `Proposed` |
| **Date** | 2026-10-22 |
| **Deciders** | Bartosz |

## Context

An agent writing an architecture of fifteen or more elements gets a readable picture only if Stemma
lays it out and routes its edges; it is bad at coordinates and cannot see crossings
([`agent-architecture-workflow.md`](../../product/agent-architecture-workflow.md) §1–§2). Stemma has
two kinds of layout today, split by [`agent-authored-diagrams.md`](../../product/agent-authored-diagrams.md)
§8 · Q6:

- **Constraints** — grid, row, column, stack: deterministic, stored as intent, solved on every open,
  adjusted by per-node offsets, never baked.
- **Generators** — force, hierarchical, by-type: heuristic, run once from the Layout panel, their result
  baked into absolute positions, because a picture that re-arranges when an algorithm is tuned lies.

Neither routes an edge. The hand-written hierarchical generator is not given the links when it is the
default (B-021) and cannot draw a boundary. What an agent needs is what Mermaid and D2 get from
dagre/ELK: layers that follow the flow, compound nodes for boundaries, and orthogonal edges routed
around cards with their labels.

## Decision

1. **A new constraint kind, `layered`, solved by ELK's layered algorithm** (`elkjs`, pinned). It is a
   *constraint* under Q6's own test — the same graph, sizes and options give the same picture — so it
   is stored as intent (`{ "kind": "layered", "direction": "down", … }`), solved live on every open,
   nudged with offsets, and never baked. The force-directed generator stays a generator.
2. **It runs in the browser, in the canvas**, like the other constraints. The app and the render are one
   renderer (Q2); a layout computed anywhere else would be a second truth. The headless render waits
   for it through the readiness contract.
3. **Determinism is engineered, not assumed.** Nodes and edges are given to ELK in the order the model
   declares them, with `considerModelOrder` and a fixed seed; sizes are the measured card sizes,
   rounded; the ELK version is pinned in `package.json` and, through the lockfile, in the build the
   render manifest fingerprints. An ELK upgrade is a change to every unarranged picture and is reviewed
   as one.
4. **Edges get routes.** ELK's orthogonal routes and label positions are drawn by the canvas and are,
   like solved positions, derived, never committed. An edge touching a nudged card falls back to the
   view's ordinary routing.
5. **It is the default for a view nobody arranged** — no `layout`, no saved position for any member.
   Nothing is written on open; the first drag materialises the default as an explicit constraint.
6. **Boundaries are groups.** With `groups` (default on), a bounded context and its modules, and a
   software system and its containers, are laid out as compound nodes, and the system is drawn as a
   frame like a context — so a C4 container view gets its boundary.
7. **Lazy.** ELK is loaded as its own chunk the first time a view needs it; a workspace whose views are
   all arranged never loads it.

## Consequences

- **Positive:** an agent never has to author a coordinate; the default picture follows the flows;
  boundaries and routed edges come with it. Grid/row/column keep their place for the seven-box figure
  whose arrangement *is* the argument.
- **Negative / trade-offs:** a ~1.4 MB dependency (lazily loaded); an ELK upgrade can move every
  unarranged view; a nudged card loses its routed edges until the nudge is reset.
- **Neutral:** `layoutMode` keeps meaning "what the Layout panel remembers" (B-022). The hand-written
  hierarchical generator remains for the panel, given the links.

## Alternatives considered

- **dagre** — smaller, but no compound nodes, no orthogonal routing with labels as obstacles, no model
  order; it would fix layering and leave A4, A5 and A7.
- **ELK as a generator (bake the result)** — loses the property that makes an unarranged view correct
  after the model changes: adding a container would leave the new one wherever the fallback put it.
- **Server-side layout (ELK in Java, or Graphviz)** — a second renderer's worth of divergence: sizes
  would be estimated, not measured, and Q2 rejects it for the same reason.
- **Keep improving `autoLayout.ts`** — it would take a router, compound layout and crossing minimisation
  to match; that is ELK, rewritten.

## Relationship to the inviolable rules

Presentation only: one more constraint kind in the sidecar, solved in the client. No source is
rewritten; the engine is untouched; no new store — routes and positions are derived. `elkjs` is used
under EPL-2.0: its files are unmodified and its notice ships with the client bundle.

## References

- [F-021](../../features/F-021-layered-layout-and-routed-edges.md), [B-021](../../bugs/B-021-default-arrangement-ignores-links.md), [B-022](../../bugs/B-022-layout-mode-promised-to-run-on-open.md)
- `src/Stemma.Web.Client/src/lib/layoutDsl.ts` (the Q6 split, in its header)
- [Eclipse Layout Kernel — layered algorithm options](https://eclipse.dev/elk/reference/algorithms/org-eclipse-elk-layered.html)
