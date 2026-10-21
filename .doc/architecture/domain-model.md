# Domain Model & DSL

The canonical model is written by architects as plain C# records in `src/Stemma.Model`
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

Stemma reads a tag written as a local like this one (listed in `Model.Of(...)`), or as a statement of
its own, `Tag.For(modRiskAgg, ...);`, and edits either in place. A `Tag.For` inside another expression
— an argument of `Model.Of` — is not read, and validation says so (`model/unreadable-declaration`).

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
- **An argument is a literal or a constant.** Besides string literals of every form (regular,
  verbatim, raw), Stemma reads what C# folds into a constant string: a `const` declared in the same
  file — a local of `Build()`, a field of its class, or a field named through its class
  (`Ids.Ctx`) — `+` and interpolation over those, and `nameof(...)`. Constants are a good way to
  keep an id from being mistyped in every flow that names it. Anything else (a method call, a
  `static readonly` field) cannot be read from the source: validation reports it as
  `model/unreadable-declaration` with its file and line, and a declaration whose id, or a link
  whose end, cannot be read is not in the model. An edit from the canvas changes literals only; an
  argument written as a constant is refused (`NotALiteral`) and left for you to change in the code.
- The Architecture entry point is `public static Model Build()`; view entry points are `public
  static View Define()`. The engine reads exactly those names. In a file with more than one class,
  the model is the `static Model Build()` of the class named `Architecture`; a further model file
  (`static class FlowsArchitecture`) has one of its own. A helper's `Build` that is not static, or
  does not return `Model`, is never taken for the model.
- Keep the model **structural**. No method bodies, no behavior. Decisions/risks/assumptions express
  *intent*, not logic.

## Decision vocabulary (inert)

`Decision` / `DecisionOption` records still exist as model vocabulary so older workspaces compile,
but Stemma no longer reads, edits, or renders them — the decision-editing feature was removed. Do not
build new features on them; use `Risk`/`Question`/`Assumption` for live design concerns.

## Worked example

See [`../../samples/AuroraRail/`](../../samples/AuroraRail/) for a full model (persons, systems,
containers, BCs, modules, capabilities, use cases, data flows, dependencies, risks, questions,
assumptions, lifecycle/ownership tags) exercising every element kind across four views — and
`AuroraRailSampleTests` for the id-integrity check the compiler cannot do.
