# Views and layout

## A view — `Views/<Name>.cs`

```csharp
using Stemma.Model;

namespace Shop;

public static class Checkout
{
    public static View Define() => new(
        Id: "view_checkout",
        Name: "How an order is placed",
        BaseView: "container",
        Scope: "sys_shop",
        Exclude: ["cnt_admin"]);
}
```

| Argument | Meaning |
|---|---|
| `Id`, `Name` | The id renders and books refer to; the title people see. |
| `BaseView` | The lens: `systemContext`, `container`, `all` (no lens), `moduleMap`, `dependencyGraph`. |
| `Scope` | The software system a C4 lens is about. Required for `systemContext` and `container`. |
| `ElementIds` | Ids listed by hand. Optional; with a lens you rarely need it. |
| `Include`, `Exclude` | Selectors adding to the view and taking from it. `Exclude` wins. |

Members are: what the lens selects, then `ElementIds`, then what `Include` selects, minus `Exclude`.

### The C4 lenses

- **`systemContext`** — the scope system, and every person and software system related to it or to any
  of its containers. Relationships with its containers are drawn to the system ("implied"), once per
  pair, their labels combined.
- **`container`** — the scope system drawn as a boundary around its containers, and every person,
  software system and other system's container related to them (another system's container is drawn as
  its system).

### Selectors

| Selector | Selects |
|---|---|
| `cnt_api` | that element |
| `sys_shop.*` | its children: a system's containers, a context's modules and capabilities |
| `*` | everything |
| `kind:container` | every element of a kind (`person`, `softwareSystem`, `container`, `module`, …) |
| `kind:container[kind=db]` | filtered: `[attr=value]`, `[attr!=value]`, `[attr=a\|b]` |
| `*[status=to-be-created]` | by lifecycle `status`/`phase` or ownership `squad`/`domain` |
| `->cnt_api` | it and what has a relationship into it |
| `cnt_api->` | it and what it has a relationship to |
| `->cnt_api->` | both |

Attribute names are the constructor arguments (`kind`, `technology`, `systemId`, `role`, …); names and
values match case-insensitively.

### Seeing what a view selected

```
stemma inspect --view view_checkout [--json]
```

lists the members and the rule that brought each one in, the links drawn, the implied links, and the
relationships left out because one end is not in the view.

## Layout — `stemma.layout.json`

You usually write none. A view with no `layout` and no saved positions is laid out in layers that
follow its relationships, every edge routed orthogonally around the boxes, every label kept clear —
deterministically, so the same model gives the same picture. Write the file only to change that:

```jsonc
{
  "version": 1,
  "views": {
    "custom:view_containers": {
      "layout": { "kind": "layered", "direction": "right", "last": ["sys_stripe", "sys_email"] }
    }
  }
}
```

| Field | Meaning |
|---|---|
| `direction` | `down` (default), `right`, `up`, `left`. `right` suits long flows and wide labels. |
| `spacing` | One number, or `[between boxes, between layers]`. Default `[48, 72]`. |
| `first`, `last` | Ids pinned to the first or last layer — people first, external systems last. |
| `groups` | Default `true`: a system is laid out and drawn around its containers, a context around its modules. |
| `routing` | `orthogonal` (default), `polyline`, `spline`. |

The view's key is `custom:<view id>`. Order beyond that comes from declaration order in
`Architecture.cs` — reorder declarations to reorder boxes.

**Never write `nodes` positions.** If someone later nudges a box in the app, Stemma records an offset
against the layout and keeps the layout.

`grid`, `row`, `column` and `stack` constraints exist for small figures whose arrangement is the point
(see model.md, argument diagrams). They do not route edges; the render's lint will tell you when an edge
crosses a box.

## Rendering

```
stemma render --workspace <ws> --view <id> --out <file.png> [--json] [--fail-on-lint]
              [--profile publication|app] [--format png|svg|png,svg] [--theme light|dark|light,dark]
```

`publication` (default) is outline boxes on a transparent background for documents; `app` looks like
the canvas. `--json` prints files and layout findings. Each render writes `<file>.manifest.json` with the
findings and the geometry; `stemma render ... --check` later says whether the image still matches the
model.

| Finding | Fix |
|---|---|
| `layout/node-overlap` | Leave the view to the layered layout; remove hand-written positions. |
| `layout/edge-through-node` | A grid or row whose links do not follow it, or a nudge: switch to `layered`, or reorder. |
| `layout/label-overlap` | Shorter labels, `direction: "right"`, or more `spacing`. |
| `layout/edge-hidden` | An edge drawn along another; `layered` routes them apart. |
| `layout/crossings` | Reorder declarations; split the view if it answers two questions. |
