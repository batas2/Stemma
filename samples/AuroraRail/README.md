# Aurora Rail — the reference workspace

**Aurora Rail is invented.** It is a fictional national rail-ticketing platform, written to show
what a real Stemma model looks like when every part of the DSL is used at once. Open it first.

```bash
./run.sh --dev --workspace samples/AuroraRail
```

## The domain in one paragraph

Aurora sells rail tickets online. **Journey Planning** turns a search into an itinerary, **Fares &
Pricing** prices it, **Sales & Orders** takes the money, **Ticket Fulfilment** signs a barcode and
delivers it to the phone, **Disruption & Refunds** compensates passengers when trains fail, and
**Revenue & Settlement** splits the money between operators. Underneath all of it sits RESERVA, a
1994 reservation mainframe that is being strangled: two write paths remain, and most of the open
risks and questions in the model are about closing them.

That last part is deliberate. Every architecture worth modelling has a legacy system it is trying to
leave, and the lifecycle tags (`current`, `to-adapt`, `to-be-created`, `deprecated`) are what make
that migration legible on a canvas.

## What is in here

| File | What it holds |
|---|---|
| `Architecture/Architecture.cs` | The model. 66 elements, 45 links, 19 lifecycle/ownership tags — every element and link kind the DSL has. |
| `Views/*.cs` | Four saved views, each a named subset with a base lens. |
| `Concepts/data-model.stemma.yaml` | Aggregates, entities and value objects, with `owner:` pointing back at the modules that own them. |
| `Concepts/resources.stemma.yaml` | The Booking API resource tree with read/write actions. |
| `Concepts/view-book.stemma.yaml` | Three **books** — the same model narrated for three audiences. |
| `stemma.layout.json` | Positions, colours, notes and custom properties. Presentation only; safe to diff. |

## The four views

| View | Lens | Story |
|---|---|---|
| **Buy a Journey** (`view_buy`) | `moduleMap` | The money path, left to right: quote → basket → checkout → payment → `OrderPlaced` → issuing → barcode → wallet. The one remaining legacy seat hold is kept in frame on purpose. |
| **Strangler Migration** (`view_strangler`) | `moduleMap` | Only what still touches RESERVA, plus what replaces it. Read it with lifecycle badges on: dashed outlines are either dying or not built yet. |
| **Platform Dependencies** (`view_deps`) | `dependencyGraph` | The module graph in topological layers. Sales depends on Fares, Fulfilment and Revenue depend on Sales, and nothing depends on Care — a new upward edge here is a design smell you can see. |
| **Open Concerns** (`view_concerns`) | `all` | Every Risk, Question and Assumption next to the element it hangs off. The view to open before a design review. |

## The three books

Books are the "explain this to someone" surface: an ordered set of pages, each pairing a view with a
narrative. The same model, told three ways.

- **How a Ticket Is Sold** *(engineering)* — five pages walking a new joiner from the purchase path
  to the dependency shape the team defends in review.
- **Retiring RESERVA** *(leadership)* — four pages: what is left on the mainframe, what replaces it,
  the two risks that decide the date, and the one decision being asked for.
- **Disruption Day** *(operations)* — three pages on what breaks first on a strike day and who to
  call.

## Things worth trying

1. **Rename a module** in the UI, then `git diff`. Exactly one line changes, comments and formatting
   intact. That is the round-trip fidelity guarantee, and it is the whole point of the tool.
2. **Retag `mod_gateline`** from `to-adapt` to `deprecated` and watch the Strangler view re-read.
3. **Drag anything.** Positions land in `stemma.layout.json`, never in the C#.
4. **Open the Books panel** and page through *Retiring RESERVA* in presentation mode.
5. **Break something on purpose** — point a `DataFlow` at an id that does not exist. The compiler
   stays quiet (ids are strings) and the violations panel does not. `AuroraRailSampleTests` is the
   CI-side version of that same check.

> The workspace opens with **two warnings**, deliberately — both `deprecated-element-no-incoming-flows`
> on RESERVA. They are the seat hold and the gateline batch: the two write paths that still keep the
> mainframe alive. Watching the rule name them is half the reason the sample exists; the day both
> warnings disappear is the day the mainframe can be switched off.

## Conventions worth copying

- One `var` per element and per link, declared directly in `Build()`. The engine reads those
  declarations; anything nested in a loop or a helper method is invisible to it.
- `Tag.For(...)` as a **bare statement**, not `var t = Tag.For(...)`. The bare form is what Stemma
  writes when you tag from the inspector, so hand-written and tool-written files stay identical.
- Ids are stable strings and the C# compiler never checks them. Keep a test that does.
