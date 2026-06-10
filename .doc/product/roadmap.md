# Roadmap

> Horizon framing, not date commitments. "Now" = built and in the product. "Next" = committed and
> in flight. "Later" = directionally agreed, not scheduled. Last reviewed **2026-06-08**.

## Now — shipped and load-bearing

The engine and canvas are real and round-trip against non-trivial samples.

- **Roslyn engine + round-trip fidelity** — operations rewrite `Architecture.cs` via `DocumentEditor`; the fidelity test suite gates every change.
- **Canonical model** — elements (person, software system, container, bounded context, module, capability, use case, risk, question, assumption), `DataFlow`/`Dependency` links, `Lifecycle`/`Ownership` tags, code-defined `View`s.
- **React Flow canvas** — module map, dependency graph, and custom views; bounded-context grouping; pan/zoom/minimap; PNG/SVG export of the whole graph including shapes.
- **Committed presentation sidecar** (`verso.layout.json`) — positions, node/edge styles, notes, custom props, free-form shapes, per-view layout choices; travels in Git.
- **Inline + full rich-text editing** — markdown-backed; a simple inline editor and a turbo full-screen editor (headings, lists, tables, color, highlight, code blocks).
- **Appearance system** — node and edge styling (fills, borders, shadows, presets, animations); edge routing (curved / elbow / step / straight); both-end markers.
- **draw.io-style edge docking** — relationships anchor to connection dots; reconnect endpoints to another box.
- **Per-view auto-layout** — organic (force-directed), hierarchical, by-type, and custom (manual), each tunable; manual move/add flips a view to custom.
- **Inspector as an icon rail** — one panel at a time (Properties, Appearance, Text & attributes, Lifecycle, Ownership, Custom properties, Comments, Layout).
- **Multi-select / align / distribute**, undo/redo for layout, violations surfacing, live sync via SignalR.

## Next — committed, in flight

- **Fidelity hardening across the operation catalog** — every operation in the catalog has minimal/realistic/pathological round-trip fixtures.
- **Navigation & views clarity** (Epic 13) — faster, more obvious view switching and view management.
- **Inspector & editor polish** — finishing the SSOT-era inspector redesign; accessibility pass (keyboard, focus, reduced-motion, contrast — see [`../ux/states-and-interactions.md`](../ux/states-and-interactions.md)).
- **Sample gallery** — curated demo workspaces (e.g. `samples/NetworkAggregation`) that exercise every feature as living documentation.

## Later — directional

- **Additional projections** — Mermaid/PlantUML export, a code-preview pane.
- **Collaboration** — Git-backed sessions (session = branch; save = commit), conflict surfacing on external edits.
- **Validation depth** — background compilation, richer architecture-rule checks surfaced inline.
- **Search & filter on the canvas**, deep-linkable views.
- **Broader vision items** (from the archived `VISION`/`ROADMAP`): heterogeneous storage adapters and a richer projection layer are *aspirational*; the current engine is intentionally lean (single Roslyn adapter + presentation sidecar). Re-open these only when a concrete user need demands them.

## Commercial direction

How Verso could earn as a side income — local-first tool, paid sharing layer — lives in
[`commercialization.md`](./commercialization.md) (working plan with open decision points).

## How roadmap items become work

A "Later" item earns a feature record (`features/`) using
[`../templates/feature-template.md`](../templates/feature-template.md) once it has a named persona,
a problem statement, and an architecture/UX/UI impact assessment. Nothing graduates to "Next"
without that record.
