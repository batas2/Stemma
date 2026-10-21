# Feature: Designing from scratch — the first ten minutes

| Field | Value |
|---|---|
| **ID** | F-003 |
| **Status** | `Shipped (v1)` |
| **Owner** | Bartosz |
| **Persona served** | Solo solution/data architect starting a new model; consultant architect on a new engagement |
| **Roadmap horizon** | `Now` |
| **Created / Updated** | 2026-08-01 / 2026-08-11 |

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

- [x] AC1 — **Three interactions on the template route, four on the empty one, and no filesystem
      path is typed on either.** Measured rather than estimated — see [§7.1](#71-the-timed-run).
- [x] AC2 — Three doors, none forced: **Start from a template**, **Start empty**, **Open an
      existing one** — plus *Create somewhere else…* in the desktop shell, where a folder picker
      exists. A template is a script of the ordinary operations, so what it leaves behind is
      ordinary C#; see §3.
- [x] AC3 — A created workspace has no project file at all, so it opens with no .NET SDK, no restore
      and no NuGet package ([ADR-0016](../architecture/decisions/0016-sdk-free-model-only-workspaces.md)).
      Asserted over the real HTTP surface against a real folder, because both original failures here
      were invisible from inside a development checkout.
- [x] AC4 — `.gitignore` covering `obj/` and `bin/`, `git init` with one commit, and — asserted —
      `git status --porcelain` empty after the first load, so the user's first diff is their own
      first edit and nothing else.
- [x] AC5 — `EmptyCanvasGuide`: a dashed target with one primary action and a line naming the two
      other ways in. Gone for good once the model has an element, and it does not come back on
      reload.
- [x] AC6 — Creating an element lands in the name field with the text selected. **This was believed
      done and was not** — see [§7.2](#72-what-driving-the-journey-found).
- [x] AC7 — `FirstElementStrip`: once per person, dismissible, showing the line of C# the click
      produced — **read back out of `Architecture.cs`**, never rendered from the model.

## 3. Architecture impact

- [x] **Model or presentation?** Model side. A template is a **script of operations** — the same
      `AddElement` / `AddLink` a person would perform by hand, applied in order. Nothing is stored
      that describes a template, so a templated model is indistinguishable from a hand-built one and
      there is nothing to migrate when the vocabulary moves. `lib/templates.ts` holds the
      definitions and the ordering; the impure runner that talks to the engine is injected, which is
      what makes the ordering testable without a backend.
- [x] **New/changed operations:** none. No batch wrapper was added, so no new fidelity fixtures are
      owed: a template applies as N ordinary operations and undoes as N ordinary undos. That is
      arguably worse for undo and better for everything else, and reversing it later costs nothing.
- [x] **Fidelity:** unchanged. Nothing here writes source except the existing operations.
- [x] **Engine purity:** preserved. The engine gained one *read* — `ReadDeclarationAsync`, which
      finds the statement declaring an id on the syntax tree it already has. Pure Roslyn, no web.
- [x] **Sidecar:** template starting positions are presentation → `stemma.layout.json`, as today.
      The "have I been shown the explainer" flag is neither model nor presentation — it is a fact
      about the reader, so it is per-user in `localStorage`. Committing one person's onboarding into
      everyone else's repository is exactly the drift rule 3 exists to prevent.
- [x] **ADR needed?** Only for the SDK-free load path, which is
      [ADR-0016](../architecture/decisions/0016-sdk-free-model-only-workspaces.md) and shipped.
- **Affected files/areas:** `src/Stemma.Engine/ArchModel/DslReader.cs` (`FindDeclaration`),
  `src/Stemma.Engine/Workspace/StemmaEngine.cs` (`ReadDeclarationAsync`),
  `src/Stemma.Web/StemmaWebHost.cs` (`GET /api/workspace/source/{id}`),
  `src/Stemma.Web.Client/src/lib/templates.ts` and `lib/onboarding.ts` (**new**),
  `components/FirstElementStrip.tsx` (**new**), `EmptyState.tsx`, `ArchCanvas.tsx`,
  `nodes/ArchNodeView.tsx`.

**The prerequisite that unlocked AC3 — shipped.** `WorkspaceLoader` requires a `.sln` or `.csproj`
and loads it through `MSBuildWorkspace`, which requires an installed .NET SDK. For a *model-only*
workspace MSBuild earns nothing: parsing `Architecture/*.cs` into an in-memory workspace gives the
same syntax trees and the same `DocumentEditor` rewrites. `ModelWorkspaceLoader`
([ADR-0016](../architecture/decisions/0016-sdk-free-model-only-workspaces.md)) does that, the
scaffold now emits no project file at all, and repository workspaces keep the MSBuild path
unchanged. It also removed the packaging blocker in [F-002](./F-002-desktop-shell.md), which is why
it was built first.

## 4. UX impact

- [x] **Journey(s) touched:** J1 gains its "start from nothing" branch, and the promise it already
      made — an empty state that explains how to add the first element — is now kept.
- [x] **States defined:**
      - *No workspace* — `EmptyState`, three doors (Template / Empty / Open), each a real button,
        with recents inline.
      - *Empty model* — `EmptyCanvasGuide`: a dashed target centred on the canvas, one primary
        button, and a line naming right-click and ⌘K.
      - *First element created* — `FirstElementStrip`, dismissible, showing the added C#.
      - *Scaffold failure* — the reason from the server, surfaced as a toast rather than a bare 400.
- [x] **Interactions:** create → inline edit immediately (and it now actually focuses — §7.2);
      Escape cancels; a template lands pre-arranged, and a test asserts no two of its elements share
      a position so the first view is never a pile at 0,0.
- [x] **Accessibility:** every door is a real `<button>` reachable by Tab with a visible focus ring;
      the guide is a labelled `region` and the strip a labelled `status`, so both are announced
      rather than only drawn; the rename field gained an `aria-label` — it is the first thing a
      screen-reader user meets on the canvas and it was announcing as "edit text, blank".

## 5. UI impact

- [x] **Components touched/added:** `EmptyState` reworked to three doors; `EmptyCanvasGuide` and
      `FirstElementStrip` added. **No `TemplatePicker` component** — the existing `pickFromList`
      dialog already is one, and a second list surface would have to be kept in step with it for no
      gain. The templates carry a box count as the hint, which is what the choice actually turns on.
- [x] **Tokens:** reused. The dashed target is one border treatment in one place; promoting it to a
      token before a second user exists would be inventing a system for an audience of one.
- [x] **Both themes:** the guide and the strip both carry explicit dark variants.
- [x] **Layout/rail behavior:** guidance lives in the canvas region only; the rails are unchanged.

## 6. Technical prerequisites & dependencies

- [x] **SDK-free model-only load path** (§3) — done first, and it unblocked F-002 packaging too.
- [x] Scaffold fixed: no project file at all (so no TFM to be wrong), `.gitignore`, `git init` with
      one commit, workspace `README.md`, and a `STEMMA.md` brief ([F-007](./F-007-sidecar-schema-and-protocol.md) AC6).
- [x] Default location: `~/stemma/<name>`, so a model is created by *name* and no path is typed.
- [x] Templates mirror the sample shapes — C4 system + containers, DDD contexts + capabilities, and
      a data flow — each at or under seven boxes, which is the rule every workspace's brief teaches.
- [x] Native folder picker via [F-002](./F-002-desktop-shell.md); in a browser tab the default
      location plus recents, as designed.
- [x] Recents (`~/.stemma/recent.json`, replaced whole on every write): a folder that is missing
      when the list is read — a drive not plugged in, a checkout moved — stays on it.
      `GET /api/workspace/recents` marks it `missing: true`, and it leaves the list only when pushed
      off the end or removed with `DELETE /api/workspace/recents?rootPath=…`. Folders are compared
      as the file system compares them: case matters on Linux.
- [x] `Stemma.Model` is not published to NuGet and no longer needs to be: the scaffold references
      nothing.

## 7. Test plan

- [x] Backend: **no fidelity fixtures owed** — no batch wrapper was added, so a template is N
      ordinary operations, each already covered. `DslDeclarationTests` covers the one new engine
      read, including that the snippet is the file's own text and that an id which is not there is
      not invented.
- [x] Backend: `FromScratchJourneyTests` drives `POST /api/workspace/init` against a real folder and
      asserts what is on disk — no `.csproj` or `.sln` anywhere, the model readable straight away,
      `STEMMA.md` and `.gitignore` present, no `obj/` or `bin/`, and `git status --porcelain` empty.
- [x] Frontend: `onboarding.test.ts` for the empty-model branch and the show-once rule;
      `templates.test.ts` for the picker's data and the applier's ordering, ref mapping and partial
      failure.
- [x] Journey regression: `tests/journey/first-ten-minutes.spec.ts` — create → first element →
      rename → the guide never returns, including across a reload.
- [x] A timed run of AC1, below.

### 7.1 The timed run

`npm run test:journey` (Playwright, against the production server — the same single-origin shape a
packaged Stemma runs in). Both routes measured on 2026-08-11:

| Route | Interactions | Machine time, cold | Machine time, warm |
|---|---:|---:|---:|
| Start from a template → pick → name | **3** | 2.0 s | 0.5 s |
| Start empty → name → add → rename | **4** | — | 0.4 s |

Neither asks for a filesystem path. AC1's sixty seconds is a budget for a person who is also reading
and deciding; what the harness can honestly measure is the machine's share of it, and that is under
two seconds even on the first run of a cold server. The interaction counts are the part that
mattered and they are counted, not estimated: three and four, against a bar of five.

The harness uses the installed Chrome (`channel: 'chrome'`) rather than Playwright's own build,
which is the same choice `stemma render` makes — Playwright ships browsers per distribution and
stops resolving one as soon as the machine is newer than the pinned version.

### 7.2 What driving the journey found

**AC6 was believed done and was not.** `addElementAt` has called `handleStartRename` since the
feature was written, the editor mounts, calls `focus()` and `select()`, and the code reads as
obviously correct. It was not: React Flow keeps a node `visibility: hidden` until it has measured
it, a newly created element mounts its editor before that measurement, and `focus()` on a hidden
element does nothing at all. The field appeared, ready to type into, and what you typed went to the
canvas as keyboard shortcuts.

Nothing in the unit suite could see this — every part behaved correctly in isolation, which is the
same shape as the render bugs on the bug board: *a call that succeeds is not an outcome that
happened*. The fix retries the focus for up to thirty frames and stops the instant it takes; the
journey test asserts `toBeFocused` rather than merely that the field exists, which is the assertion
that would have caught it in the first place.

Two smaller things the same pass surfaced: the rename field had no accessible name, so it announced
as "edit text, blank" to a screen reader — and it is the first thing on the canvas an element's
creator meets. And the backend holds one workspace per process and reopens it on reload, so "from
launch" in a test means closing the workspace first; correct behaviour, and the wrong starting point
for a measurement.

## 8. Definition of Done

- [x] All ACs met and demoed
- [x] States handled; accessibility bar met
- [x] `dotnet test` green · `tsc` clean · `vite build` clean · `vitest` green
- [x] Model/presentation boundary respected; no new data store — a template leaves behind ordinary
      C#, and the show-once flag is per-user app state, not presentation
- [x] Docs updated: `../ux/user-journeys.md` (J1), `../ui/components.md`, `README.md`
- [x] Reviewed against all four pillars

## 9. Notes / open questions

- Should a template be a first-class, user-savable concept ("save this model as a template")? Still
  no: it invites a template registry, which is a parallel store by another name. The current shape
  makes that answer cheap to hold — there is no template artefact to promote.
- The "what just happened" strip is the cheapest demonstration of the whole product thesis, and it
  is now the only place in the product where the claim is *shown* rather than asserted. It is worth
  protecting: the moment it renders anything composed from the model rather than read from the file,
  it stops being evidence and becomes decoration.
- **Still open, and small.** The journey spec is local-only, like the visual specs — CI runs neither,
  because both need a browser the runner does not have. A template applies as N undo steps rather
  than one; a batch wrapper would fix that and owes three fidelity fixtures if it is ever written.
