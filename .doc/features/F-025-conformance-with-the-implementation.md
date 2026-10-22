# Feature: Conformance with the implementation

| Field | Value |
|---|---|
| **ID** | F-025 |
| **Status** | In progress — built and dogfooded; awaiting review |
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

- [x] **AC1 — A map, in the rules.** In a `Rules/*.cs` file, `Code.At("<path>")` names where the
  implementation lives (relative to the workspace; default the workspace itself), and
  `Code.Map("<element id>", "<path>")` says which project — a `.csproj`, or a folder whose projects all
  belong to the element — implements a container or a module.
- [x] **AC2 — The comparison** ([ADR-0029](../architecture/decisions/0029-conformance-against-the-implementation.md)).
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
- [x] **AC3 — Shown and reported.** On the canvas through the violations surface, and by `validate` —
  the same findings, recomputed, never stored.
- [x] **AC4 — Start from the code.** `stemma scan <path> [--json]` lists the projects under a path — name,
  path, output kind, target framework — and their project references: the material an agent reads to
  propose containers and the `Code.Map` that ties them to their projects.
- [x] **AC5 — Cheap.** Project files are read again only when they change (by modification time), so the
  canvas's violations poll does not parse the solution every second.
- [x] **AC6 — Dogfooded.** `samples/StemmaArchitecture` maps its containers and modules to Stemma's own
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

- [x] `ProjectGraph` — projects found under a folder (not in `bin`/`obj`), references resolved relative
  to the referencing project, a reference to a project outside the tree kept as external.
- [x] `ConformanceCheck` — each finding on a temporary tree of three projects.
- [x] `ScanCommand` — text and JSON output.
- [x] `WorkspaceCheckTests` — conformance findings through `validate`.
- [x] The self-model sample: `validate` clean against this repository.

## 8. Definition of Done

- [ ] All ACs met and demoed
- [x] `dotnet test` green
- [x] No new data store
- [x] Docs: protocol (rules section), `domain-model.md`, engine-backend
- [ ] Reviewed against all four pillars

## 9. Notes / open questions

- **Direction.** A `ProjectReference` A → B means A depends on B, which is what a `Dependency` A → B
  says. A `DataFlow` A → B also counts as declaring the relationship (a caller usually references its
  client library), so an architecture written only in data flows does not drown in findings.
- **Other ecosystems** (package.json workspaces, Go modules, docker-compose `depends_on`) fit the same
  `ProjectGraph` shape and are the obvious next readers.

## 10. Implementation notes

Where the record left a call open, this is the call made.

- **Where the code is.** `src/Stemma.Model/Rules.cs` (`Code`, `CodeRoot`, `CodeMap`);
  `src/Stemma.Engine/Conformance/ProjectGraph.cs` and `ConformanceCheck.cs`, joined to the `RuleEngine` by
  `Validation/WorkspaceRules.cs` when a rules file writes `Code.At` or `Code.Map`; `src/Stemma.Cli/ScanCommand.cs`.
- **Paths.** `Code.At` is relative to the workspace (default: the workspace); `Code.Map` paths are relative
  to `Code.At`, as the agents' reference teaches. An element may be mapped more than once, and its projects
  are the union. A map of any element kind is accepted. A map naming an id the model does not have is
  `rule/dangling-id`, not a conformance finding.
- **Reading project files.** XML through `System.Xml.Linq`, element names compared without the MSBuild
  namespace so old-style projects read too. `Include` is split on `;`, its separators normalised, and
  resolved against the project's folder; a property in it is left as written. A conditional reference
  counts. The one thing read from outside a project is its target framework from the nearest
  `Directory.Build.props` when it names none — this repository puts it there. `OutputType` is as written,
  else `Exe` for a `.Web` or `.Worker` SDK, else `Library`; the SDK is reported too. A reference is
  `external` in `stemma scan` when it leads out of the tree scanned. Paths compare case-insensitively on
  Windows and macOS.
- **Cheap.** Each project file is parsed again only when its time or length changes (a test holds this by
  rewriting a file with its old time and length). The folders are walked on every ask, which is the same
  order of cost as the watcher's poll.
- **The comparison.** One `undeclared-dependency` per pair of elements, naming the first pair of projects
  and counting the rest. A project mapped to two elements is left out of that comparison
  (`ambiguous-map` says so) but still realises a dependency of either. `unrealised-dependency` is said
  only when both ends have mapped projects. `missing-code` also covers a mapped file that is not a
  `.csproj` and a project file that is not readable XML. `unmapped-project` is one finding — ten named,
  then a count — and is not given while any map points at nothing: that is what a copy of the workspace
  taken away from its code looks like, and walking whatever happens to sit at `Code.At` then (the root of
  a temporary directory, in the journey tests' copies of the self-model) is neither useful nor cheap.
- **`stemma scan`.** The path is optional and defaults to the current directory, like every other command's;
  a path that does not exist is exit 2, a folder that cannot be read exit 3. Text lists each project with
  its output type, frameworks and path, its references under it; `--json` gives `root` and, per project,
  `name`, `path` (relative, `/`), `sdk`, `outputType`, `targetFrameworks`, `references` (`name`, `path`,
  `external`) and `problem`.
- **Dogfood.** `samples/StemmaArchitecture/Rules/Code.cs` maps `cnt_web`, `cnt_cli`, `cnt_desktop`,
  `mod_engine` and `mod_concepts` to `src/Stemma.Web`, `src/Stemma.Cli`, `src/Stemma.Desktop`,
  `src/Stemma.Engine` and `src/Stemma.Model`, under `Code.At("../..")`. The canvas is TypeScript and is not
  mapped; the engine's modules share one project, mapped to the façade. The first run found two references
  the model did not declare, and the model now has them: `dep_cli_engine` (`cnt_cli` → `mod_engine`) and
  `dep_engine_concepts` (`mod_engine` → `mod_concepts`). The test projects and the samples are reported as
  unmapped (info). The package smoke test copies the sample away from the repository, so it drops
  `Rules/Code.cs` from its copy.
