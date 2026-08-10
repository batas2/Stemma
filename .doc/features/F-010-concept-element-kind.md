# Feature: The `Concept` element kind

| Field | Value |
|---|---|
| **ID** | F-010 |
| **Status** | `Shipped` (v1) |
| **Owner** | Bartosz |
| **Persona served** | The Essayist's Agent ("Ada") |
| **Roadmap horizon** | `Next` |
| **Created / Updated** | 2026-08-08 / 2026-08-08 |

## 1. Product — why

- **Problem:** Stemma's only vocabulary is C4 + DDD, so drawing an essay's argument means declaring
  "Contracts at the seams" a `Module` and "What the repository can answer" a `BoundedContext`. It
  compiles, it validates, and it is false in the one way this product exists to prevent: the model
  asserts a bounded context that does not exist.
- **Why now:** F-004 and F-006 make argument diagrams routine, which makes the abuse routine.
- **Value:** the escape hatch becomes labelled instead of hidden. `grep -c "new Concept(" ` tells you
  instantly whether you are looking at an architecture or at a figure.
- **Out of scope:** user-defined kinds; a neutral link kind (see §9).

## 2. User story & acceptance criteria

> As **Ada**, I want a box that asserts nothing about a system so that an essay's argument does not
> have to claim it is a bounded context.

- [x] AC1 — `Concept(Id, Name)` exists in `Stemma.Model` with no context, system, lifecycle or
      ownership semantics.
- [x] AC2 — It belongs to no built-in lens; it appears only in views that name it.
- [x] AC3 — It renders as a plain box, automatically under the publication profile.
- [x] AC4 — `AddElement` / `RenameElement` / `RemoveElement` handle it with full round-trip fidelity.
- [x] AC5 — `validate` warns when a view mixes `Concept` with structural kinds, and notes when a model
      is majority-`Concept` — "this is a figure, not an architecture". Both informational.

## 3. Architecture impact

- [x] **Model or presentation?** Model. **This is the only engine change in the whole programme.**
- [x] **New/changed operations:** `AddElementOp`, `RenameElementOp`, `RemoveElementOp` for the new
      kind — each needs **≥3 round-trip fixtures (minimal / realistic / pathological) written before
      the implementation**, per [`../engineering/conventions.md`](../engineering/conventions.md).
- [x] **Fidelity:** directly in scope. `DslWriter` must emit `new Concept(...)` without disturbing
      trivia; no `NormalizeWhitespace`, no string rebuilds.
- [ ] **Engine purity:** unaffected.
- [ ] **Sidecar:** unaffected.
- [x] **ADR needed?** **Yes** — written as [ADR-0018](../architecture/decisions/0018-concept-element-kind.md). A vocabulary addition is exactly the kind of decision the ADR template
      exists for, and the reasoning — that you cannot prevent an escape hatch, only choose whether it
      is labelled — should outlive this record.
- **Affected files/areas:** `Stemma.Model/Concepts.cs`, `ArchModel.cs` (`ArchElementKind`),
  `DslReader`, `DslWriter`, `StemmaEngine`, `SeedRules`, both exporters; roughly ten client files
  (`types.ts`, `naming.ts`, `propertySchema.ts`, `autoLayout.ts`, `Sidebar.tsx`, `ArchCanvas.tsx`,
  `ArchNodeView.tsx`, the report viewer).

## 4. UX impact

- [ ] **Journey(s) touched:** adding an element; authoring an argument diagram as text.
- [ ] **States defined:** nothing new.
- [ ] **Interactions:** `Concept` appears in the add-element palette, last, described as
      "a box that asserts nothing".
- [ ] **Accessibility:** unchanged.

## 5. UI impact

- [ ] **Components touched/added:** the node needs a neutral icon and accent — deliberately the
      poorest-looking element in the vocabulary, because that poverty is the point.
- [ ] **Tokens:** reuse.
- [ ] **Both themes:** required.

## 6. Technical prerequisites & dependencies

- [ ] Nothing blocks it. It is sequenced last precisely because nothing waits on it.

## 7. Test plan

- [x] Round-trip fixtures: twelve, across minimal / realistic / pathological.
- [x] `DslReader` reads a `Concept` declaration; `DslWriter` emits one that reads back identically.
- [ ] A sample workspace exercising it, so the kind is covered by something that ships.
- [x] `validate` emits the two checks.

## 8. Definition of Done

- [x] ACs met · [x] fidelity suite green · [x] ADR written and referenced · [x] docs updated
- [ ] A figure-shaped sample workspace. Aurora Rail is an architecture and deliberately has no
      `Concept`; its coverage assertion excludes the kind for that reason, which means nothing that
      ships exercises it yet.

## 9. Notes / open questions

**No longer deferred: `Relation` shipped on 2026-08-08 — see [ADR-0019](../architecture/decisions/0019-relation-link-kind.md).** The reasoning as it stood when deferred: If `Module` was a lie for a box, `Dependency` is the
same lie for an arrow between two ideas. Three things are true: the rendered label is what shows, so
the picture is already correct and the dishonesty is confined to the source; `Question`/`Assumption`/
`Risk` express relation through `AboutId`, whose edges are synthesised client-side and therefore have
no id, no styling and no custom label — which is exactly why a rendered argument diagram shows
generic dashed lines labelled with the literal word "about"; and a third kind `Relation(Id, From, To,
Label)` would fix both at the cost of another set of fidelity fixtures.

Ship `Concept` with `Dependency` first. Add `Relation` when an argument diagram needs a labelled
concept-to-concept arrow that must also be *styled* — dashed for a broken path, accent for the
answer — which the benchmark diagram uses.
