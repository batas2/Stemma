# Domain Model & DSL

The canonical model is written by architects as plain C# records in `src/Stemma.Model`
(`Concepts.cs`). A workspace's `Architecture/Architecture.cs` constructs them inside a static
`Build()` method and returns `Model.Of(...)`. Views are separate `Views/*.cs` files. This file is
the contract for what those records mean.

## Elements (nodes)

All elements derive from `ModelElement(string Id, string Name)`.

| Record | Signature | Meaning |
|---|---|---|
| `Person` | `(Id, Name, Role = "user", Description = null)` | A C4 actor (e.g. `"external"`, `"internal"`). |
| `SoftwareSystem` | `(Id, Name, Description = null)` | A C4 software system (often an external/neighbouring system). |
| `Container` | `(Id, Name, SystemId, Kind = "service", Technology = null, Description = null)` | A deployable unit inside a system (`service`, `worker`, `cronjob`, `job`, `tool`, `db`…). `Kind` is what sort of thing it is; `Technology` what it is built with. |
| `BoundedContext` | `(Id, Name)` | A DDD bounded context — a grouping lane on the canvas. |
| `Module` | `(Id, Name, ContextId = null)` | A unit of cohesion; nests visually under its `BoundedContext`. |
| `Capability` | `(Id, Name, ContextId = null)` | A business capability. |
| `UseCase` | `(Id, Name)` | A user-visible use case. |
| `Risk` | `(Id, Name, AboutId = null)` | A design risk; `AboutId` links it to the element it concerns. |
| `Question` | `(Id, Name, AboutId = null)` | An open design question. |
| `Assumption` | `(Id, Name, AboutId = null)` | A design assumption. |

`Risk`/`Question`/`Assumption` render as dotted **"about"** edges to their `AboutId` target — and the
auto-layout pulls them toward that target so annotations cluster with what they describe.

**Description and technology** ([ADR-0027](./decisions/0027-description-and-technology.md)) are on the
kinds C4 defines them for and no others: a person, a system and a container say what they are in a
sentence (`Description`); a container and a data flow say what they are built with or carried over
(`Technology`). A C4 container card reads *Order Service — .NET 8 — accepts orders and tracks them*,
and a flow's label *places orders [HTTPS/JSON]*. Modules, contexts and capabilities keep their prose in
their notes; a `Concept` stays poor (ADR-0018). Both are edited by `SetElementAttribute` /
`SetLinkAttribute` like any argument.

## Relationships (edges)

All links derive from `ModelLink(string Id, string FromId, string ToId)`.

| Record | Signature | Meaning |
|---|---|---|
| `DataFlow` | `(Id, FromId, ToId, Payload, Direction = "oneway", Technology = null)` | A flow of data; `Payload` is the message/call name shown as the edge label, `Technology` how it travels (`HTTPS/JSON`, `AMQP`). |
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

A `View(Id, Name, BaseView, ElementIds = null, Scope = null, Include = null, Exclude = null)` is a
named subset of the model seen through a base lens: a list, a scope and rules
([ADR-0026](./decisions/0026-views-by-rule.md)). Each view is a `Views/<Name>.cs` file with a static
`Define()`:

```csharp
public static class DependencyGraph
{
    public static View Define() => new(
        Id: "view_deps", Name: "Dependency Graph", BaseView: "dependencyGraph",
        ElementIds: new[] { "cnt_api", "mod_core", /* … */ });
}

public static class PlatformContainers
{
    public static View Define() => new(
        Id: "view_platform", Name: "The platform's containers", BaseView: "container",
        Scope: "sys_platform",
        Exclude: ["cnt_batch"]);
}
```

**Members** are the lens's, then `ElementIds` (as written), then what the `Include` selectors select (in
the order the model declares it), minus what the `Exclude` selectors select — once each. Ids that name
nothing are not members. A link renders when **both** its endpoints are members.

**Base lenses.**

| Lens | Scope | Members it adds | Notes |
|---|---|---|---|
| `moduleMap` | — | none | BCs as lanes with nested modules; draws every kind but `Concept`. |
| `dependencyGraph` | — | none | Layered, fan-in/out; draws modules, contexts and capabilities only. |
| `all` | — | none | No lens: the list and the rules. |
| `systemContext` | a software system | the system, and every person and software system related to it or to one of its containers | C4 level 1. |
| `container` | a software system | the system and its containers, and every person, software system and other system's container related to them | C4 level 2. The system is drawn as a boundary around its containers. |

In the two C4 lenses a container that is not a member but whose system is — the scope's own containers
in a system context, another system's in either — is drawn as its system: each of its relationships
is lifted to the system as an **implied link**, `__implied__<from>__<to>`, carrying the ids of the links
it stands for. There is one per pair of ends in each direction, and none where a real link already joins
those two ends that way; a link lifted onto a container and its own system draws nothing. Implied links
are derived, never stored, and cannot be edited. The other lenses add no members and imply nothing.

**Selectors** are the strings in `Include` and `Exclude`:

```
selector   := neighbours | base
neighbours := "->" base | base "->" | "->" base "->"
base       := ( "*" | id | id ".*" | "kind:" kind ) filter*
filter     := "[" attr ( "=" | "!=" ) value ( "|" value )* "]"
```

| Form | Selects |
|---|---|
| `sys_shop` | that element |
| `sys_shop.*` | its children: a system's containers, a context's modules and capabilities |
| `*` | every element |
| `kind:container` | every element of a kind (`person`, `softwareSystem`, `container`, `module`, …) |
| `kind:container[technology=PostgreSQL]` | filtered: `=`, `!=`, and `a\|b` for any of several |
| `->cnt_api`, `cnt_api->`, `->cnt_api->` | the element and what relates to it, what it relates to, or both — over links of any kind |

A filter reads the element's constructor arguments with their defaults (a container written without its
kind is a `service`), its `id` and `name`, `status` and `phase` from its lifecycle, and `squad` and
`domain` from its ownership. Kinds and attribute names match whatever their case, and so do values;
ids are exact. The same language, without the neighbourhood forms, is what architecture rules will be
written in ([ADR-0028](./decisions/0028-architecture-rules-as-code.md)).

Resolution happens once, in the engine (`ViewProjection`, `Selectors`): the canvas gets members, what
brought each one in, the implied links and the view's problems from `GET /api/workspace/views`, and
`stemma validate`, `stemma render`, `stemma inspect` and the draw.io export use the same answer.
Editing a rule-based view keeps the rule: an element added on the canvas goes into `ElementIds`, one
removed that a rule brought in goes into `Exclude`.

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
- **Every declaration is collected.** Stemma reads the model off the declarations in `Build()`; the
  compiler reads what `return Model.Of(...)` collects. A declaration left out of it is drawn and absent
  from the compiled model, so validation reports it (`model/not-collected`) with its file, line and
  variable — for each model file against its own `Model.Of`, and only when that return names plain
  locals (a tag local need not be collected).
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
