# Feature: C4 views and views by rule

| Field | Value |
|---|---|
| **ID** | F-023 |
| **Status** | In progress |
| **Owner** | Bartosz |
| **Persona served** | The Architect's Agent ("Theo"); Solution Architect ("Aria") |
| **Roadmap horizon** | Next |
| **Created / Updated** | 2026-10-22 / 2026-10-22 |

## 1. Product — why

- **Problem:** three things architects expect of a C4 diagram are missing. The containers are not drawn
  inside their system (A7). A view is a list of ids — seventeen for one container view — and a missed
  id silently drops an arrow (A12). And a container has no technology and nothing has a description,
  so a card cannot say *"Order Service — .NET 8 — accepts and tracks orders"*, which is what a C4
  container card is.
- **Why now:** agents write C4 by default when asked for an architecture; the vocabulary should meet
  them there.
- **Value:** *one model, many views*, with the views stated as intent — "the containers of the platform
  and whatever talks to them" — the way Structurizr and LikeC4 state them.
- **Out of scope:** a Component kind (C4 level 3) — modules within a context already cover it; deployment
  views; dynamic views (books with steps, F-020, already tell a flow).

## 2. User story & acceptance criteria

> As **an agent writing a C4 model**, I want to **name a view by its scope and rules, and have its
> boundary and its neighbours drawn for me** so that **the view is right without my listing its members
> and stays right when the model grows**.

- [x] **AC1 — Views by rule.** `View` takes `Scope`, `Include` and `Exclude`; `ElementIds` becomes
  optional. Members are: the lens's members (AC2–AC3), then `ElementIds`, then what `Include` selects,
  minus what `Exclude` selects — de-duplicated, in that order.
- [ ] **AC2 — System context lens.** `BaseView: "systemContext"`, `Scope: "<system id>"` draws the
  system, and every person and software system related to it or to any of its containers. A relationship
  to a container is drawn to its system ("implied"), and implied relationships between the same two
  ends are drawn once, their labels combined.
- [ ] **AC3 — Container lens.** `BaseView: "container"`, `Scope: "<system id>"` draws the system as a
  boundary around its containers, and every person, software system and other system's container
  related to them — the last drawn as its own system, implied as in AC2.
- [x] **AC4 — Selectors.** `Include`/`Exclude` take selector strings ([ADR-0026](../architecture/decisions/0026-views-by-rule.md)):
  an id; `<id>.*` (its children — a system's containers, a context's modules and capabilities);
  `*`; `kind:<kind>`; filters `[attr=value]`, `[attr!=value]`, `[attr=a|b]` on any attribute, lifecycle
  status/phase and ownership squad/domain; and `->X`, `X->`, `->X->` for X and its neighbours.
- [ ] **AC5 — One resolution.** Members and implied links are resolved in the engine; the canvas, the
  report, `validate`, `render` and `inspect` all use that result.
- [ ] **AC6 — Description and technology** ([ADR-0027](../architecture/decisions/0027-description-and-technology.md)):
  `Person.Description`, `SoftwareSystem.Description`, `Container.Technology` and `Container.Description`,
  `DataFlow.Technology` — read, drawn (the card's kind line carries the technology, its body the
  description; a flow's label reads `payload [technology]`; the publication card adds the technology in
  small type under the name), and edited in the inspector through `SetElementAttribute` /
  `SetLinkAttribute`, each with fidelity fixtures.
- [ ] **AC7 — Editing a rule-based view.** Adding an element on the canvas writes it to `ElementIds`.
  Removing one that a rule brought in writes it to `Exclude`, so the rule stays live. Saving edits the
  view in place and keeps `Scope`, `Include` and `Exclude` as written.
- [x] **AC8 — Checked.** `view/bad-scope` (error: a C4 lens without a scope, or a scope that is not a
  software system); `view/dangling-include` (error for an id that does not exist, warning for a selector
  that selects nothing); `view/bad-selector` (error, with the position of the fault). `view/half-link`
  respects implied links.
- [x] **AC9 — See what a rule selected.** `stemma inspect --view <id> [--json]` lists the members and what
  brought each one in, the links drawn, the implied links, and the relationships left out.
- [ ] **AC10 — Laid out.** A C4 lens with no layout is laid out by F-021 with its boundary as a group.

## 3. Architecture impact

- [x] **Model or presentation?** Model: `View`'s new arguments and the new element/link fields are C#.
  The boundary and implied links are derived when drawing, never stored.
- [x] **New/changed operations:** `SetElementAttribute` accepts `description` (Person, SoftwareSystem,
  Container) and `technology` (Container); `SetLinkAttribute` accepts `technology` (DataFlow) — the
  existing operations, through the vocabulary; ≥3 fidelity fixtures each. Saving a view keeps and edits
  `Exclude`.
- [x] **Fidelity:** edits go through `DslWriter.SetArgument` and `ViewsAdapter.Edit` — no rebuilt
  declarations, no string assembly of an existing file.
- [x] **Engine purity:** selector evaluation is a pure function of the model.
- [x] **Sidecar:** none.
- [x] **ADR needed?** [ADR-0026](../architecture/decisions/0026-views-by-rule.md),
  [ADR-0027](../architecture/decisions/0027-description-and-technology.md).
- **Affected files/areas:** `src/Stemma.Model/Concepts.cs`; `src/Stemma.Engine/ArchModel/DslVocabulary.cs`,
  `ViewsAdapter.cs`, `Selectors.cs` and `ViewProjection.cs` (new); the views API in `Stemma.Web`;
  `src/Stemma.Cli/WorkspaceCheck.cs`, `InspectCommand.cs` (new); client `lib/viewFilter.ts`,
  `lib/types.ts`, `components/ArchCanvas.tsx` (system frames, implied edges), `ArchNodeView.tsx`,
  `PublicationNode.tsx`, `ArchInspector.tsx`, `lib/linkLabel.ts`; schema untouched.

## 4. UX impact

- [x] **Journey(s) touched:** reading a C4 view; editing a view's members; inspecting an element.
- [x] **States defined:** an implied link is drawn like a link but is not selectable for editing (it has
  no declaration); hovering it lists the relationships it stands for. A view whose rule selects nothing
  is the existing empty view state.
- [x] **Interactions:** removing a rule-selected element from a view says so in the toast ("Hidden from
  this view — it was included by `sys_platform.*`").
- [x] **Accessibility:** new inspector rows are ordinary text fields.

## 5. UI impact

- [x] **Components touched/added:** system boundary frame (shared with F-021's groups); card kind line
  with technology; card description; inspector rows for technology and description.
- [x] **Tokens:** existing frame and text tokens.
- [x] **Both themes:** checked.
- [x] **Layout/rail behavior:** unchanged.

## 6. Technical prerequisites & dependencies

- [x] F-021 (the lenses default to the layered layout).
- [x] `Stemma.Model` gains parameters: source-compatible for every existing workspace (all are optional
  and at the end).

## 7. Test plan

- [x] Selector unit tests — every form, filters, neighbours, errors with positions (`SelectorTests`).
- [x] Projection tests — both lenses on a model with people, two systems, containers and cross-system
  flows: members, boundary, implied links and their combined labels (`ViewProjectionTests`; the labels
  are combined by the client from each implied link's `linkIds`).
- [x] Fidelity — `SetElementAttribute description/technology` and `SetLinkAttribute technology` on the
  three `arch` fixtures; `ViewsAdapter.Edit` keeping `Scope`/`Include` and adding to `Exclude`, in the
  forms a view can be written in (`FidelityCases`, `ViewRulesWriteTests`).
- [x] `WorkspaceCheckTests` — the new findings; `InspectCommand` output (`InspectCommandTests`); the views API (`ViewEndpointTests`).
- [ ] Client — `viewFilter` with members and implied links; the canvas draws a boundary.
- [ ] A C4 sample (`samples/FoodDelivery`) with a system context and a container view.

## 8. Definition of Done

- [ ] All ACs met and demoed
- [ ] States handled; accessibility bar met
- [ ] `dotnet test` green · `tsc` clean · `vite build` clean · `vitest` green
- [ ] Model/presentation boundary respected; no new data store
- [ ] Docs: `domain-model.md`, protocol §2–§3, the operations catalog
- [ ] Reviewed against all four pillars

## 9. Notes / open questions

- The selector language is shared with [F-024](./F-024-architecture-rules-as-code.md)'s rules (without
  the neighbourhood forms), so an agent learns it once.
- The container's `kind` (`service`, `db`, …) stays; `technology` is what it is built with.
- **Engine half (done):** AC1, AC4, AC8 and AC9 are met. Of AC2/AC3, membership and implied links are
  resolved (`ViewProjection`) and the canvas has to draw them; of AC5, `validate`, `render` (the
  fingerprint), `inspect`, the draw.io export and `GET /api/workspace/views` use the resolution, and the
  canvas and the report have to; of AC6, the fields are read, edited and fidelity-tested, and are not yet
  drawn; of AC7, saving keeps and edits `Scope`, `Include` and `Exclude` in place, and the canvas has to
  write additions to `ElementIds` and removals to `Exclude`.

### Implementation notes (calls the spec left open)

- **Order of members.** Lens members in model order; then `ElementIds` as written; then the union of
  every include's selection in model order, each member credited to the first include that selected it.
  Ids that name nothing are never members (`view/dangling-member` says so).
- **Lifting is general.** In either C4 lens, an end that is not a member but whose system is stands for
  that system — the scope's own containers in a system context, another system's in either, and a scope
  container excluded from a container view. A system context therefore also brings in the system of
  another system's container related to the scope. A link lifted onto a container and its own system
  draws nothing (an arrow from a card to its own boundary) and is left out; a link both of whose ends
  lift to one element is internal and not left out.
- **Real links win, per direction.** An implied link is suppressed only by a real drawn link joining the
  same two ends in the same direction, as Structurizr does; a link it would have stood for is then not a
  half-link.
- **Scope on another lens** is a `view/bad-scope` *warning* (ignored), not an error.
- **`view/dangling-include` is an error whenever the selector names an id that does not exist** — `x`,
  `x.*`, `->x`, filtered or not — and a warning when a selector names no id (`*`, `kind:`) and selects
  nothing. An `Exclude` naming a missing plain id is `view/dangling-exclude` (warning); one selecting
  nothing is silent.
- **Selector details.** An unknown kind is a parse error. Ids may hold letters, digits, `_`, `-`, `.` and
  `:` (`->` and `.*` end one). Filters also read `id` and `name`, and a parameter's default when it is not
  written (`[kind=service]` matches a container written without a kind). Positions are 1-based.
- **API.** `PUT /api/workspace/views` leaves `name`, `baseView` and `elementIds` as written when sent as
  null too, refuses a save with no id, and clears a scope sent as `""`. Removing a whole `Include` or
  `Exclude` is done by sending `[]`.
- **`stemma inspect` exits `1`** when the view has an error-severity problem, like `validate`.
