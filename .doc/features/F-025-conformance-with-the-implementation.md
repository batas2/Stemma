# Feature: Conformance with the implementation

| Field | Value |
|---|---|
| **ID** | F-025 |
| **Status** | In progress |
| **Owner** | Bartosz |
| **Persona served** | The Architect's Agent ("Theo"); Senior Engineer ("Sam") |
| **Roadmap horizon** | Next |
| **Created / Updated** | 2026-10-22 / 2026-10-22 |

## 1. Product — why

- **Problem:** Stemma proves a picture matches its model (F-008). Nothing proves the model matches the
  system. A container diagram that says *Orders does not depend on Dispatch* while `Orders.csproj`
  references `Dispatch.csproj` is a diagram that lies — the failure Stemma exists to abolish, one level
  down. And an agent asked to *describe the system we have* has no structured way to read it.
- **Why now:** agents now write both the code and the architecture; drift between them arrives at the
  speed of the agent. The Thoughtworks Radar (April 2026) lists *architecture drift reduction with
  LLMs* — deterministic checks, LLM explanation — as the technique to assess.
- **Value:** *the diagram cannot lie about the code either.* And the starting point for an as-is model
  is a command, not an afternoon.
- **Out of scope:** languages other than C#/.NET in this version; type-level analysis inside a project
  (NetArchTest's job); runtime calls (HTTP, queues) — a `DataFlow` is not something project references
  can confirm or refute.

## 2. User story & acceptance criteria

> As **an architect whose agent changes both code and model**, I want **Stemma to tell me where the
> model and the projects disagree** so that **the picture I present is the system that exists**.

- [ ] **AC1 — A map, in the rules.** In a `Rules/*.cs` file, `Code.At("<path>")` names where the
  implementation lives (relative to the workspace; default the workspace itself), and
  `Code.Map("<element id>", "<path>")` says which project — a `.csproj`, or a folder whose projects all
  belong to the element — implements a container or a module.
- [ ] **AC2 — The comparison** ([ADR-0029](../architecture/decisions/0029-conformance-against-the-implementation.md)).
  A `ProjectReference` from a project of A to a project of B (A and B mapped, different) is a
  relationship in the code. Then:
  - `conformance/undeclared-dependency` (warning) — the code has A → B and the model has no data flow or
    dependency from A to B. Names both projects.
  - `conformance/unrealised-dependency` (info) — the model has a `Dependency` A → B and no project of A
    references a project of B.
  - `conformance/missing-code` (error) — a mapped path does not exist or holds no project.
  - `conformance/ambiguous-map` (warning) — one project mapped to two elements.
  - `conformance/unmapped-project` (info) — a project under `Code.At` that nothing maps (at most ten
    named, then a count).
- [ ] **AC3 — Shown and reported.** On the canvas through the violations surface, and by `validate` —
  the same findings, recomputed, never stored.
- [ ] **AC4 — Start from the code.** `stemma scan <path> [--json]` lists the projects under a path — name,
  path, output kind, target framework — and their project references: the material an agent reads to
  propose containers and the `Code.Map` that ties them to their projects.
- [ ] **AC5 — Cheap.** Project files are read again only when they change (by modification time), so the
  canvas's violations poll does not parse the solution every second.
- [ ] **AC6 — Dogfooded.** `samples/StemmaArchitecture` maps its containers and modules to Stemma's own
  projects, and `validate` against this repository reports no undeclared dependency.

## 3. Architecture impact

- [x] **Model or presentation?** Model: the map is C# in `Rules/`, read off the syntax tree.
- [x] **New/changed operations:** none.
- [x] **Fidelity:** untouched.
- [x] **Engine purity:** project files are read as XML (`System.Xml.Linq`); no MSBuild evaluation, no
  network, nothing web-shaped.
- [x] **Sidecar:** none; results are never kept (no third store).
- [x] **ADR needed?** [ADR-0029](../architecture/decisions/0029-conformance-against-the-implementation.md).
- **Affected files/areas:** `src/Stemma.Model/Rules.cs` (`Code`); `src/Stemma.Engine/Conformance/`
  (`ProjectGraph.cs`, `ConformanceCheck.cs`); the declared-rules reader; `RuleEngine`;
  `src/Stemma.Cli/ScanCommand.cs` (new), `WorkspaceCheck.cs`; `samples/StemmaArchitecture/Rules/`.

## 4. UX impact

- [x] **Journey(s) touched:** reading violations; starting a model from an existing system (agent).
- [x] **States defined:** an implementation path that does not exist is an error on the map, not silence.
- [x] **Interactions:** none new in the app.
- [x] **Accessibility:** unchanged.

## 5. UI impact

- [x] None beyond the violations panel showing the new rule ids.

## 6. Technical prerequisites & dependencies

- [x] F-024's rules reader and violations path.

## 7. Test plan

- [ ] `ProjectGraph` — projects found under a folder (not in `bin`/`obj`), references resolved relative
  to the referencing project, a reference to a project outside the tree kept as external.
- [ ] `ConformanceCheck` — each finding on a temporary tree of three projects.
- [ ] `ScanCommand` — text and JSON output.
- [ ] `WorkspaceCheckTests` — conformance findings through `validate`.
- [ ] The self-model sample: `validate` clean against this repository.

## 8. Definition of Done

- [ ] All ACs met and demoed
- [ ] `dotnet test` green
- [ ] No new data store
- [ ] Docs: protocol (rules section), `domain-model.md`, engine-backend
- [ ] Reviewed against all four pillars

## 9. Notes / open questions

- **Direction.** A `ProjectReference` A → B means A depends on B, which is what a `Dependency` A → B
  says. A `DataFlow` A → B also counts as declaring the relationship (a caller usually references its
  client library), so an architecture written only in data flows does not drown in findings.
- **Other ecosystems** (package.json workspaces, Go modules, docker-compose `depends_on`) fit the same
  `ProjectGraph` shape and are the obvious next readers.
