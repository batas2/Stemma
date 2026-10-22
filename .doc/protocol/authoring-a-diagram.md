# Authoring a Stemma diagram as text

This is the reference for producing a diagram **without opening the app** — for an agent with a
filesystem and a shell, or for anyone who would rather write the workspace than draw it.

It is deliberately separate from [`../architecture/domain-model.md`](../architecture/domain-model.md),
which explains the DSL to people building Stemma. This one is written for someone who will never see
the canvas and gets one attempt at a file that a document will reference. Everything here has been
run; the three worked examples in §5 are transcripts, not sketches.

> **The one sentence.** A workspace is `Architecture.cs` (what exists), `Views/*.cs` (what this
> picture is about), and `stemma.layout.json` (how it is arranged). `stemma render` turns those
> three into an image; `stemma validate` tells you what is wrong before you look.

---

## 1. The shape of a workspace

```
my-diagram/
├── Architecture/Architecture.cs   the model — every element and link
├── Views/<Name>.cs                one file per view; a named subset of the model
└── stemma.layout.json             presentation: arrangement, styles, annotation
```

Nothing else is required. There is no database and no project file: a workspace with no `.csproj`
opens without the .NET SDK at all.

The split matters and is worth internalising before writing anything. **`Architecture.cs` says what
is true. The sidecar says what it looks like.** If you find yourself wanting to add an element so a
picture looks better, you want a shape (§4), not an element.

---

## 2. `Architecture.cs` — the model

One `public static Model Build()`, read off the syntax tree by name. One `var` per element, one per
link, all collected into `Model.Of(...)`.

```csharp
using Stemma.Model;

namespace MyDiagram;

public static class Architecture
{
    public static Model Build()
    {
        var api = new Container("cnt_api", "Booking API", "sys_platform", "service");
        var store = new Container("cnt_store", "Booking Store", "sys_platform", "db");
        var persist = new DataFlow("flow_persist", "cnt_api", "cnt_store", "order");

        return Model.Of(api, store, persist);
    }
}
```

### Elements

| Kind | Arguments | Use it for |
|---|---|---|
| `Person` | id, name, role?, description? | An actor. `role` is free text; `external` is conventional. |
| `SoftwareSystem` | id, name, description? | A C4 system — yours or a neighbour's. |
| `Container` | id, name, systemId, kind?, technology?, description? | A deployable inside a system. `kind` is free text (`service`, `db`, `spa`, `broker`, …); `technology` is what it is built with (`.NET 8`, `PostgreSQL`). |
| `BoundedContext` | id, name | A DDD context. Renders as a frame around its modules. |
| `Module` | id, name, contextId? | A unit of cohesion inside a context. |
| `Capability` | id, name, contextId? | A business capability. |
| `UseCase` | id, name | Something a person does. |
| `Question` · `Assumption` · `Risk` | id, name, aboutId? | Design concerns. `aboutId` points at what they concern. |
| `Concept` | id, name | **A named thing in an argument, asserting nothing about a system.** |

`Concept` is the one to understand before drawing an essay. Everything above it claims something —
"this is a bounded context", "this is deployable". An argument's boxes claim nothing, and forcing
them into `Module` writes a falsehood into a file other people copy from. See
[ADR-0018](../architecture/decisions/0018-concept-element-kind.md).

### Links

| Kind | Arguments | Renders as |
|---|---|---|
| `DataFlow` | id, from, to, payload, direction?, technology? | Solid arrow labelled with the payload, and the technology after it: `places orders [HTTPS/JSON]`. |
| `Dependency` | id, from, to, kind? | Dashed arrow labelled with the kind (default `uses`). |
| `Relation` | id, from, to, label? | Solid arrow labelled with the label; an unlabelled one is a bare arrow. |

`Relation` is the counterpart to `Concept`: an arrow that claims nothing beyond its label
([ADR-0019](../architecture/decisions/0019-relation-link-kind.md)).

A C4 element says what it is in a sentence, and a container and a flow what they are built with
([ADR-0027](../architecture/decisions/0027-description-and-technology.md)). Optional arguments are
easiest to write by name, so a container without a `kind` can still have a `technology`:

```csharp
var orders = new Container("cnt_orders", "Order Service", "sys_platform",
    Technology: ".NET 8", Description: "Accepts orders and tracks their state");
var place  = new DataFlow("flow_place", "cnt_app", "cnt_orders", "places orders", Technology: "HTTPS/JSON");
```

### Tags

```csharp
Tag.For(api, lifecycle: new Lifecycle(Status: "current", Phase: "load-bearing"),
             ownership: new Ownership(Squad: "Sell"));
```

`Status` is an open enum — `current`, `target`, `to-adapt`, `to-be-created`, `deprecated`,
`proposed`, or your own.

### The rules the compiler does not enforce

Ids are strings. Nothing checks them at build time or at run time, so a typo produces a missing node
or a missing edge, silently — which is invisible to anyone who cannot look at the result.

- Ids must be unique.
- Every `fromId`, `toId`, `contextId`, `systemId` and `aboutId` must name a real element.
- Every element and link must be collected in `Model.Of(...)`. Stemma reads the declarations, so one
  left out is still drawn — but the compiled model, and every test written against
  `Architecture.Build()`, does not have it. A tag kept in a local need not be collected.
- A prefix convention keeps them readable: `per_`, `sys_`, `cnt_`, `ctx_`, `mod_`, `cap_`, `uc_`,
  `q_`, `asm_`, `risk_`, `con_`, and `flow_` / `dep_` / `rel_` for links.

**Run `stemma validate` rather than trusting any of this.** It is the whole reason it exists.

---

## 3. `Views/<Name>.cs` — what the picture is about

One file per view, one `public static View Define()`.

```csharp
public static class PurchasePath
{
    public static View Define() => new(
        Id: "view_purchase",
        Name: "The purchase path",
        BaseView: "all",
        ElementIds: new[] { "per_passenger", "cnt_app", "cnt_api", "cnt_store", "sys_payments" });
}
```

`BaseView` is the lens: `moduleMap` (contexts as frames around their modules), `dependencyGraph`
(layered, fan-in/out emphasis), `all` (no lens — you place everything), or one of the two C4 lenses
below.

**A link is drawn only when both of its endpoints are in the view.** This is the single most common
way a diagram comes out looking right and missing an arrow, so `validate` reports it as
`view/half-link`.

### A view by rule: scope, include, exclude

A list of ids goes stale the day an element is added, and a missed id drops an arrow without a word. A
view can say what it is about instead ([ADR-0026](../architecture/decisions/0026-views-by-rule.md)):

```csharp
public static class PlatformContainers
{
    public static View Define() => new(
        Id: "view_containers",
        Name: "The platform's containers",
        BaseView: "container",
        Scope: "sys_platform",
        Exclude: ["cnt_console", "per_ops"]);
}

public static class OrderPath
{
    public static View Define() => new(
        Id: "view_order_path",
        Name: "Around the Order Service",
        BaseView: "all",
        ElementIds: ["per_customer"],
        Include: ["->cnt_orders->", "kind:container[technology=Go]"],
        Exclude: ["cnt_db"]);
}
```

The members are the lens's, then `ElementIds`, then what `Include` selects, minus what `Exclude` selects.
Every argument but the first three is optional.

| Lens | `Scope` | Draws |
|---|---|---|
| `systemContext` | a software system | the system, and every person and software system related to it or to one of its containers (C4 level 1) |
| `container` | a software system | the system as a boundary around its containers, and every person, software system and other system's container related to them (C4 level 2) |

A container the view does not show but whose system it does — the scope's own in a system context,
another system's in either — is drawn as its system: its relationships become **implied links** to the
system, one per pair of ends and direction, with the payloads of the flows they stand for. None is drawn
where a real link already joins the two ends.

A selector is one of:

| Selector | Selects |
|---|---|
| `cnt_orders` | that element |
| `sys_platform.*` | its children: a system's containers, a context's modules and capabilities |
| `*` | everything |
| `kind:container` | every element of a kind (`person`, `softwareSystem`, `container`, `module`, `concept`, …) |
| `kind:container[technology=Go]` | filtered: `[attr=value]`, `[attr!=value]`, `[attr=a\|b]`; any argument (`kind`, `role`, `technology`, `systemId`, `name`, …), and `status`, `phase`, `squad`, `domain` from the tags |
| `->cnt_orders`, `cnt_orders->`, `->cnt_orders->` | the element and what relates to it, what it relates to, or both |

Kinds, attribute names and values match whatever their case; ids are exact. A container written
without its `kind` is a `service` to a filter, as it is to the compiler.

**See what a rule selected** before rendering it:

```
$ stemma inspect --view view_order_path
stemma inspect: view_order_path "Around the Order Service" — all

Members (7)
  per_customer             Person          elementIds
  sys_payments             SoftwareSystem  include:->cnt_orders->
  cnt_gateway              Container       include:->cnt_orders->
  cnt_orders               Container       include:->cnt_orders->
  cnt_dispatch             Container       include:kind:container[technology=Go]
  cnt_bus                  Container       include:->cnt_orders->
  cnt_pos_adapter          Container       include:->cnt_orders->

Links drawn (6)
  flow_place               cnt_gateway -> cnt_orders  "places orders [gRPC]"
  …

Implied links (0)

Left out (8)
  flow_browse              per_customer -> cnt_app  "browses and orders": 'cnt_app' is not in the view
  …
```

`stemma inspect --view <id|name> [<path>] [--json]` lists every member and what brought it in, the links
drawn, the implied links with the links each stands for, and the relationships left out. It exits `1`
when the view has an error in how it is written, `2` when there is no such view. `--json` is the form to
act on.

Editing a rule-based view in the app keeps the rule: an element added on the canvas goes into
`ElementIds`, one removed that a rule brought in goes into `Exclude`.

How many boxes is too many depends on what the view is. A figure — a view of mostly `Concept`s — has
a working maximum of seven: past that it has usually stopped answering one question, and `validate`
warns. An architecture view is allowed far more: a container view of an ordinary system has fifteen to
thirty, and `validate` only notes one past thirty, where it has usually stopped being one diagram.

---

## 4. `stemma.layout.json` — how it is arranged

Schema: [`schema/stemma.layout.schema.json`](../../schema/stemma.layout.schema.json). Every sidecar
carries a `$schema` pointer, so an editor validates it as you type. **The format is pass-through:
members it does not model are preserved, never dropped.**

The view key is `custom:<viewId>` for a saved view, or the lens name for a built-in.

### For an architecture: write nothing, or say `layered`

A view with no `layout` and no position for any of its members is laid out for you: in layers that
follow its relationships, every edge routed around the boxes, every label kept clear of them
([F-021](../features/F-021-layered-layout-and-routed-edges.md)). For an architecture of any size this
is the right default, and the first thing to try. Nothing is written to the sidecar for it.

Say it explicitly to choose its options, or to keep it once someone has nudged a box:

```jsonc
"views": {
  "custom:view_containers": {
    "layout": { "kind": "layered", "direction": "down", "last": ["sys_stripe", "sys_maps"] }
  }
}
```

| Field | Meaning |
|---|---|
| `direction` | `down` (default), `right`, `up`, `left` — which way the flow runs. |
| `spacing` | One number, or `[between boxes, between layers]`. Default `[48, 72]`. |
| `first`, `last` | Ids pinned to the first or the last layer — people first and external systems last, usually. |
| `groups` | Default `true`: a context is laid out around its modules and a system around its containers, and the system's boundary is drawn, when the parent and a child are both in the view. |
| `routing` | `orthogonal` (default), `polyline`, `spline`. |

**Declaration order breaks ties.** Elements and links are laid out in the order `Architecture.cs`
declares them, so declaring in reading order — people, front ends, services, stores, neighbours — is
how to ask for an order without placing anything. The same input always gives the same picture
([ADR-0025](../architecture/decisions/0025-layered-layout-is-a-live-constraint.md)).

A nudge on a layered view is stored as an offset, as for the constraints below; the edges of a nudged
box are drawn unrouted until its nudge is reset.

### For a figure: layout as a constraint, not as coordinates

This is the part worth reading twice. You *can* write absolute positions:

```jsonc
"views": { "custom:view_x": { "nodes": { "mod_a": { "x": 0, "y": 0 } } } }
```

but you are usually better off saying what the arrangement *is*:

```jsonc
"views": {
  "custom:view_x": {
    "layout": { "kind": "grid", "columns": [["q_1", "mod_1"], ["q_2", "mod_2"]], "gap": [56, 40], "align": "center" }
  }
}
```

| Constraint | Fields | Shape |
|---|---|---|
| `grid` | `columns` (column-major), `gap: [x, y]`, `align` | Columns as wide as their widest member, rows as tall as their tallest. |
| `row` | `ids`, `gap: x`, `align` | Left to right. |
| `column` | `ids`, `gap: y`, `align` | Top to bottom. |
| `stack` | `ids`, `step: [dx, dy]` | Overlapping, offset by a fixed step. |

**`gap` is a pair on the two-axis kinds and a single number on the one-axis kinds.** A single number
is accepted everywhere, so `gap: 56` is always safe; a pair on a `row` is not, and `validate` reports
it as `constraint/bad-gap`. Getting this wrong does not fail the render — the canvas falls back to
its default spacing — so the picture comes out subtly different with nothing said. This is
[B-004](../bugs/B-004-bad-constraint-shape-kills-or-silently-changes-a-render.md), and it is the
single best reason to run `validate` before rendering.

Three properties make this worth preferring:

1. **It stays live.** A later drag records a delta in `offsets`, so the constraint survives being
   corrected, and a nudge travels with its slot when the arrangement re-solves.
2. **It governs only what it names.** Anything else keeps its `nodes` position — a constraint may
   arrange part of a diagram.
3. **It is deterministic.** The same input gives the same picture, which the `force`, `hierarchical`
   and `byType` generators (`layoutMode`) deliberately do not promise. Those bake coordinates
   instead; a published diagram that re-arranges when an algorithm is tuned is a diagram that lies.

### Annotation: free-form shapes

Ink, not model. Per view, under `shapes`. This is where swimlane labels, brackets and callouts go —
things that carry no architectural meaning and must never become elements.

```jsonc
"shapes": [
  { "id": "sh_human", "kind": "label", "x": -140, "y": 10, "text": "human", "fontSize": 15, "color": "#767884", "z": 1 }
]
```

Kinds: `label`, `rect`, `ellipse`, `triangle`, `arrow`, `image`. An `arrow` may anchor an end to an
element or another shape (`{"kind": "element", "id": "..."}`), and then follows it. A dangling anchor
does not fail — it detaches to its last coordinates, which looks like carelessness rather than a
broken reference, so `validate` reports it.

`z` decides which side of the cards a shape is on. **Below zero it is a backdrop**, drawn beneath the
cards and their links — the tinted panel behind a group, a lane, a zone. Zero and above, it is drawn
over them — a label, a callout, an arrow. A box shape's `label` is its bold first line and its `text`
is Markdown (`**bold**`, `*italic*`, `` `code` ``, `- ` lists), wrapped inside the box:

```jsonc
{ "id": "sh_shared", "kind": "rect", "x": -40, "y": -80, "w": 760, "h": 900, "z": -2,
  "fill": "#fff8e1", "stroke": "#d6b656", "strokeWidth": 2, "radius": 18,
  "label": "SHARED — the platform's asset", "text": "one truth about the real world, **read by everyone entitled to it**", "fontSize": 18 }
```

### The header: what the view is for

A view can say what it is, the one sentence it should leave in the room, how to read it, and what its
colours mean ([F-014](../features/F-014-self-explaining-views.md)). The header is drawn across the
top of the canvas, when a book is presented, in the PDF deck and in the report — not by `stemma
render`, whose figure takes its caption from the document it goes into.

```jsonc
"views": {
  "custom:view_target": {
    "header": {
      "title": "Target · one shared graph, a private overlay per buyer",
      "message": "One shared graph of the real world, with a private overlay per buyer.",
      "context": "Left to right: who uses it, the surfaces, the read models, **the graph**, the engines.",
      "legend": [
        { "status": "reuse", "label": "reuse — runs today" },
        { "status": "build", "label": "build — new" },
        { "line": { "color": "#64748b", "style": "dashed" }, "label": "projected from" }
      ]
    }
  }
}
```

| Field | Meaning |
|---|---|
| `title` | Shown instead of the view's name. |
| `message` | The one sentence the view should leave in the room. |
| `context` | Markdown: what it shows and how to read it. |
| `legend` | Leave it out and the legend is computed: each lifecycle status the view's elements carry, its swatch drawn the way those cards are drawn, then each kind of link. Write it to choose the entries and their words — `{ "status" }` takes its swatch from the view, `{ "swatch", "label" }` and `{ "line", "label" }` draw what they say. `[]` shows none. |

A built-in lens takes a header too, under `moduleMap` or `dependencyGraph`. `validate` reports a field
of the wrong type (`header/malformed`) and a legend entry for a status the view does not draw
(`header/unknown-status`).

### Styles

`nodeStyles` and `edgeStyles` are keyed by element and link id, workspace-wide. Both are fully
described in the schema. `textSize` sizes a card's whole text, its title and its notes: `sm`, `base`,
`lg`, `xl`. At `lg` and `xl` — the sizes for a room — the notes are never cut off and the card grows to
hold them, unless a `height` is given. A card whose `visibleFields` leave out `kind` but keep `status`
shows its status beside its name. A context's `textSize` sizes its frame's chip, and an edge's
`labelSize` (`sm`, `base`, `lg`, `xl`) its label. Under the `publication` profile most of it is overridden anyway, so reach
for them only when the profile is not what you want.

### Books: the walk through it

A book is an ordered walk through the model for one audience, usually from the widest view down to
the part that matters ([F-013](../features/F-013-books.md)). It lives under `books`, keyed by book
id; its pages are keyed by page id, and `order` says the order they are shown in.

```jsonc
"books": {
  "book_ticket_sold": {
    "name": "How a Ticket Is Sold",
    "audience": "engineering",
    "order": ["path", "money"],
    "pages": {
      "path":  { "title": "The path a purchase takes", "view": "view_buy",
                 "narrative": "Follow the arrows left to right." },
      "money": { "title": "Where the money moves", "view": "view_buy",
                 "narrative": "Only Payment Orchestration talks to the gateway.",
                 "focus": ["mod_payments", "sys_payments"] }
    }
  }
}
```

| Field | Meaning |
|---|---|
| `view` | The view the page shows: `moduleMap`, `dependencyGraph`, or a view id from `Views/` — the bare id, not `custom:<id>`. |
| `focus` | Element ids the page points at. They stay lit, with links between them; the rest fades. |
| `frame` | `focus` (the default when there is a focus) zooms to it; `view` keeps the whole view in frame, the focus lit in its surroundings. |
| `others` | `dim` (default) or `hide`, for a page that builds a picture up rather than pointing into it. |
| `narrative` | Markdown: what is said while the page is on screen. `**bold**`, `` `code` ``, `- ` lists. |
| `steps` | A flow played one relationship at a time ([F-020](../features/F-020-flow-steps.md)): each Next lights the next one, numbered, before the page turns. A step is a link id, or `{ "link": "…", "note": "what to say" }`. |

Write a book as a zoom: an orientation page with no focus, then pages that point into it, then pages
on closer views. Two pages on one view with different focus are a camera move when presented, which
is most of what makes a walk easier to follow than slides. Where a page tells how something happens —
a request, a deployment, a payment — give it `steps` in the order things happen, rather than a
paragraph that says "follow the arrows". Every id is checked by `validate`.

---

## 4a. Rules: what must hold

`Architecture.cs` says what exists. The constraints a reviewer holds it to — *only the payment service
talks to Stripe*, *the apps go through the gateway* — go in `Rules/*.cs`, beside it
([ADR-0028](../architecture/decisions/0028-architecture-rules-as-code.md)). `stemma validate` checks them
and the canvas marks the elements and the arrow that break one. Write the ones the user stated, in their
words as the `because`, and the ones the design obviously implies.

```csharp
using Stemma.Model;

namespace Dishwise;

public static class PlatformRules
{
    public static RuleSet Define() => RuleSet.Of(
        Rule.Use("c4"),

        Rule.Only("rule_card_data", from: "cnt_payments", to: "sys_stripe",
            because: "Card data stays inside one service, which keeps PCI scope to one team"),

        Rule.Forbid("rule_clients_via_gateway", from: "kind:container[kind=mobile|spa]", to: "kind:container[kind=service|db|broker]",
            because: "Every client call is authenticated at the gateway"),

        Rule.Layers("rule_layers",
            ["kind:person", "kind:container[kind=mobile|spa]", "kind:container[kind=gateway]",
             "kind:container[kind=service|worker]", "kind:container[kind=db|broker]"],
            because: "Requests flow down: people, clients, the edge, services, data"),

        Rule.Require("rule_owned", of: "kind:container[kind=service]", has: "squad",
            because: "Every service has a squad that is paged for it"));
}
```

Any `.cs` file in a folder named `Rules` is read, at any depth; it is read off the syntax tree like the
model, so it needs no project and is never run.

| Rule | Says | A violation is |
|---|---|---|
| `Rule.Forbid(id, from, to, because?, via?, severity?)` | nothing `from` selects may have a relationship to anything `to` selects | each such relationship |
| `Rule.Only(id, from, to, because?, via?, severity?)` | only what `from` selects may relate to what `to` selects | each relationship into `to` from anything else |
| `Rule.Layers(id, layers, because?, via?, severity?)` | each element is in the first layer that selects it, the top first; relationships go down or sideways | each relationship from a lower layer to a higher one; an element no layer selects is not checked |
| `Rule.Require(id, of, has, because?, severity?)` | everything `of` selects has a non-empty `has` | each one that does not |
| `Rule.Use("c4")` | turns on the C4 checks: containers have a technology; people, systems and containers a description; data flows a payload, and a technology unless a person is at an end | — |

- **A relationship** is a `DataFlow` or a `Dependency`, from its `fromId` to its `toId` as written — a
  `twoway` flow included. `via: "dataFlow"` or `via: "dependency"` narrows a rule to one kind; without it,
  both count. A `Relation` claims nothing and is never checked.
- **Selectors** are the view selectors (§3) without the `->` forms. `Require`'s `of` may select links:
  `link:dataFlow` or `link:dependency`, filtered over `payload`, `technology`, `direction`, `kind`, `label`.
- **`has`** is any argument of the kind (`technology`, `description`, `kind`, `role`, …), `status` or
  `phase` from the lifecycle, `squad` or `domain` from the ownership; for links, `payload`, `technology`,
  `direction`, `kind`, `label`.
- **`severity`** is `error` (the default for `Forbid`, `Only`, `Layers`), `warning` (the default for
  `Require`) or `info`. `stemma.rules.json` regrades or switches off a rule by its id, for the canvas and
  `validate` alike.
- **Ids are strings.** A rule naming an element that does not exist checks nothing there, and `validate`
  says so (`rule/dangling-id`).

`validate` reports a broken rule as `rule/<id>`, naming the elements and the link, and ending with the
`because`:

```
  error   rule/rule_clients_via_gateway data flow flow_app_orders from cnt_customer_app to cnt_orders is forbidden: nothing "kind:container[kind=mobile|spa]" selects may relate to what "kind:container[kind=service|db|broker]" selects — Every client call is authenticated at the gateway
```

When a rule fails, fix the architecture — or, if the rule is wrong, say so to whoever asked for it.
Never delete or loosen a rule someone asked for to make a check pass.

### Conformance: the model against the code

When the system is .NET, the same `RuleSet.Of(...)` can say which projects implement which containers
or modules, and `validate` compares the model with the project references
([ADR-0029](../architecture/decisions/0029-conformance-against-the-implementation.md)):

```csharp
Code.At("../src"),                                   // where the code is, relative to the workspace
Code.Map("cnt_api", "Shop.Api/Shop.Api.csproj"),     // a project file, relative to Code.At
Code.Map("cnt_worker", "Shop.Worker"),               // or a folder: every project in it
```

A project of A referencing a project of B must be declared by a `DataFlow` or a `Dependency` from A to B,
or `validate` warns (`conformance/undeclared-dependency`, naming both projects); a `Dependency` no
reference realises is noted (`conformance/unrealised-dependency`). A mapped path with no project in it is
an error (`conformance/missing-code`), a project mapped twice a warning (`conformance/ambiguous-map`), and
the projects nothing maps are listed (`conformance/unmapped-project`) — often a container not modelled
yet. Project files are read as XML: conditions and imports are not followed.

When a reference is undeclared, the code is the evidence: add the dependency the code has, or, if the
reference should not exist, say so — never map a project to the wrong element to make the finding go.

To start a model from an existing codebase, list what is there first:

```
$ stemma scan src
stemma scan: 3 project(s) under /home/me/shop/src

  Shop.Api     Exe      net8.0           Shop.Api/Shop.Api.csproj
    -> Shop.Core
    -> Payments.Client  (external: ../vendor/Payments.Client/Payments.Client.csproj)
  …
```

`stemma scan [<path>] [--json]` lists every project under the path — name, path, SDK, output type, target
frameworks — and its project references, an external one marked. It exits `2` for a path that does not
exist. Projects are evidence, not architecture: an API and the class libraries only it uses are one
container, mapped with one `Code.Map` per folder.

---

## 5. Three worked examples

Each of these was built and rendered exactly as written.

### 5.1 An argument diagram

The classic essay shape: boxes that assert nothing, arranged to carry the argument, with swimlane
labels as ink.

```csharp
// Architecture/Architecture.cs
var humanDiff = new Concept("con_human_diff", "a colleague's diff");
var ask       = new Concept("con_ask", "ask them why");
var answered  = new Concept("con_answered", "answered in a sentence");
var agentDiff = new Concept("con_agent_diff", "an agent's diff");
var nobody    = new Concept("con_nobody", "nobody to ask");
var artifacts = new Concept("con_artifacts", "tests, contracts, decision records");
return Model.Of(humanDiff, ask, answered, agentDiff, nobody, artifacts);
```

```csharp
// Views/WhoDoYouAsk.cs
public static View Define() => new(
    Id: "view_ask", Name: "Who do you ask", BaseView: "all",
    ElementIds: new[] { "con_human_diff", "con_ask", "con_answered",
                        "con_agent_diff", "con_nobody", "con_artifacts" });
```

```jsonc
// stemma.layout.json
"custom:view_ask": {
  "layout": {
    "kind": "grid",
    "columns": [["con_human_diff", "con_agent_diff"],
                ["con_ask", "con_nobody"],
                ["con_answered", "con_artifacts"]],
    "gap": [60, 40], "align": "center"
  },
  "shapes": [
    { "id": "sh_human", "kind": "label", "x": -140, "y": 10,  "text": "human", "fontSize": 15, "color": "#767884", "z": 1 },
    { "id": "sh_agent", "kind": "label", "x": -140, "y": 190, "text": "agent", "fontSize": 15, "color": "#6366e8", "z": 1 }
  ]
}
```

```
stemma render --workspace . --view view_ask --out who-do-you-ask.png
```

`validate` reports one note on this workspace — *"6 of 6 elements are Concepts — this is a figure
rather than an architecture, which is a fine thing to be"*. That is the check working, not a problem.

### 5.2 A C4 container view

Real architecture: typed elements, flows with payloads, one element placed by hand outside the row.

```csharp
var passenger = new Person("per_passenger", "Passenger", "external");
var platform  = new SoftwareSystem("sys_platform", "Booking Platform");
var payments  = new SoftwareSystem("sys_payments", "Payment Gateway");
var app   = new Container("cnt_app", "Passenger App", "sys_platform", "spa");
var api   = new Container("cnt_api", "Booking API", "sys_platform", "service");
var store = new Container("cnt_store", "Booking Store", "sys_platform", "db");

var browse    = new DataFlow("flow_browse", "per_passenger", "cnt_app", "search terms");
var quote     = new DataFlow("flow_quote", "cnt_app", "cnt_api", "quote request");
var persist   = new DataFlow("flow_persist", "cnt_api", "cnt_store", "order");
var authorise = new DataFlow("flow_authorise", "cnt_api", "sys_payments", "authorisation", "twoway");

Tag.For(api, lifecycle: new Lifecycle(Status: "current"), ownership: new Ownership(Squad: "Sell"));
```

```jsonc
"custom:view_purchase": {
  "layout": { "kind": "row", "ids": ["per_passenger", "cnt_app", "cnt_api", "cnt_store"], "gap": 70, "align": "center" },
  "nodes": { "sys_payments": { "x": 700, "y": 220 } }
}
```

The row governs four elements; the payment gateway is not named by it and keeps its absolute
position below the line. That mixture is the normal case, not a special one.

### 5.3 A dependency view

The lens does the emphasis; the constraint fixes the reading order so the argument — *Sales depends
on Fares, never the reverse* — is visible as direction.

```csharp
var checkout = new Module("mod_checkout", "Checkout", "ctx_sales");
var orders   = new Module("mod_orders", "Order History", "ctx_sales");
var quote    = new Module("mod_quote", "Price Quote", "ctx_fares");
var rules    = new Module("mod_rules", "Fare Rules", "ctx_fares");

var d1 = new Dependency("dep_checkout_quote", "mod_checkout", "mod_quote", "calls");
var d2 = new Dependency("dep_quote_rules", "mod_quote", "mod_rules", "reads");
var d3 = new Dependency("dep_orders_checkout", "mod_orders", "mod_checkout", "reads");
```

```csharp
public static View Define() => new(
    Id: "view_deps", Name: "Sales depends on Fares, never the reverse",
    BaseView: "dependencyGraph",
    ElementIds: new[] { "mod_orders", "mod_checkout", "mod_quote", "mod_rules" });
```

```jsonc
"custom:view_deps": {
  "layout": { "kind": "grid",
              "columns": [["mod_orders"], ["mod_checkout"], ["mod_quote"], ["mod_rules"]],
              "gap": [80, 40], "align": "center" }
}
```

Single-element columns are how you say "one row, in this order" while keeping the option of adding a
second element under any of them later.

---

## 6. Rendering

```
stemma render --workspace <path> --view <id> --out <file> [options]

  --profile publication|app     publication strips app UI; default
  --palette dual-theme|print|slide
  --theme light|dark|light,dark two themes write the -light/-dark pair
  --format png|svg|png,svg
  --opaque                      bake the page background in; default is transparent
  --scale 1-4                   device pixel multiplier; default 2
  --pad <px>                    padding around the content; default 24
  --check                       do not render; report whether the image is still current
  --json                        print the result — files, sizes, layout findings — as one JSON document
  --fail-on-lint                exit 1 when the layout lint warns; the image is written either way
```

A single theme and format keeps the filename exactly as given. Two themes suffix it, which is the
pair a `<picture>` element expects.

Each render writes a sibling `<name>.manifest.json` with a fingerprint of everything that decides
what the picture looks like. `--check` re-computes it and exits non-zero when the image no longer
matches the model — which is the whole "a diagram cannot lie" claim, extended past the app window.

### What the render tells you about the picture

You cannot reliably see a crossing in a PNG, and neither can the model reading it. The renderer can:
every render measures what it drew and says what is wrong with it, in rule and element ids
([F-022](../features/F-022-render-geometry-and-layout-lint.md)):

```
  warning layout/edge-through-node     flow_pay_stripe passes through cnt_bus
  warning layout/label-overlap         the labels of flow_dispatch_db and flow_bus_notify overlap
  info    layout/crossings             edges cross 3 times
stemma render: wrote 1 file · 2 layout warnings
```

| Rule | Severity | What to do |
|---|---|---|
| `layout/node-overlap` | warning | Two boxes on top of each other. Move one, or let `layered` place them. |
| `layout/edge-through-node` | warning | A line crosses a box that is neither of its ends. Usually a grid or row whose relationships do not follow it: switch the view to `layered`, or reorder. |
| `layout/label-overlap` | warning | A label covers another label or a box. |
| `layout/edge-hidden` | warning | A line runs along another for most of its length and cannot be told apart — a back edge in a row. |
| `layout/crossings` | info → warning | How many times lines cross; a warning when there are more crossings than lines. |

The manifest carries the same findings under `lint`, and under `geometry` every box, frame, line and
label in flow units — the picture as numbers, for anything that wants to check it further. Neither is
part of the fingerprint `--check` compares. Look at the image after the lint is clean, not instead of
running it.

Rendering runs a short-lived backend of its own, so it never disturbs a workspace you have open,
and it leaves the app's list of recent workspaces alone. (Any backend started with `--recents off`,
or with `STEMMA_RECENTS=off` in its environment, does the same.)

---

## 7. Checking your work

```
stemma validate [<path>] [--json] [--strict]       # or --workspace <path>; default: the current directory
```

Exit `0` when nothing is broken, `1` on an error (or a warning under `--strict`), `2` on a bad
command line or a workspace that does not exist, `3` when the check could not run at all (a file it
could not read) and so has no verdict. `--json` is the form to act on programmatically.

It checks the model the app reads: every C# file in a folder named `Architecture` (subfolders
included, build output left out), merged, so a link from `Architecture.cs` to an element declared in
`Architecture/Payments.cs` is not dangling. An id declared in two files is a duplicate. `render`
fingerprints the same merged model, so `--check` notices a change in any of the files.

What it catches, in rough order of how often it bites:

| Rule | Severity | Why it matters |
|---|---|---|
| `link/dangling-endpoint`, `element/dangling-reference`, `view/dangling-member` | error | A string id nothing else checks. The node or edge silently vanishes. |
| `view/empty` | error | The view resolves to no elements — its lens, list and rules together. The render will report `empty`; better to know now. |
| `view/bad-scope` | error / warning | A C4 lens with no `Scope`, or one that is not a software system: the lens draws nothing (an error). A `Scope` on a lens that does not use one is ignored (a warning). |
| `view/dangling-include` | error / warning | An `Include` naming an id that does not exist — `sys_x`, `sys_x.*`, `->sys_x` — brings in nothing (an error); a selector that selects nothing today is a warning. |
| `view/bad-selector` | error | An `Include` or `Exclude` that is not a selector, with the character where it goes wrong. |
| `view/dangling-exclude` | warning | An `Exclude` naming an id that does not exist: it excludes nothing, and has probably outlived what it was about. |
| `model/duplicate-id`, `link/duplicate-id` | error | An element or a link id declared twice, in one file or two. Which one wins is arbitrary. |
| `model/unreadable-declaration` | error / warning | An argument Stemma cannot read — an id written as a method call, a name built at run time. An error when the whole declaration is left out of the model, a warning when one argument is read as empty. Write it as a string literal or a constant. |
| `model/not-collected` | warning | An element or link declared in `Build()` and left out of its `Model.Of(...)`: Stemma draws it, the compiled model does not have it. Named by file, line and variable. Not checked when the return is anything but `Model.Of` of plain locals. |
| `rule/<rule-id>` | as the rule says, or as `stemma.rules.json` sets it | The engine's rules — the ones the canvas marks cards with: a data-flow cycle (`rule/no-circular-dataflows`), a flow into a deprecated element, a module whose context is not a bounded context — and the workspace's own (§4a), under the id each declares, ending with its `because`. The C4 pack's are `rule/c4/container-technology` (warning), `rule/c4/described`, `rule/c4/flow-technology` (info) and `rule/c4/flow-labelled` (warning). Switched off or re-graded in `stemma.rules.json` (`{ "rules": { "no-circular-dataflows": { "enabled": false } } }`), for the canvas and `validate` alike. |
| `rule/bad-selector`, `rule/dangling-id`, `rule/duplicate-id`, `rule/unreadable`, `rule/unknown` | error | A rule in `Rules/` that cannot be checked, named by file and line: a selector that is not one (with the character where it goes wrong), an id that is not an element, an id two rules share (or a built-in rule's, or a second `Code.At`), an argument that is not a literal or a constant or a required one missing, and a rule, pack, `via`, `severity`, `has` or parameter Stemma does not know. An unreadable `because` is a warning; the rule is still checked. |
| `view/mixed-levels` | info | With `Rule.Use("c4")`: a view drawing containers and modules together — two levels of C4 in one frame. |
| `conformance/missing-code` | error | `Code.At` or a `Code.Map` path that does not exist, holds no project, or holds one that is not readable: the element is compared with no code. |
| `conformance/undeclared-dependency` | warning | A project of A references a project of B and the model has no data flow or dependency from A to B. The diagram says less than the code does. |
| `conformance/ambiguous-map` | warning | One project mapped to two elements; its references are compared for neither. |
| `conformance/unrealised-dependency` | info | A `Dependency` A → B that no project reference realises. |
| `conformance/unmapped-project` | info | Projects under `Code.At` that nothing maps, ten named and then a count; not listed while a map points at nothing. |
| `view/duplicate-id` | error | Two view files with one id. The app opens and saves whichever it reads first. |
| `shape/dangling-anchor` | error | The arrow detaches to its last coordinates and looks like carelessness. |
| `constraint/unknown-kind`, `constraint/bad-gap`, `constraint/no-members`, `constraint/dangling-id` | error | A `layout` the canvas cannot solve, a spacing of the wrong shape, a constraint that places nothing or an id that is not in the model. The canvas falls back to a default, which is a different picture with nothing said. |
| `constraint/bad-direction`, `constraint/bad-spacing`, `constraint/bad-field` | error | A `layered` option the layout cannot use: a `direction` other than `down`, `right`, `up`, `left`; a `spacing` that is neither a number nor `[between nodes, between layers]`; a `routing` other than `orthogonal`, `polyline`, `spline`, a `groups` that is not `true`/`false`, a `first`/`last` that is not a list. A layered constraint governs every node in the view and names no members; the ids it pins `first` and `last` are checked like any other. |
| `book/missing-view`, `book/dangling-focus` | error | A page that shows a view that is gone, or points at an element that is: a slide that outlived what it was about. |
| `book/focus-outside-view` | warning | The page points at an element its view does not draw, so nothing lights up. |
| `book/dangling-step` | error | A step plays a relationship the model no longer has, so the flow skips a beat in front of the room. |
| `book/dangling-order`, `book/malformed` | warning | A hand edit or a merge left the book's order or shape wrong; it presents what it can. |
| `book/legacy-file` | warning | `Concepts/view-book.stemma.yaml` is no longer read; its books have to move to `books`. |
| `sidecar/unreadable` | warning | The canvas silently ignores it — every position in it is already lost. |
| `sidecar/malformed` | warning | A value of the wrong kind — `views` as a list, a shape that is a number, an id that is not text. Named by its path; the canvas skips it. |
| `view/busy` | warning / info | A figure (mostly `Concept`s) past seven boxes has usually stopped answering one question: a warning. An architecture view past thirty has usually stopped being one diagram: a note. |
| `view/mixed-register` | warning | Half the boxes claim something about a system and half claim nothing. |
| `view/half-link` | info | One endpoint in the view, so the relationship is not drawn. Often deliberate. A relationship a C4 lens draws as an implied link is not one. |
| `layout/inert-mode` | info | A `layoutMode` of `force`, `hierarchical` or `byType` on a view with no positions and no `layout`: it records the Layout panel's choice and arranges nothing. Write `"layout": { "kind": "layered" }` instead. |
| `model/is-a-figure` | info | Mostly `Concept`s. A fine thing to be. |

---

## 8. Things that will catch you out

- **A link needs both ends in the view.** The most common cause of "why is that arrow missing".
- **Positions are in flow units, not pixels.** They scale with zoom; the render fits and crops for you.
- **The layout mode and a constraint are different things.** `layoutMode` only records which
  generator the Layout panel last ran; nothing reads it on open or in a render, so writing it arranges
  nothing (`validate` notes it as `layout/inert-mode`). To have a view laid out without placing a box,
  write `"layout": { "kind": "layered" }`. A `layout` constraint is solved and stays live. Do not
  set both.
- **Node titles wrap; other rows do not.** A prose label is fine as a name and is truncated
  everywhere else, so put the sentence in the name.
- **Edges are routed only on a layered view.** There they leave and enter where the layout plans and
  go around the boxes. On a hand-arranged view or under a grid, row or column they dock on the sides
  facing each other and take the shortest curve, which can cross a box — the render's lint says when
  (`layout/edge-through-node`). For an arrow that must leave a specific side, set
  `views.<key>.edges.<linkId>.handles`.
- **Do not add an element to make a picture work.** That is what shapes are for. An element is a
  claim about the system, and it will outlive the diagram.

## 9. Where to go next

- [`../architecture/domain-model.md`](../architecture/domain-model.md) — the DSL from the engine's side.
- [`../../schema/stemma.layout.schema.json`](../../schema/stemma.layout.schema.json) — the sidecar, exhaustively.
- [`../product/agent-authored-diagrams.md`](../product/agent-authored-diagrams.md) — why any of this exists, and what is still missing.
- [`../../samples/AuroraRail/`](../../samples/AuroraRail/) — a full architecture, four views, every structural kind.
- [`../../samples/FoodDelivery/`](../../samples/FoodDelivery/) — C4 views stated by scope and selectors, rules, and no
  sidecar at all: every view laid out for you.
- [`../product/agent-architecture-workflow.md`](../product/agent-architecture-workflow.md) — the audit behind layered
  layout, the lint, the C4 lenses, rules and conformance.
- [`../../integrations/claude-code/`](../../integrations/claude-code/) — this contract packaged for Claude Code.
