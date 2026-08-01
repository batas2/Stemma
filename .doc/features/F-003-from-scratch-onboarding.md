# Feature: Designing from scratch — the first ten minutes

| Field | Value |
|---|---|
| **ID** | F-003 |
| **Status** | `Draft` |
| **Owner** | Bartosz |
| **Persona served** | Solo solution/data architect starting a new model; consultant architect on a new engagement |
| **Roadmap horizon** | `Now` |
| **Created / Updated** | 2026-08-01 / 2026-08-01 |

## 1. Product — why

- **Problem:** Stemma is good at *opening* an existing model and weak at *starting* one. Walking the
  real path on 2026-08-01 against a scratch directory found six distinct stops:

  1. **You must type an absolute filesystem path.** Create and Open both take a path string; a
     browser cannot open a folder picker for a server-side path. The empty state's instruction is
     literally "Enter a workspace path above."
  2. **Outside development the created workspace cannot load at all.** The scaffold writes
     `<PackageReference Include="Stemma.Model" Version="0.1.0" />` when the local model project is
     not found (`src/Stemma.Web/Program.cs:88`), and `Stemma.Model` is not published to NuGet. In
     development it silently uses a `ProjectReference` instead, so this is invisible to us and fatal
     for everyone else.
  3. **The scaffold targets `net8.0`** while the solution builds `net10.0`.
  4. **The new folder is dirty from the first second.** Loading it immediately writes `obj/` build
     artifacts, and the scaffold creates no `.gitignore` and does not `git init` — so the tool whose
     entire pitch is "Git-native" hands the user an un-versioned folder full of build output.
  5. **After Create, the guidance disappears.** `EmptyState` renders only while *no* workspace is
     open (`src/Stemma.Web.Client/src/App.tsx:298`). The moment a workspace exists you get a blank
     grid. Every way to add the first element — canvas right-click, the sidebar palette, ⌘K — is
     invisible until you already know it exists.
  6. **The first element is a menu hunt,** not a typing flow.

- **Why now:** "start from nothing" is the path every evaluator takes. A consultant opening Stemma
  on a new engagement has no repository to point at yet. Today that person hits a blank grid within
  sixty seconds of a successful install, which is where evaluations end. It is also the cheapest
  place to demonstrate the thesis: the first box a user draws becomes four lines of C# they can read.
- **Value:** the adoption proof point in [vision](../product/vision.md) — "a team uses Stemma for a
  real architecture review and chooses to keep using it" — is gated on this. Ties to *One model,
  many audiences* and *Trustworthy edits*.
- **Out of scope:** multi-user onboarding; a tutorial that replays the whole product; AI-generated
  starter models (a separate idea, and not the fix for a blank canvas).

## 2. User story & acceptance criteria

> As an **architect with nothing yet**, I want to go from launching Stemma to a named element on a
> canvas without knowing anything about `.csproj` files or filesystem paths, so that I can start
> thinking about the architecture instead of the tool.

- [ ] AC1 — From launch, a first element exists on the canvas in **under 60 seconds and under five
      interactions**, without typing a filesystem path.
- [ ] AC2 — Two doors, neither forced: **start from a template** or **start empty**, alongside
      **open an existing repository**.
- [ ] AC3 — A created workspace loads on a machine that has never built Stemma from source.
- [ ] AC4 — A created workspace is a clean Git working tree: `.gitignore` covering `obj/`, `bin/`,
      optional `git init` with one commit, and no build artifacts committed.
- [ ] AC5 — An open-but-empty model shows in-canvas guidance with one primary action, which
      disappears for good once the model has an element.
- [ ] AC6 — Creating an element drops straight into inline rename — type, Enter, done.
- [ ] AC7 — After the first element, the user is shown (once, dismissible) what changed in
      `Architecture.cs`.

## 3. Architecture impact

- [ ] **Model or presentation?** Model side. Templates are ordinary elements created through the
      existing operations — a template is a *script of operations*, never a special file format and
      never a parallel store.
- [ ] **New/changed operations:** none new expected; templates compose existing add/rename/link
      operations. If a batch/transaction wrapper is added so a template applies as one undo step,
      that wrapper needs the ≥3 fidelity fixtures.
- [ ] **Fidelity:** unchanged rules. A template that emits N elements must produce a diff containing
      exactly those N additions — worth a dedicated fixture, since a bulk path is the easiest place
      to regress trivia handling.
- [ ] **Engine purity:** scaffolding is host concern (`Stemma.Web`); the engine only loads and
      rewrites.
- [ ] **Sidecar:** template starting positions are presentation → `stemma.layout.json`, as today.
- [ ] **ADR needed?** Yes, for one thing only: the **SDK-free load path** (below). Templates and
      onboarding UI need none.
- **Affected files/areas:** `src/Stemma.Web/Program.cs` (`/api/workspace/init`),
  `src/Stemma.Engine/Workspace/WorkspaceLoader.cs`, `EmptyState.tsx`, `ArchCanvas.tsx`,
  `Topbar.tsx`, `samples/`.

**The prerequisite that unlocks AC3.** `WorkspaceLoader` requires a `.sln` or `.csproj` and loads it
through `MSBuildWorkspace`, which requires an installed .NET SDK. For a *model-only* workspace —
one that references nothing but `Stemma.Model` — MSBuild earns nothing: parsing `Architecture/*.cs`
into an `AdhocWorkspace` gives the same syntax trees and the same `DocumentEditor` rewrites. Adding
that path means a from-scratch model works with no SDK, no restore, and no NuGet package, and it
removes the packaging blocker in [F-002](./F-002-desktop-shell.md) at the same time. Existing
repository workspaces keep the MSBuild path unchanged. This is the single highest-leverage item in
this record and should be built first.

## 4. UX impact

- [ ] **Journey(s) touched:** J1 gains a "start from nothing" branch — currently J1 assumes a folder
      already containing `Architecture/Architecture.cs`. The "must-handle" note in J1 already
      promises an empty state that explains how to add the first element; that promise is unmet.
- [ ] **States defined:**
      - *No workspace* — the current `EmptyState`, reworked into three doors (Template / Empty /
        Open), each reachable by keyboard, with recents inline.
      - *Empty model* — new. A dashed drop target centred on the canvas, one primary button
        ("Add your first bounded context"), a one-line hint that right-click and ⌘K also work.
      - *First element created* — a dismissible "what just happened" strip showing the added C#.
      - *Scaffold failure* — the real reason and the path attempted, never a bare 400.
- [ ] **Interactions:** create → inline edit immediately; Escape cancels the element rather than
      leaving an "Untitled"; templates land pre-arranged so the first view is never a pile at 0,0.
- [ ] **Accessibility:** every door reachable by Tab with a visible focus ring; the canvas guidance
      must be announced, not just drawn; the primary action needs a real button, not a click target
      on an SVG.

## 5. UI impact

- [ ] **Components touched/added:** rework `EmptyState`; add `EmptyCanvasGuide` and a
      `TemplatePicker`. Document both in [`../ui/components.md`](../ui/components.md).
- [ ] **Tokens:** reuse existing; the dashed drop target likely needs one dashed-border treatment —
      add it as a token rather than a local style.
- [ ] **Both themes:** verify the dashed target and the diff strip in dark and light.
- [ ] **Layout/rail behavior:** guidance lives in the canvas region only; the rails stay as they are,
      disabled-not-hidden while the model is empty.

## 6. Technical prerequisites & dependencies

- [ ] **SDK-free model-only load path** (§3) — do first; unblocks AC3 and F-002 packaging.
- [ ] Fix the scaffold: correct TFM, `.gitignore`, optional `git init`, workspace `README.md`.
- [ ] Decide the default location so no path is ever typed: `~/stemma/<name>` proposed, editable.
- [ ] Templates sourced from the existing `samples/` skeletons (C4-style system + containers;
      DDD bounded contexts + capabilities; data flow) so they stay honest and cost almost nothing.
- [ ] Native folder picker depends on [F-002](./F-002-desktop-shell.md); in browser mode fall back to
      the default location plus recents.
- [ ] If `Stemma.Model` is published to NuGet anyway, it must be version-pinned by the scaffold.

## 7. Test plan

- [ ] Backend: fidelity fixtures for template application (minimal / realistic / pathological);
      a test that scaffolds into a temp dir, loads it **with MSBuild unavailable**, and asserts the
      model reads back.
- [ ] Backend: scaffolded workspace contains `.gitignore` and produces no untracked build output.
- [ ] Frontend: unit tests for the empty-model branch and the template picker's pure logic.
- [ ] Journey regression: create → first element → rename → the guide never returns.
- [ ] A timed manual run of AC1 recorded in this record.

## 8. Definition of Done

- [ ] All ACs met and demoed
- [ ] States handled; accessibility bar met
- [ ] `dotnet test` green · `tsc` clean · `vite build` clean · `vitest` green
- [ ] Model/presentation boundary respected; no new data store
- [ ] Docs updated: `../ux/user-journeys.md` (J1), `../ui/components.md`, `README.md` quick-start
- [ ] Reviewed against all four pillars

## 9. Notes / open questions

- Should a template be a first-class, user-savable concept ("save this model as a template")? Say no
  for v1: it invites a template registry, which is a parallel store by another name.
- The "what just happened" strip is the cheapest demonstration of the whole product thesis. If only
  one item from this record ships, ship the SDK-free path; if two, add this.
