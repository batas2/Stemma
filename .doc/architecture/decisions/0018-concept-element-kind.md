# ADR-0018: A `Concept` element kind for boxes that assert nothing

| Field | Value |
|---|---|
| **Status** | `Accepted` |
| **Date** | 2026-08-08 |
| **Deciders** | Bartosz |

## Context

Stemma's vocabulary is C4 plus DDD: systems, containers, bounded contexts, modules, capabilities,
use cases, people, and the non-structural trio of questions, assumptions and risks. Every one of
those kinds makes a claim about a system.

Drawing an essay's argument makes no such claim. The one post illustrated from Stemma had to declare
*"Contracts at the seams"* a `Module` and *"What the repository can answer"* a `BoundedContext`. It
compiles. `RuleEngine` is satisfied. And it is false in exactly the way this product exists to
prevent: the model asserts a bounded context that does not exist, and the kind then drives the
rendering, so the published picture carries a `BOUNDED CONTEXT` chip over a sentence from an essay.

Doing nothing is not neutral. The headless renderer (F-004) and the layout DSL (F-006) make argument
diagrams cheap, which makes the abuse routine — and it accumulates in the one file that is supposed
to be the truth.

Worth separating, because it narrows the decision: not all of that experiment was abuse. The four
`Question` elements were used correctly. `Question`/`Assumption`/`Risk` are already a non-structural
sub-vocabulary — commentary, with ids and an `AboutId`, claiming nothing about system shape. Stemma
therefore already accepts that not every element models a system. The gap is that the non-structural
half stops at *concerns* and has no word for *things*.

## Decision

We will add exactly one element kind, `Concept(Id, Name)`, meaning **a named thing in an argument,
asserting nothing about a system**.

It gets no `ContextId`, no `SystemId`, no lifecycle or ownership semantics, and no membership in the
`moduleMap` or `dependencyGraph` lenses. It is deliberately the poorest element in the vocabulary.

We will not add user-defined kinds, and we will not treat `Note` as a general escape hatch.

## Consequences

- **Positive:** the escape hatch becomes labelled. `grep -c "new Concept(" Architecture.cs` says
  immediately whether a file is an architecture or a figure — which the status quo, where the hatch
  is `Module`, actively hides.
- **Positive:** it renders as a plain box for free under the publication profile, which already
  reduces a node to its name.
- **Positive:** argument diagrams keep the machinery that is worth having — ids, links, view
  membership, the layout solver — without the vocabulary lying.
- **Negative:** one more kind to handle in six engine files and roughly ten client files, and three
  operations that each need minimal / realistic / pathological round-trip fixtures.
- **Negative:** a kind that means nothing is anti-structural, and people will reach for it. This is
  real. It is also already true, just hidden: **you cannot prevent an escape hatch, you can only
  choose whether it is labelled.** An explicit `Concept` quarantines the behaviour where it does no
  semantic damage.
- **Neutral:** `validate` grows two informational checks — a view mixing `Concept` with structural
  kinds is mixing rhetorical registers, and a majority-`Concept` model is a figure rather than an
  architecture. Both are notes, not errors.

## Alternatives considered

**Shapes only, no model.** Argument diagrams as pure presentation on an empty model. Maximally
honest, and it discards ids, links, views and the layout solver — rebuilding a worse draw.io. The
honest follow-through would have been "use draw.io for argument diagrams", which is a legitimate
answer and fails the stated goal of one workflow.

**Workspace-defined custom kinds** (UML stereotypes, ArchiMate profiles). The intellectually cleanest
option, and IDE-creep: an open vocabulary means the reader, writer, validator, renderer and inspector
all stop being able to reason about kinds. The concrete need is one kind, not a system for kinds.
Revisit only if a second, unrelated consumer asks for stereotypes.

**Two document types** — "model workspace" versus "figure". Reuses the presentation investment well,
and costs product surface plus the positioning the README spends four paragraphs defending.

**Status quo: keep reusing `Module`.** Free, and it has already shipped a false diagram.

## Deferred

A neutral link kind, `Relation(Id, FromId, ToId, Label)`. If `Module` was a lie for a box,
`Dependency` is the same lie for an arrow between two ideas — but the rendered label is what shows,
so the picture is already correct and the dishonesty is confined to the source. Meanwhile
`AboutId` edges are synthesised client-side, have no id, and cannot be styled or labelled, which is
why a rendered argument diagram shows generic dashed lines labelled with the literal word "about".
Add `Relation` when a diagram needs a labelled concept-to-concept arrow that must also be *styled*.

## References

- [`F-010`](../../features/F-010-concept-element-kind.md) — the feature record.
- [`agent-authored-diagrams.md`](../../product/agent-authored-diagrams.md) §8 · Q3 — the full reasoning.
