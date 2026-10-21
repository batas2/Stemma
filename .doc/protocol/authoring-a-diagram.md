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
| `Person` | id, name, role | An actor. `role` is free text; `external` is conventional. |
| `SoftwareSystem` | id, name | A C4 system — yours or a neighbour's. |
| `Container` | id, name, systemId, kind | A deployable inside a system. `kind` is free text (`service`, `db`, `spa`, `broker`, …). |
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
| `DataFlow` | id, from, to, payload, direction? | Solid arrow labelled with the payload. |
| `Dependency` | id, from, to, kind? | Dashed arrow labelled with the kind (default `uses`). |
| `Relation` | id, from, to, label? | Solid arrow labelled with the label; an unlabelled one is a bare arrow. |

`Relation` is the counterpart to `Concept`: an arrow that claims nothing beyond its label
([ADR-0019](../architecture/decisions/0019-relation-link-kind.md)).

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
(layered, fan-in/out emphasis), or `all` (no lens — you place everything).

**A link is drawn only when both of its endpoints are in the view.** This is the single most common
way a diagram comes out looking right and missing an arrow, so `validate` reports it as
`view/half-link`.

Seven boxes is the working maximum. Past that a diagram has usually stopped answering one question,
and `validate` says so.

---

## 4. `stemma.layout.json` — how it is arranged

Schema: [`schema/stemma.layout.schema.json`](../../schema/stemma.layout.schema.json). Every sidecar
carries a `$schema` pointer, so an editor validates it as you type. **The format is pass-through:
members it does not model are preserved, never dropped.**

The view key is `custom:<viewId>` for a saved view, or the lens name for a built-in.

### Layout as a constraint, not as coordinates

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
```

A single theme and format keeps the filename exactly as given. Two themes suffix it, which is the
pair a `<picture>` element expects.

Each render writes a sibling `<name>.manifest.json` with a fingerprint of everything that decides
what the picture looks like. `--check` re-computes it and exits non-zero when the image no longer
matches the model — which is the whole "a diagram cannot lie" claim, extended past the app window.

Rendering runs a short-lived backend of its own, so it never disturbs a workspace you have open,
and it leaves the app's list of recent workspaces alone. (Any backend started with `--recents off`,
or with `STEMMA_RECENTS=off` in its environment, does the same.)

---

## 7. Checking your work

```
stemma validate [<path>] [--json] [--strict]       # or --workspace <path>; default: the current directory
```

Exit `0` when nothing is broken, `1` on an error (or a warning under `--strict`), `2` on a bad
command line. `--json` is the form to act on programmatically.

It checks the model the app reads: every C# file in a folder named `Architecture` (subfolders
included, build output left out), merged, so a link from `Architecture.cs` to an element declared in
`Architecture/Payments.cs` is not dangling. An id declared in two files is a duplicate. `render`
fingerprints the same merged model, so `--check` notices a change in any of the files.

What it catches, in rough order of how often it bites:

| Rule | Severity | Why it matters |
|---|---|---|
| `link/dangling-endpoint`, `element/dangling-reference`, `view/dangling-member` | error | A string id nothing else checks. The node or edge silently vanishes. |
| `view/empty` | error | The render will report `empty`; better to know now. |
| `model/duplicate-id` | error | Which one wins is arbitrary. |
| `shape/dangling-anchor` | error | The arrow detaches to its last coordinates and looks like carelessness. |
| `book/missing-view`, `book/dangling-focus` | error | A page that shows a view that is gone, or points at an element that is: a slide that outlived what it was about. |
| `book/focus-outside-view` | warning | The page points at an element its view does not draw, so nothing lights up. |
| `book/dangling-step` | error | A step plays a relationship the model no longer has, so the flow skips a beat in front of the room. |
| `book/dangling-order`, `book/malformed` | warning | A hand edit or a merge left the book's order or shape wrong; it presents what it can. |
| `book/legacy-file` | warning | `Concepts/view-book.stemma.yaml` is no longer read; its books have to move to `books`. |
| `sidecar/unreadable` | warning | The canvas silently ignores it — every position in it is already lost. |
| `view/busy` | warning | Past seven boxes a diagram has usually stopped answering one question. |
| `view/mixed-register` | warning | Half the boxes claim something about a system and half claim nothing. |
| `view/half-link` | info | One endpoint in the view, so the relationship is not drawn. Often deliberate. |
| `model/is-a-figure` | info | Mostly `Concept`s. A fine thing to be. |

---

## 8. Things that will catch you out

- **A link needs both ends in the view.** The most common cause of "why is that arrow missing".
- **Positions are in flow units, not pixels.** They scale with zoom; the render fits and crops for you.
- **The layout mode and a constraint are different things.** `layoutMode: "force"` re-runs a
  generator and overwrites positions on open. A `layout` constraint is solved and stays live. Do not
  set both.
- **Node titles wrap; other rows do not.** A prose label is fine as a name and is truncated
  everywhere else, so put the sentence in the name.
- **Default edge docking is left/right.** For an arrow that must leave a specific side, set
  `views.<key>.edges.<linkId>.handles`.
- **Do not add an element to make a picture work.** That is what shapes are for. An element is a
  claim about the system, and it will outlive the diagram.

## 9. Where to go next

- [`../architecture/domain-model.md`](../architecture/domain-model.md) — the DSL from the engine's side.
- [`../../schema/stemma.layout.schema.json`](../../schema/stemma.layout.schema.json) — the sidecar, exhaustively.
- [`../product/agent-authored-diagrams.md`](../product/agent-authored-diagrams.md) — why any of this exists, and what is still missing.
- [`../../samples/AuroraRail/`](../../samples/AuroraRail/) — a full architecture, four views, every structural kind.
