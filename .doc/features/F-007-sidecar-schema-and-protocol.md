# Feature: Sidecar schema, protocol reference, and workspace `STEMMA.md`

| Field | Value |
|---|---|
| **ID** | F-007 |
| **Status** | `Shipped (v1)` |
| **Owner** | Bartosz |
| **Persona served** | The Essayist's Agent ("Ada") |
| **Roadmap horizon** | `Next` |
| **Created / Updated** | 2026-08-08 / 2026-08-11 |

## 1. Product — why

- **Problem:** the rich sections of `stemma.layout.json` were deliberately undocumented — the client
  owned their schema and the engine persisted them verbatim. Right for velocity, and a broken
  contract the moment a second writer exists. Anyone authoring the format had to read four
  TypeScript files.
- **Why now:** F-004 and F-006 create that second writer.
- **Value:** an agent can author a workspace from a document instead of from source archaeology.
- **Out of scope:** validating documents at runtime; the format stays permissive.

## 2. User story & acceptance criteria

> As **Ada**, I want one document describing the whole chain — vocabulary, view, layout, render — so
> that I can write a correct workspace on the first attempt.

- [x] AC1 — `schema/stemma.layout.schema.json` describes the sidecar and is checked in.
- [x] AC2 — Every sidecar carries a `$schema` pointer, and an existing one is never overwritten.
- [x] AC3 — The schema permits additional properties everywhere, because the format is pass-through
      and a schema that forbade unknown members would bless B-001.
- [x] AC4 — Tests fail if a section the engine models is missing from the schema, or if the version
      or `$id` drift from the engine's constants.
- [x] AC5 — `.doc/protocol/authoring-a-diagram.md` covers `Architecture.cs` → `Views/<Name>.cs` →
      `stemma.layout.json` → render, with three complete worked examples (argument, C4, dependency).
- [x] AC6 — `WorkspaceScaffold` drops a `STEMMA.md` brief at the root of every new workspace. It
      carries the vocabulary, the id prefixes, and the four rules nothing else enforces (unique ids,
      a link needs both endpoints in the view, seven boxes, never add an element to fix a picture),
      then hands the reader `stemma validate`. Deliberately not a copy of the protocol reference:
      the reference is what you read next, this is what has to be true first.

## 3. Architecture impact

- [x] **Model or presentation?** Documentation of the presentation format.
- [x] **New/changed operations:** none.
- [x] **Fidelity:** untouched.
- [x] **Engine purity:** `LayoutSidecar` gains a `$schema` property and a constant.
- [x] **Sidecar:** `$schema` is now a modelled member.
- [x] **ADR needed?** No, but it *is* a reversal: the rich sections stop being client-private. That
      is deliberate and is argued in the analysis.
- **Affected files/areas:** `schema/`, `src/Stemma.Engine/Workspace/LayoutSidecar.cs`,
  `tests/Stemma.Engine.Tests/LayoutSchemaTests.cs`, `samples/*/stemma.layout.json`.

## 4. UX impact

- [x] Editors validate the file live once the pointer is present. No in-app surface.

## 5. UI impact

- [x] None.

## 6. Technical prerequisites & dependencies

- [x] B-001, which the schema documents the consequences of.

## 7. Test plan

- [x] Schema parses; documents every modelled section; keeps the format open; version and `$id`
      match the engine; `Write` stamps the pointer and never overwrites one.
- [ ] Validating the sample sidecars against the schema. Needs a JSON Schema dependency the solution
      does not carry; the coherence tests are the cheaper guard chosen instead.

## 8. Definition of Done

- [x] Schema shipped and guarded · [x] protocol reference written · [x] scaffold updated

## 9. Notes / open questions

Writing the schema settled a question the code had left open: the top-level `annotations` section is
dead. It is declared, read and preserved, but nothing has written it since free-form shapes moved to
`views.<key>.shapes`. It is marked deprecated rather than documented as if it were live — which is
the sort of thing publishing a schema is good at surfacing.
