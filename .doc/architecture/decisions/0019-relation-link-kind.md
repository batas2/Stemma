# ADR-0019: A `Relation` link kind for arrows that assert nothing

| Field | Value |
|---|---|
| **Status** | `Accepted` |
| **Date** | 2026-08-08 |
| **Deciders** | Bartosz |

## Context

[ADR-0018](./0018-concept-element-kind.md) added `Concept` — a box that claims nothing about a
system — and explicitly deferred the matching decision for arrows, on the grounds that the rendered
label is what a reader sees, so the picture was already correct and the dishonesty was confined to
the source.

Building the argument-diagram path made the deferral untenable for three reasons.

**The source is not private.** A workspace under `drafts/diagrams/<slug>/` is committed, read by the
next agent that opens it, and increasingly the thing a protocol document points at as an example. A
file that says `new Dependency("dep_1", "con_human_diff", "con_agent_diff", "becomes")` teaches the
wrong shape to whoever copies it next.

**`AboutId` is not a substitute.** It is the only relation the non-structural kinds have, its edges
are synthesised client-side, and they therefore carry no id — so they cannot be styled or given a
custom label. That is exactly why a rendered argument diagram shows generic dashed lines labelled
with the literal word "about". Anything an essay needs an arrow to *say* has nowhere to live.

**The benchmark needs styled arrows.** The diagram this whole programme is measured against draws
one arrow dashed (a path that leads nowhere) and one in the accent colour (the answer). Both are
per-link decisions keyed by link id, which an `AboutId` edge does not have.

## Decision

We will add `Relation(Id, FromId, ToId, Label = "")`: a labelled arrow between two elements that
claims nothing beyond its label.

It carries free text and no semantics. It is a real link with a real id, so it is stylable, has
waypoints and dock handles like any other, and appears in views under the normal both-endpoints rule.

## Consequences

- **Positive:** an argument can say "becomes" or "answered by" without asserting a dependency that
  does not exist, and the arrow can be styled per link because it has an id.
- **Positive:** it completes `Concept`. The two together mean an argument diagram borrows none of
  the architecture vocabulary, which is what makes `grep -c "new Concept("` a reliable signal.
- **Negative:** a third link kind in the reader, the writer, the exporters and the canvas, plus its
  own round-trip fixtures.
- **Negative:** one more thing an author can reach for instead of the kind that actually describes
  the relationship. Mitigated the same way as `Concept`: it is listed last, described by what it does
  not claim, and `validate` reports a view that mixes registers.
- **Neutral:** the label lives in a different attribute from the other kinds (`label`, against
  `payload` and `kind`). Three call sites had each grown their own two-way ternary for that mapping;
  adding a third kind is precisely the change that turns one of those into a silent wrong answer, so
  the mapping now lives in `lib/linkLabel.ts` alone.

## Alternatives considered

**Keep deferring.** The position ADR-0018 took, and it held only while the source was treated as
private and no diagram needed a styled arrow. Both stopped being true.

**Reuse `Dependency` with free-text `kind`.** Works, renders correctly, and writes a false word into
a committed file that other people copy from.

**Make `AboutId` edges into real links.** Would fix the styling gap without new vocabulary, and would
change the meaning of an existing model member — `AboutId` says "this concern is about that thing",
which is not the same as an arrow the author is drawing.

**A generic `Link` kind superseding all three.** Fewer kinds, and it would discard the distinction
between a data flow, a dependency and a rhetorical arrow — which is most of what makes the
architecture half of the model worth having.

## References

- [`ADR-0018`](./0018-concept-element-kind.md) — the deferral this supersedes.
- [`F-010`](../../features/F-010-concept-element-kind.md) — where the deferral was recorded.
