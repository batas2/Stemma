# The model — `Architecture/Architecture.cs`

One `public static Model Build()`, read off the syntax tree: one `var` per element, one per link, all
collected into `Model.Of(...)`. Stemma never runs this code; it reads the literals. Write arguments as
string literals (or constants), never as expressions built at run time — `validate` reports an argument
it cannot read as `model/unreadable-declaration`.

A model may span several files: every `.cs` file in a folder named `Architecture` (subfolders included)
is read and merged. Each file has its own `Build()`.

## Elements

| Kind | Arguments (in order; named arguments work too) | Use it for |
|---|---|---|
| `Person` | `id, name, role = "user", Description` | An actor. `role` is free text; `external` is conventional for people outside the organisation. |
| `SoftwareSystem` | `id, name, Description` | A C4 system — the one you are describing, or a neighbour (payment provider, legacy system). |
| `Container` | `id, name, systemId, kind = "service", Technology, Description` | A deployable inside a system. `kind` is free text: `spa`, `mobile`, `service`, `worker`, `db`, `broker`, `cache`, `gateway`, `cronjob`… |
| `BoundedContext` | `id, name` | A DDD context; draws as a frame around its modules. |
| `Module` | `id, name, contextId` | A unit of cohesion inside a context — the component level. |
| `Capability` | `id, name, contextId` | A business capability. |
| `UseCase` | `id, name` | Something a person does. |
| `Question`, `Assumption`, `Risk` | `id, name, aboutId` | A design concern about an element. Draws as a note joined to it. |
| `Concept` | `id, name` | A box in an argument that claims nothing about a system — for essay figures, never for architecture. |

## Links

| Kind | Arguments | Means |
|---|---|---|
| `DataFlow` | `id, fromId, toId, payload, direction = "oneway", Technology` | Data moving at run time: a call, a message, a query. `direction: "twoway"` for request/response drawn as one arrow. Label: what moves ("places orders", "OrderPlaced"). |
| `Dependency` | `id, fromId, toId, kind = "uses"` | A build- or design-time dependency: references, owns, extends. Dashed. |
| `Relation` | `id, fromId, toId, label` | An arrow that claims nothing beyond its label — for `Concept` figures. |

A link's ends may be declared in any model file. A container usually talks through `DataFlow`s; modules
usually depend on each other through `Dependency`s.

## Tags — lifecycle and ownership

```csharp
Tag.For(api, lifecycle: new Lifecycle(Status: "target", Phase: "Q1 2027"), ownership: new Ownership(Squad: "Checkout"));
```

As a statement of its own, after the declarations, naming the variable. `Status` is open: `current`,
`target`, `to-be-created`, `to-adapt`, `deprecated`, `proposed`. Draw an as-is / to-be picture by tagging
what is new `to-be-created` and what goes away `deprecated` — the cards show it, and a dashed outline in
the publication profile.

## Ids

Unique across the model, string literals, readable: `cnt_order_api`, not `c7`. Every `fromId`, `toId`,
`systemId`, `contextId` and `aboutId` must name a declared element; `stemma validate` reports one that
does not as an error.

## Argument diagrams (not architecture)

For an essay's figure — six boxes and the arrows of an argument — use `Concept` and `Relation`, a view
with `BaseView: "all"` listing the ids, and arrange it with a grid in `stemma.layout.json`
(`{ "kind": "grid", "columns": [["con_a", "con_b"], ["con_c", "con_d"]] }`): there the arrangement *is*
the argument, so you state it. Never mix `Concept`s with structural kinds in one view.
