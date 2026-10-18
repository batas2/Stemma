# StemmaArchitecture — Stemma, modelled in Stemma

The architecture of the tool, expressed in the tool's own vocabulary. Two reasons it exists.

**It is checkable.** Every element here describes code one directory up. A modelling tool whose
own model cannot be verified is asking for a lot of trust, and the usual demo workspace — a
fictional company designed so the tool looks good — cannot answer that. If something in this model
is wrong, `grep` will tell you.

**It is the feature tour.** Between `Architecture/`, `Views/`, `Concepts/` and the committed
`stemma.layout.json`, every part of the vocabulary is exercised at least once.

```bash
./run.sh --dev --workspace samples/StemmaArchitecture
```

## What is in it

| | |
|---|---|
| Elements | All eleven kinds: person, software system, container, bounded context, module, capability, use case, risk, question, assumption, and `Concept` |
| Links | All three: `DataFlow` with payloads and direction, `Dependency` with a kind, `Relation` for arrows that claim nothing |
| Tags | Lifecycle (`current`, `target`, `to-adapt`) and ownership, including RAPID roles on the two decisions that actually get argued about |
| Views | Six, each answering one question, each at or under seven boxes |
| Books | Three, for three audiences, in the `books` section of `stemma.layout.json` |
| Data layer | Aggregates, entities and value objects in `Concepts/data-model.stemma.yaml` |
| Resource layer | The HTTP surface as a tree, in `Concepts/resources.stemma.yaml` |
| Presentation | Layout constraints, edge docking, per-edge routing and line style, markdown notes, and free-form ink — all in the sidecar, none of it in the model |

## The six views

| View | The question it answers |
|---|---|
| `view_shape` | What actually ships, and what it cannot do without |
| `view_write` | How a gesture on a canvas becomes a line in a diff |
| `view_headless` | How a diagram gets produced with no browser and no mouse |
| `view_deps` | What the engine is allowed to know about |
| `view_concerns` | What I am not sure about, anchored to what it concerns |
| `view_principles` | The three rules that override any argument, and what enforces each |

## Things this workspace learned the hard way

Worth reading before building your own, because each of these cost a rewrite here.

**A view draws every link between its members.** There is no way to hide one. So if two elements
have a second relationship you did not want in this particular picture, the picture gets it anyway.
Twice in this workspace the fix was to correct the *model* rather than the layout: an operation
going out and a delta coming back is one `twoway` flow, not two arrows, and a `Dependency` that
restates what a `DataFlow` already says is a modelling smell that renders as a smeared label.

**Edge labels sit at the midpoint between two nodes, not along the routed path.** Docking handles
and per-edge routing move the *line* and leave the label where it was. Two labelled edges between
the same pair will overlap, and no sidecar setting fixes it — `labelOffset` is in the schema and in
the engine's type and is read by nothing in the client. Design around it: one labelled edge per
pair, per view.

**Node titles are names, not descriptions.** `StemmaEngine · the façade` reads fine in a list and
overflows its box on a canvas. The explanation belongs in a note, which is why six elements here
carry markdown and every title is short.

**The `dependencyGraph` lens draws modules, bounded contexts and capabilities and silently drops
everything else.** An earlier `view_deps` listed Roslyn and rendered six boxes out of seven with no
warning. If a box you asked for is missing, check the lens before you check your ids.

**Row-align pairs in a grid.** `view_concerns` puts each concern in the same row as the thing it is
about. The first version did not, and four `about` edges crossed the whole diagram to find their
targets.

## The one warning it ships with

```
warning view/mixed-register   view 'view_principles' mixes 3 Concept(s) with 3 structural elements
```

Deliberate, and the demonstration. The check is right that mixing rules with the things that ship
is usually a mistake. Here it is the entire point, because a rule with nothing enforcing it is a
poster. A warning you can explain is more useful in a sample than a warning you avoided by drawing
something duller.

Everything else is clean: `stemma validate --workspace samples/StemmaArchitecture` reports zero
errors.

## What is marked as not shipped

The model says `target` in two places and it means it. The LLM service and the `cap_ai` capability
are ADR-0008 and are not built. The workspace scaffold is `to-adapt` because F-007 still owes every
new workspace a `STEMMA.md`, and the Mermaid exporter is `to-adapt` because it drops element kinds
outside its three lenses. A self-model that flatters the project is worth nothing.
