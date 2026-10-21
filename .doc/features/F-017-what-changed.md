# Feature: What changed — the difference between two versions, drawn on the canvas

| Field | Value |
|---|---|
| **ID** | F-017 |
| **Status** | `Shipped` |
| **Owner** | Bartosz |
| **Persona served** | Solution Architect ("Aria") presenting a proposal; Senior Engineer ("Sam") reviewing one |
| **Roadmap horizon** | `Next` |
| **Created / Updated** | 2026-10-21 / 2026-10-21 |
| **ADR** | [ADR-0024](../architecture/decisions/0024-history-read-from-git.md) |

## 1. Product — why

- **Problem:** the canvas shows the model as it is. What a branch changes, what an evening's edits did
  before they are committed, what moved since the last release — the thing a review or a proposal
  meeting is actually about — is visible only as C# lines in a diff tool. J6 promises that a reviewer
  "sees the change in both the code diff and the canvas"; on the canvas they see only the result.
- **Why now:** it is the one thing only Stemma can do well: the model *is* code in Git, so every
  version of the architecture already exists, matched by stable ids.
- **Value:** "here is what we propose to change" becomes a picture: new boxes in green, what goes in
  red where it used to be, what is altered in amber with what changed about it — live, as you edit.
- **Out of scope:** diffing the view files themselves (a view is compared by what it draws now);
  comparing two old revisions with each other; merging; a `stemma diff` for agents (the endpoint is
  there for it).

## 2. User story & acceptance criteria

> As an **architect**, I want to **see what changed since a commit, a tag or the start of my branch,
> drawn on the diagram**, so that **a proposal or a review is about the change, not a hunt for it**.

- [x] AC1 — **Compare** in the top bar opens a list of what to compare with: *the last commit* (your
      uncommitted changes, with how many there are), *where this branch started* (when on a branch
      other than the default one), the repository's tags, and its recent commits touching the model —
      subject, short id, author and when. A model outside a Git repository, or a machine without
      `git`, gets the control greyed with the reason in its tooltip.
- [x] AC2 — Comparing, the canvas marks **added** elements in green ("New"), **changed** ones in amber
      ("Changed"), and draws **removed** ones as ghosts — dashed, faded, struck through, "Removed" —
      where they used to be (from the sidecar at that revision, else where the current one remembers
      them, else in a row under the view). Relationships likewise: added in green, changed in amber,
      removed as faded dashed red lines. Everything unchanged is dimmed, which can be turned off.
- [x] AC3 — A bar at the bottom of the canvas says what is being compared and the counts, opens the
      **list of changes** — grouped, each with what changed about it ("Renamed from …", "Status target
      → current", "Moved to Payments", "Payload a → b") — and ends the comparison (*Done*, or Escape
      with nothing selected). Choosing an entry shows it: an element goes through F-016's reveal; a
      removed one centres its ghost.
- [x] AC4 — The comparison is **live**: edit the model and the marks follow, so comparing with the
      last commit is a running answer to "what have I changed".
- [x] AC5 — Selecting a changed element, the inspector says what changed about it since that version.
- [x] AC6 — The status bar says how many changes there are since the last commit when there are any,
      and a click on it compares with the last commit.
- [x] AC7 — Nothing is written: comparing, editing while comparing and ending it leave the files as
      the edits alone would; ghosts are never positions in the sidecar.

## 3. Architecture impact

- [x] **Model or presentation?** Neither: the old model is read from Git on demand
      ([ADR-0024](../architecture/decisions/0024-history-read-from-git.md)); the comparison is session state.
- [x] **New/changed operations:** none. Two read endpoints: `GET /api/workspace/history`,
      `GET /api/workspace/arch-at?rev=`.
- [x] **Engine purity:** the engine gains `ArchModelMerge` (the merge its live read already did), no Git.
- [x] **Sidecar:** none.
- **Affected files/areas:** `Stemma.Web/Services/GitHistory.cs`, `StemmaWebHost.cs`,
  `Stemma.Engine/ArchModel/ArchModelMerge.cs`, `lib/modelDiff.ts`, `lib/api.ts`, `lib/store.ts`,
  `Topbar.tsx` / `CompareMenu.tsx`, `CompareBar.tsx`, `ArchCanvas.tsx` (marks, ghosts),
  `ArchNodeView.tsx` (badge), `ArchInspector.tsx`, `StatusBar.tsx`.

## 4. UX impact

- [x] **Journey(s) touched:** J6 (export & share): step 2 gains "and see it"; a new J6d, *show a change*.
- [x] **States:** *not a repository / no git* — control greyed with the reason; *loading* — the list
      shows its rows as they arrive; *error* — a revision that cannot be read says so in a toast and the
      canvas is left as it was; *nothing changed* — the bar says "No changes", not an empty list;
      *a model that did not exist then* — everything is "New".
- [x] **Interactions:** click Compare; ↑↓ Enter in the list of changes; Escape ends.
- [x] **Accessibility:** colour is never the only signal — every mark carries a word badge and ghosts
      are struck through; the bar is a labelled region; the list is a list of buttons.

## 5. UI impact

- [x] **Components:** `CompareMenu` (new), `CompareBar` (new), node badge, ghost layer (drawn in the
      canvas's own coordinates, outside its node list).
- [x] **Tokens:** emerald (added), amber (changed), rose (removed) — the roles they already have.
- [x] **Both themes:** checked.

## 7. Test plan

- [x] Web: history and model-at-revision on a scratch repository — a rename, a removal, a revision that
      does not exist, a revision that tries to be an option, a folder that is not a repository
      (`GitHistoryTests`).
- [x] Engine: the merge is the one the live read uses (`ArchModelMerge` via the existing load tests).
- [x] Client unit: the diff — added, removed, renamed, re-parented, retagged, link payload changed,
      a model that did not exist (`modelDiff.test.ts`).
- [x] Journey: rename an element and remove another in a scratch repository, compare with the last
      commit — one "Changed", one ghost — and the files are as the edits left them
      (`tests/journey/compare.spec.ts`).

## 8. Definition of Done

- [x] All ACs met and demoed
- [x] States handled; accessibility bar met
- [x] `dotnet test` green · `tsc` clean · `vite build` clean · `vitest` green · journeys green
- [x] Docs updated: this record, ADR-0024 and the decision index, the features index,
      `ux/user-journeys.md`, `ui/components.md`, `architecture/engine-backend.md` (endpoints)

## 9. Notes / open questions

- **Found on the way:** the validation strip said "1 errors".
- **Next, if wanted:** a book page that shows its view compared with a revision ("what this proposal
  changes", in a deck); `stemma diff <rev>` for agents, on the same endpoint; diffing view files.
