# Domain Model & DSL

The canonical model is written by architects as plain C# records in `src/Verso.Model`
(`Concepts.cs`). A workspace's `Architecture/Architecture.cs` constructs them inside a static
`Build()` method and returns `Model.Of(...)`. Views are separate `Views/*.cs` files. This file is
the contract for what those records mean.

## Elements (nodes)

All elements derive from `ModelElement(string Id, string Name)`.

| Record | Signature | Meaning |
|---|---|---|
| `Person` | `(Id, Name, Role = "user")` | A C4 actor (e.g. `"external"`, `"internal"`). |
| `SoftwareSystem` | `(Id, Name)` | A C4 software system (often an external/neighbouring system). |
| `Container` | `(Id, Name, SystemId, Kind = "service")` | A deployable unit inside a system (`service`, `worker`, `cronjob`, `job`, `tool`, `db`…). |
| `BoundedContext` | `(Id, Name)` | A DDD bounded context — a grouping lane on the canvas. |
| `Module` | `(Id, Name, ContextId = null)` | A unit of cohesion; nests visually under its `BoundedContext`. |
| `Capability` | `(Id, Name, ContextId = null)` | A business capability. |
| `UseCase` | `(Id, Name)` | A user-visible use case. |
| `Risk` | `(Id, Name, AboutId = null)` | A design risk; `AboutId` links it to the element it concerns. |
| `Question` | `(Id, Name, AboutId = null)` | An open design question. |
| `Assumption` | `(Id, Name, AboutId = null)` | A design assumption. |

`Risk`/`Question`/`Assumption` render as dotted **"about"** edges to their `AboutId` target — and the
auto-layout pulls them toward that target so annotations cluster with what they describe.

## Relationships (edges)

All links derive from `ModelLink(string Id, string FromId, string ToId)`.

| Record | Signature | Meaning |
|---|---|---|
| `DataFlow` | `(Id, FromId, ToId, Payload, Direction = "oneway")` | A flow of data; `Payload` is the message/call name shown as the edge label. |
| `Dependency` | `(Id, FromId, ToId, Kind = "uses")` | A structural dependency (`uses`, `calls`, `reads`, `publishes`, `consumes`…). |

## Tags (metadata, attach by id)

A `Tag` attaches `Lifecycle` and/or `Ownership` to an element or link via `Tag.For(target, …)`:

- `Lifecycle(Status?, Phase?, ValidFrom?, ValidUntil?)` — `Status` is open-enum: `current`, `target`,
  `to-adapt`, `to-be-created`, `deprecated`, `proposed`, or any string. Renders as a lifecycle badge.
- `Ownership(Squad?, Domain?, Recommend?, Agree?, Perform?, Input?, Decide?)` — squad/domain plus
  RAPID role lists. Renders as an ownership badge.

```csharp
var tag = Tag.For(modRiskAgg,
    lifecycle: new Lifecycle(Status: "target", Phase: "NEW"),
    ownership: new Ownership(Squad: "Onboard"));
```

## Views (perspectives)

A `View(Id, Name, BaseView, IReadOnlyList<string> ElementIds)` is a named subset of the model with a
base lens. Base lenses: `moduleMap` (BCs as lanes with nested modules), `dependencyGraph` (layered,
fan-in/out), or `all`. Each view is a `Views/<Name>.cs` file with a static `Define()`:

```csharp
public static class DependencyGraph
{
    public static View Define() => new(
        Id: "view_deps", Name: "Dependency Graph", BaseView: "dependencyGraph",
        ElementIds: new[] { "cnt_api", "mod_core", /* … */ });
}
```

Links render in a view when **both** endpoints are present.

## Authoring rules

- **Ids are stable and referenced as strings** in flows/deps/aboutIds/views. The C# compiler does
  *not* check these — a typo creates a dangling reference (a missing node/edge). Validate when
  generating samples.
- The Architecture entry point is `public static Model Build()`; view entry points are `public
  static View Define()`. The engine reads exactly those names.
- Keep the model **structural**. No method bodies, no behavior. Decisions/risks/assumptions express
  *intent*, not logic.

## Decision vocabulary (inert)

`Decision` / `DecisionOption` records still exist as model vocabulary so older workspaces compile,
but Verso no longer reads, edits, or renders them — the decision-editing feature was removed. Do not
build new features on them; use `Risk`/`Question`/`Assumption` for live design concerns.

## Worked example

See [`../../samples/NetworkAggregation/`](../../samples/NetworkAggregation/) for a full model
(persons, systems, containers, BCs, modules, capabilities, data flows, dependencies, risks,
questions, assumptions, tags) exercising every element kind across three views.
