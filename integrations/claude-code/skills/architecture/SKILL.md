---
name: architecture
description: Design, describe, draw, check and review software architecture as a Stemma model — C4 system context and container views, data flows, dependencies, architecture rules and conformance with the code — and render it as a laid-out diagram. Use this whenever the user asks for an architecture, a C4 or container diagram, a system design, "how do these services talk", a picture of a system to present or review, or rules the architecture must follow; when they mention Stemma; or when the working directory holds Architecture/*.cs, Views/*.cs, Rules/*.cs or stemma.layout.json. Prefer it over writing Mermaid, PlantUML or draw.io by hand when the architecture should be kept, checked or presented.
---

# Architecture in Stemma

Stemma keeps an architecture as C# — the model is code, in the user's repository — and draws it. You
write three kinds of file; Stemma lays the picture out, routes its edges, checks the model against
the rules you write down, and tells you in words what is wrong with the picture. A person then opens
the same files in the Stemma app to review and present them.

Why this beats hand-drawing in Mermaid or draw.io: the elements are typed, so the same model gives a
context view and a container view that cannot disagree; rules are checked, not remembered; and the
picture is laid out for you, so you never place a box.

## Before you start

Run `stemma --version`. If it is missing, tell the user it installs with
`dotnet tool install -g Stemma` (or the tarball from the project page) and stop — nothing below works
without it. If the hook reports "stemma: command not found", it is the same problem.

## A workspace

```
<folder>/
├── Architecture/Architecture.cs   what exists: elements and the links between them
├── Views/<Name>.cs                what one picture is about — a lens, a scope, rules
├── Rules/<Name>.cs                what must hold (optional, but write it — see step 4)
└── stemma.layout.json             presentation (optional: write it only to change something)
```

No project file is needed. Put a new workspace where the user asks; by default `architecture/` at the
root of their repository.

## The loop

Work through these in order. Each step has a check, and the checks are what let you hand over
something correct without the user finding your mistakes for you.

### 1. Decide what the pictures are for

One question per view. For a system, that is usually two views: the **system context** (who and what
it talks to) and the **containers** (what it is made of and how they talk). Ask the user only if the
system's boundary is genuinely unclear; otherwise decide and say what you decided.

### 2. Write the model — `Architecture/Architecture.cs`

```csharp
using Stemma.Model;

namespace Shop;

public static class Architecture
{
    public static Model Build()
    {
        var customer = new Person("per_customer", "Customer", "external", Description: "Buys from the shop on the web or the app");
        var shop = new SoftwareSystem("sys_shop", "Shop", Description: "Sells and delivers orders");
        var web = new Container("cnt_web", "Web Shop", "sys_shop", "spa", Technology: "React", Description: "Browsing and checkout");
        var api = new Container("cnt_api", "Order API", "sys_shop", "service", Technology: ".NET 8", Description: "Accepts and tracks orders");
        var db = new Container("cnt_db", "Order DB", "sys_shop", "db", Technology: "PostgreSQL", Description: "Orders and their state");
        var stripe = new SoftwareSystem("sys_stripe", "Stripe", Description: "Card payments");

        var browse = new DataFlow("flow_browse", "per_customer", "cnt_web", "browses, orders", Technology: "HTTPS");
        var order = new DataFlow("flow_order", "cnt_web", "cnt_api", "places orders", Technology: "HTTPS/JSON");
        var save = new DataFlow("flow_save", "cnt_api", "cnt_db", "reads and writes orders", Technology: "SQL");
        var pay = new DataFlow("flow_pay", "cnt_api", "sys_stripe", "charges cards", "twoway", Technology: "HTTPS");

        return Model.Of(customer, shop, web, api, db, stripe, browse, order, save, pay);
    }
}
```

- **Declare in reading order** — people, front ends, services, stores, then neighbouring systems.
  The layout breaks ties by declaration order, so this is how you ask for an order without coordinates.
- **Every person, system and container gets a `Description`; every container and data flow a
  `Technology`.** C4 cards say what they are built with and what they do, and the C4 rule pack checks it.
- **Ids are strings and nothing but `stemma validate` checks them.** Use the prefixes `per_`, `sys_`,
  `cnt_`, `ctx_`, `mod_`, `flow_`, `dep_`, `rel_`.
- **Every variable goes into `Model.Of(...)`.** Stemma draws what is declared; the compiled model has
  only what is collected, and `validate` reports the difference.
- **A label says what moves or why**, not "uses": "places orders", "publishes OrderPlaced".

The whole vocabulary — all element and link kinds, tags for lifecycle and ownership, modules and
bounded contexts — is in [reference/model.md](reference/model.md).

### 3. Write the views — `Views/*.cs`

State a view by its **scope and rules**, not by listing ids:

```csharp
public static class Containers
{
    public static View Define() => new(
        Id: "view_containers",
        Name: "Shop — containers",
        BaseView: "container",
        Scope: "sys_shop");
}
```

`BaseView: "systemContext"` with a `Scope` draws the system and everything related to it;
`"container"` draws the system as a boundary around its containers, with the people and systems they
talk to. Relationships to a container that is not drawn are drawn to its system. To shape a view,
add `Include` / `Exclude` selectors — `"sys_shop.*"`, `"kind:container[technology=.NET 8]"`,
`"->cnt_api->"`. Selectors, lenses and layout options are in
[reference/views-and-layout.md](reference/views-and-layout.md).

**Do not write coordinates.** A view nobody arranged is laid out in layers that follow its links, with
every edge routed around the boxes. Write `stemma.layout.json` only to change that — a `direction`,
`last: [external systems]` — never to place boxes.

Check what a view selected: `stemma inspect --view view_containers`.

### 4. Write down what must hold — `Rules/*.cs`

Whatever the user said must be true ("payments only through the payment service", "the apps go through
the gateway") is a rule; write it, with the reason in their words. Add the obvious ones for the
architecture you drew, and turn on the C4 checks:

```csharp
public static class ShopRules
{
    public static RuleSet Define() => RuleSet.Of(
        Rule.Use("c4"),
        Rule.Only("rule_payments", from: "cnt_api", to: "sys_stripe", because: "Card data stays in one service"),
        Rule.Forbid("rule_no_ui_to_db", from: "kind:container[kind=spa|mobile]", to: "kind:container[kind=db]",
            because: "Front ends go through the API"));
}
```

The rule kinds (`Forbid`, `Only`, `Layers`, `Require`, `Use`) and mapping elements to code are in
[reference/rules.md](reference/rules.md).

### 5. Check the model

```
stemma validate <workspace> --json
```

Fix every `error`. Read every `warning` — each one is either a mistake or a decision you should be able
to state. `rule/<id>` findings are the architecture breaking a rule: fix the architecture, or, if the
rule is wrong, say so to the user rather than quietly deleting it. The PostToolUse hook runs this after
each edit and tells you about errors; still run it yourself before rendering.

### 6. Render, and read what the render says

```
stemma render --workspace <workspace> --view view_containers --out <workspace>/out/containers.png --json
```

The JSON lists layout findings — boxes overlapping, an edge through a box, labels colliding, edges
crossing — in element ids. You cannot see these reliably in an image; the renderer measures them. Fix
them: usually by leaving the view to the default layered layout, declaring elements in a better order,
pinning neighbours with `"last"`, or splitting a view that is answering two questions. Re-render until
there are no warnings.

### 7. Look at the picture

Only now read the PNG. Check what the lint cannot: does it answer the view's one question? Is anything
the user cares about missing? Are labels saying something?

### 8. Hand over

- Tell the user how to review it live: `stemma open <workspace>` opens the app on these files, and it
  follows your edits as you make them. What changed against the last commit is one click away there.
- Summarise: the views and what each answers, the rules you wrote and why, decisions you made that the
  user did not state, and anything `validate` still reports.

To review an existing model against the C4 checklist, see [reference/review.md](reference/review.md).

## Things that go wrong

- **An arrow is missing** — one end is not in the view. `stemma inspect --view <id>` lists the links
  left out. A C4 lens handles this for you.
- **The picture is a tangle** — the view is answering more than one question, or has more than about
  twenty-five boxes. Split it: a context view, a container view, and a focused view per flow.
- **You want to add a box to make the picture work** — that is a shape in the sidecar, not an element.
  An element is a claim about the system, and it outlives the picture.
- **The user wants an argument diagram, not an architecture** (an essay's boxes and arrows) — use
  `Concept` and `Relation`, a grid in the sidecar, and no C4 lens; see [reference/model.md](reference/model.md).
