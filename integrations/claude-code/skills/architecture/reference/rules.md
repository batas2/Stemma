# Rules — `Rules/*.cs`

Rules state what the architecture must satisfy. They live beside the model, are read off the syntax
tree (never executed), and are checked by `stemma validate` and shown on the canvas where they are
broken. Write the ones the user stated, in their words, and the ones the design obviously implies.

```csharp
using Stemma.Model;

namespace Shop;

public static class ShopRules
{
    public static RuleSet Define() => RuleSet.Of(
        Rule.Use("c4"),

        Rule.Only("rule_payments", from: "cnt_api", to: "sys_stripe",
            because: "Card data stays inside one service (PCI scope)"),

        Rule.Forbid("rule_ui_db", from: "kind:container[kind=spa|mobile]", to: "kind:container[kind=db]",
            because: "Front ends reach data through the API"),

        Rule.Layers("rule_layers",
            ["kind:container[kind=spa|mobile]", "kind:container[kind=gateway]", "kind:container[kind=service|worker]", "kind:container[kind=db|broker|cache]"],
            because: "Requests flow down: clients, edge, services, data"),

        Rule.Require("rule_owned", of: "kind:container", has: "squad", severity: "warning",
            because: "Every deployable has an owning squad"));
}
```

| Rule | Says | Violation when |
|---|---|---|
| `Forbid(id, from, to, because?, via?, severity?)` | nothing selected by `from` may have a relationship to anything selected by `to` | such a relationship exists |
| `Only(id, from, to, ...)` | only what `from` selects may relate to what `to` selects | something else relates to it |
| `Layers(id, layers, because?, via?, severity?)` | each element belongs to the first layer selector it matches; relationships go down or sideways | a relationship goes from a lower layer to a higher one |
| `Require(id, of, has, because?, severity?)` | everything `of` selects has a non-empty `has` (`technology`, `description`, `status`, `squad`, …); `of` may select links: `link:dataFlow`, `link:dependency`, with filters | one does not |
| `Use("c4")` | turns on the C4 checks, reported as `rule/c4/<name>`: containers have a technology (warning), people/systems/containers a description (info), data flows a payload (warning) and — except to and from people — a technology (info) | — |

- `via`: `dataFlow`, `dependency`, or both (default). `Relation`s are never checked.
- `severity`: `error` (default for Forbid/Only/Layers), `warning` (default for Require), `info`.
- Selectors are the view selectors without the `->` forms (see views-and-layout.md).
- A rule Stemma cannot read is itself reported: `rule/bad-selector` (with the position), `rule/dangling-id`, `rule/duplicate-id`, `rule/unknown`, `rule/unreadable`.
- `Only` is strict: any relationship into what `to` selects from outside what `from` selects breaks it. Relationships run from `fromId` to `toId` as declared; a `twoway` flow is not reversed.
- `Layers`: the first layer listed is the top; an element belongs to the first layer it matches; elements in no layer are not checked; sideways is allowed. A consumer of a message bus usually *reads from* it — declare the flow from the consumer to the bus ("consumes OrderReady"), or the bus pushes up a layer.

`validate` reports a broken rule as `rule/<id>` with the `because`. When a rule fails, fix the
architecture — or, if the rule is wrong, tell the user; never delete a rule they asked for to make a
check pass.

## Conformance with the code

Map containers (or modules) to the .NET projects that implement them, and Stemma compares the model with
the project references:

```csharp
Code.At("../src"),                                          // where the code is, relative to the workspace
Code.Map("cnt_api", "Shop.Api/Shop.Api.csproj"),            // a project file, relative to Code.At
Code.Map("cnt_worker", "Shop.Worker"),                      // or a folder: every project in it
```

(Inside the same `RuleSet.Of(...)`.)

| Finding | Means |
|---|---|
| `conformance/undeclared-dependency` (warning) | a project of A references a project of B, and the model has no data flow or dependency from A to B |
| `conformance/unrealised-dependency` (info) | the model has a `Dependency` A → B that no project reference realises |
| `conformance/missing-code` (error) | a mapped path does not exist or holds no project |
| `conformance/ambiguous-map` (warning) | one project mapped to two elements |
| `conformance/unmapped-project` (info) | projects under `Code.At` that nothing maps — maybe containers you have not modelled (one finding: ten named, then a count) |

To start a model from an existing codebase, `stemma scan <path> --json` lists its projects and their
references. Projects are evidence, not architecture: group them into the deployables a person would name
(an API and its class libraries are one container), and ask when grouping is unclear.
