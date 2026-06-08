# Glossary

The shared vocabulary. When a term here appears in code or docs, it means exactly this.

## Model concepts

- **Canonical model** — the single in-memory model loaded from source; the source of truth. Everyone
  else gets *projections* of it.
- **Element** — a node in the model: `Person`, `SoftwareSystem`, `Container`, `BoundedContext`,
  `Module`, `Capability`, `UseCase`, `Risk`, `Question`, `Assumption`.
- **Bounded Context (BC)** — a DDD grouping lane; modules nest visually under it.
- **Module** — a unit of cohesion inside a BC (often a code project/feature slice).
- **Container** — a C4 deployable unit inside a software system (`service`, `worker`, `cronjob`,
  `job`, `tool`, `db`).
- **Capability** — a business capability.
- **DataFlow** — a relationship carrying a `Payload` (the message/call shown as the edge label).
- **Dependency** — a structural relationship with a `Kind` (`uses`, `calls`, `reads`, `publishes`…).
- **Tag** — `Lifecycle` and/or `Ownership` attached to an element/link by id via `Tag.For(...)`.
- **Lifecycle** — status (`current`/`target`/`to-adapt`/`to-be-created`/`deprecated`/`proposed`/…) +
  phase; renders as a badge.
- **Ownership** — squad/domain (+ RAPID roles); renders as a badge.
- **Risk / Question / Assumption** — design concerns; `AboutId` links each to the element it concerns
  (rendered as a dotted "about" edge).
- **View** — a named subset of the model with a base lens; lives in `Views/<Name>.cs` via `Define()`.
- **Base lens / base view** — `moduleMap` (BC lanes + nested modules), `dependencyGraph` (layered,
  fan-in/out), or `all`.

## Engine concepts

- **Operation** — the model-edit primitive: polymorphic JSON → a targeted Roslyn rewrite.
- **Round-trip fidelity** — the contract that a UI edit yields a diff containing *only* the intended
  change.
- **Trivia** — whitespace, comments, blank lines, regions, directives, attribute/`using`/member
  order, line endings — everything outside the targeted syntax that must be preserved.
- **DSL** — the C# record vocabulary architects write; the Architecture entry point is `Build()`,
  view entry points are `Define()`.
- **Delta** — the change broadcast to clients after an operation is applied.

## Presentation concepts

- **Presentation sidecar** — `verso.layout.json`: committed, presentation-only state (positions,
  styles, notes, custom props, shapes, per-view layout). Never holds model data.
- **Sidecar cache** — the single in-memory cache (`lib/layout.ts`) that owns presentation during a
  session; primed once, debounce-flushed, never re-fetched mid-session.
- **Layout mode** — a view's auto-layout choice (Organic / Hierarchical / By-type / Custom),
  remembered per view; a manual move/add flips it to Custom.
- **Dock handle** — one of the 6 connection dots on a node where relationships anchor.
- **Waypoint** — a user-placed bend point on a relationship.
- **Shape / annotation** — free-form drawing on the canvas (rect/ellipse/triangle/label/arrow/image);
  presentation, stored per view.

## Process concepts

- **Pillar** — one of Product / Architecture / UX / UI; every change is reviewed against all four.
- **SSOT** — Single Source of Truth: this `.doc/` directory.
- **Legacy docs** — the archived pre-refactor docs under `../../.doc.legacy/`, kept for reference,
  not authoritative.
