# ADR-0029: Conformance is a rule: elements are mapped to projects in `Rules/`, and project references are compared with declared links

| Field | Value |
|---|---|
| **Status** | `Proposed` |
| **Date** | 2026-10-22 |
| **Deciders** | Bartosz |

## Context

Stemma proves a picture matches its model; nothing proves the model matches the system it describes.
Agents now change code and architecture in the same session, and the two drift apart at the agent's
speed. For .NET, the coarsest and most reliable statement of what depends on what is the project
graph: a `ProjectReference` is a compile-time dependency that cannot be faked. Questions: where the
mapping from element to code lives, what is compared, and where results go.

## Decision

1. **The map is a rule.** In `Rules/*.cs`, `Code.At("<path>")` names the implementation's root (relative
   to the workspace) and `Code.Map("<element id>", "<.csproj or folder>")` maps a container or module to
   its projects. Read off the syntax tree with the rules ([ADR-0028](./0028-architecture-rules-as-code.md)).
   Ids are strings, so removing an element never breaks the build — `validate` reports the dangling map.
2. **What is compared is the project graph**, read as XML (`ProjectReference` paths resolved against the
   referencing project; `bin`, `obj` and dot-folders skipped). A code dependency A → B between two
   mapped elements must be declared by a `Dependency` or a `DataFlow` from A to B; a `Dependency` A → B
   should be realised by a reference. Missing code, ambiguous maps and unmapped projects are reported.
   No MSBuild evaluation: conditions and imports are not followed, which is the price of no SDK.
3. **Results are violations, through the `RuleEngine`**, recomputed and never stored; project files are
   re-read only when their modification time changes.
4. **`stemma scan <path>` exposes the same graph** — projects and references — so an agent building an
   as-is model starts from facts.

## Consequences

- **Positive:** drift between the diagram and the code is a red card on the canvas and a line in
  `validate`; an as-is model can be bootstrapped from a command.
- **Negative / trade-offs:** .NET only; references inside a project (namespaces, types) are not seen;
  conditional references are counted unconditionally.
- **Neutral:** a workspace without `Code.Map` is unaffected.

## Alternatives considered

- **Map on the element** (`new Container(…, Code: "src/Orders")`) — couples a model kind to a build
  system and puts paths into every declaration; the map is a check, so it sits with the checks.
- **Roslyn compilation of the target solution** — type-level precision, at the cost of loading another
  solution in the engine's process on every check; project references give most of the signal for none
  of the cost. Type-level rules remain NetArchTest's job.
- **Store the last result** to show it without recomputing — a cache of the code in Stemma's files: a
  third store.

## Relationship to the inviolable rules

The map is code in the workspace; results are never stored; the engine reads XML with the BCL and
stays free of web and LLM concerns; nothing is written.

## References

- [F-025](../../features/F-025-conformance-with-the-implementation.md)
- [Thoughtworks Radar — architecture drift reduction with LLMs](https://www.thoughtworks.com/radar/techniques/architecture-drift-reduction-with-llms)
