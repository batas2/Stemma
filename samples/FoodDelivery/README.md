# Dishwise — C4 views and architecture rules

**Dishwise is invented.** A food-delivery platform, written to show C4 views stated by scope and rule
and an architecture checked against rules ([F-023](../../.doc/features/F-023-c4-views-and-views-by-rule.md),
[F-024](../../.doc/features/F-024-architecture-rules-as-code.md)). It is also the workspace the agent audit
built by hand ([`agent-architecture-workflow.md`](../../.doc/product/agent-architecture-workflow.md)), rewritten
the way the Claude Code plugin now writes one.

```bash
./run.sh --dev --workspace samples/FoodDelivery
stemma validate samples/FoodDelivery
stemma render --workspace samples/FoodDelivery --view view_containers --out containers.png
```

## What is in here

| File | Holds |
|---|---|
| `Architecture/Architecture.cs` | Three people, the platform and its eleven containers, three neighbouring systems, seventeen data flows — every element described, every container and flow with its technology. |
| `Views/SystemContext.cs` | `BaseView: "systemContext"`, `Scope: "sys_platform"` — no members listed. |
| `Views/Containers.cs` | `BaseView: "container"`, `Scope: "sys_platform"` — the platform drawn as a boundary. |
| `Views/OrderToDoor.cs` | A flow stated by `Include` and `Exclude` selectors. |
| `Rules/PlatformRules.cs` | The C4 checks, card data in one service, clients through the gateway, layering, owned services. |

`stemma validate` checks every rule and reports none broken. The layering rule is why the event bus's
consumers point at it — `cnt_dispatch` *consumes OrderReady* from `cnt_bus` — as a service points at its
database: the first version drew the bus pushing up to the services, and the rule said so.

There is no `stemma.layout.json`. Every view is laid out in layers that follow its relationships, and
every edge is routed around the boxes; nothing here was placed by hand.
