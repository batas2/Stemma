# Roadmap

> Horizon framing, not date commitments. "Now" = built and in the product. "Next" = committed and
> in flight. "Later" = directionally agreed, not scheduled. Last reviewed **2026-10-17**.

## Now — shipped and load-bearing

The engine and canvas are real and round-trip against non-trivial samples.

- **Roslyn engine + round-trip fidelity** — operations rewrite `Architecture.cs` via targeted syntax edits, and the fidelity suite gates every one: each operation in the [catalog](../architecture/engine-backend.md#the-operations-catalog), against a minimal, a realistic and a pathological fixture, compared byte for byte with hand-written edits and then undone and redone. (Until 2026-10-17 the suite existed only on paper, and six operations rebuilt whole declarations — [B-009](../bugs/B-009-edits-rebuild-the-declaration.md); undo, outside edits and view saves had the same class of fault — B-006…B-011.)
- **Canonical model** — elements (person, software system, container, bounded context, module, capability, use case, risk, question, assumption, and `Concept` for a box that asserts nothing — [ADR-0018](../architecture/decisions/0018-concept-element-kind.md)), `DataFlow`/`Dependency` links, `Lifecycle`/`Ownership` tags, code-defined `View`s.
- **React Flow canvas** — module map, dependency graph, and custom views; bounded-context grouping; pan/zoom/minimap; PNG/SVG export of the whole graph including shapes, with transparency and scale as remembered options.
- **A published sidecar schema** — `schema/stemma.layout.schema.json` describes `stemma.layout.json` for editors and for anyone authoring the format by hand; every sidecar Stemma creates starts with a `$schema` pointer, and the canvas writes the file as changes — a moved box is one entry in the diff, and a pull made mid-session survives the next edit ([ADR-0021](../architecture/decisions/0021-sidecar-written-as-changes.md)).
- **Committed presentation sidecar** (`stemma.layout.json`) — positions, node/edge styles, notes, custom props, free-form shapes, per-view layout choices; travels in Git. Also carries the per-view layout mode and, where a view has one, a declarative layout constraint with per-node nudges. (Free-form shapes and edge dock handles were dropped before reaching disk until [B-001](../bugs/B-001-layout-sidecar-drops-shapes-and-edge-handles.md) was fixed on 2026-08-08; the layout mode lived only in `localStorage` until the same day, so a fresh clone did not reproduce the author's canvas.)
- **Starting from nothing** ([F-003](../features/F-003-from-scratch-onboarding.md)) — three doors on the start screen (a template, an empty model, an existing repository), a model created *by name* into `~/stemma/<name>` as a clean Git repository, in-canvas guidance instead of a bare grid, create-lands-in-the-name-field, and — once — the line of C# your first box became, quoted from `Architecture.cs`. Three interactions from launch to a model, four to a named element, and no filesystem path typed at any point.
- **Inline + full rich-text editing** — markdown-backed; a simple inline editor and a turbo full-screen editor (headings, lists, tables, color, highlight, code blocks).
- **Appearance system** — node and edge styling (fills, borders, shadows, presets, animations); edge routing (curved / elbow / step / straight); both-end markers.
- **draw.io-style edge docking** — relationships anchor to connection dots; reconnect endpoints to another box. (Anchors were lost on reload until [B-001](../bugs/B-001-layout-sidecar-drops-shapes-and-edge-handles.md) was fixed on 2026-08-08.)
- **Per-view auto-layout** — organic (force-directed), hierarchical, by-type, and custom (manual), each tunable; manual move/add flips a view to custom.
- **Inspector as an icon rail** — one panel at a time (Properties, Appearance, Text & attributes, Lifecycle, Ownership, Custom properties, Comments, Layout).
- **Multi-select / align / distribute**, undo/redo for layout, violations surfacing, live sync via SignalR.
- **Headless CLI** (`src/Stemma.Cli`) — `stemma render` turns a model and a view into an image with no browser open and no mouse; `stemma validate` reports the dangling ids and silently-missing edges the compiler cannot see; `stemma render --check` tells a build when a committed image has stopped matching its model.
- **Installable** ([F-012](../features/F-012-first-release.md)) — 0.1.0 is the first release. `dotnet tool install -g Stemma` for anyone with the .NET 10 SDK, and a one-line install of the self-contained tarball for anyone without; Linux x64 for both. One version, written once and reported by every binary; a tag builds, tests, tries both packages as shipped and drafts the release. Every exported report links back to the project page.
- **A desktop window** ([F-002](../features/F-002-desktop-shell.md), [ADR-0017](../architecture/decisions/0017-desktop-shell-photino.md)) — `stemma-desktop` is one process holding both Kestrel and a native WebKitGTK window, on a port the OS chooses. Closing the window stops the backend because there is nothing else to stop; two windows cannot collide; **Open** is the OS folder picker rather than a typed path; size and maximised state persist. Ships as a self-contained Linux tarball with a `.desktop` entry, so a machine with neither .NET nor Node can run it — combined with the SDK-free load path ([ADR-0016](../architecture/decisions/0016-sdk-free-model-only-workspaces.md)), it can create and open a model with no .NET installed at all.

## Next — committed, in flight

- **The comments sidecar, written as changes** — `comments.stemma.json` is still saved whole from the session's copy (`PUT /api/workspace/comments`), and a comments file that cannot be read is taken for an empty one. That is the class [B-014](../bugs/B-014-the-sidecar-is-written-whole-from-a-stale-copy.md) closed for the layout sidecar, and the same fix applies ([ADR-0021](../architecture/decisions/0021-sidecar-written-as-changes.md)): a comment pulled in mid-session must survive the next one written. First, because "the diff is the edit" is the launch message.
- **Navigation & views clarity** (Epic 13) — faster, more obvious view switching and view management.
- **Inspector & editor polish** — finishing the SSOT-era inspector redesign; accessibility pass (keyboard, focus, reduced-motion, contrast — see [`../ux/states-and-interactions.md`](../ux/states-and-interactions.md)).
- **Release follow-ups** ([F-012](../features/F-012-first-release.md) §9, [B-017](../bugs/B-017-new-model-left-uncommitted-where-git-knows-nobody.md)) — the start screen shows nothing when the new model could not be made a repository (`gitInitialised`/`gitError` are returned and ignored); MSBuild loaded from the SDK (`ExcludeAssets="runtime"`) instead of shipped, which clears the NU1903 advisory; packages for macOS and Windows once someone can try the window there; AppImage only if asked for.
- **Sample gallery** — curated demo workspaces (today `samples/AuroraRail` and `samples/StemmaArchitecture`) that exercise every feature as living documentation.
- **Publication rendering** (*shipped 2026-08-08…11*) — turning a model plus a view into a correct image without a human touching a mouse: a `stemma render` CLI, a publication profile and palettes, layout expressed as a constraint rather than as dragged coordinates, a documented sidecar format and protocol reference, true vector SVG, a render manifest with `--check`, and the `Concept`/`Relation` kinds (ADR-0018, ADR-0019). Serves the **Essayist's Agent** persona, and is the projection half of "the diagram *is* the code". Records F-004…F-010, all shipped. Outstanding and small: an embedded or outlined font in the SVG (F-009 AC5), a keyboard path to the constraint panel, and a figure-shaped sample. The gap analysis, the six decisions behind it and the phasing are in [`agent-authored-diagrams.md`](./agent-authored-diagrams.md).

## Later — directional

- **Additional projections** — Mermaid/PlantUML export, a code-preview pane.
- **Collaboration** — Git-backed sessions (session = branch; save = commit), conflict surfacing on external edits.
- **Validation depth** — background compilation, richer architecture-rule checks surfaced inline.
- **Search & filter on the canvas**, deep-linkable views.
- **Broader vision items** (from the archived `VISION`/`ROADMAP`): heterogeneous storage adapters and a richer projection layer are *aspirational*; the current engine is intentionally lean (single Roslyn adapter + presentation sidecar). Re-open these only when a concrete user need demands them.

## Commercial direction

How Stemma could earn as a side income — local-first tool, paid sharing layer — lives in
[`commercialization.md`](./commercialization.md) (working plan with open decision points).

## How roadmap items become work

A "Later" item earns a feature record (`features/`) using
[`../templates/feature-template.md`](../templates/feature-template.md) once it has a named persona,
a problem statement, and an architecture/UX/UI impact assessment. Nothing graduates to "Next"
without that record.
