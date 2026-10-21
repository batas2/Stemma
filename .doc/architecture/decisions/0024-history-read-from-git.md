# ADR-0024: What the model was is read from Git, never kept by Stemma

| Field | Value |
|---|---|
| **Status** | `Proposed` |
| **Date** | 2026-10-21 |
| **Deciders** | Bartosz |

## Context

The model is `Architecture/*.cs` and its presentation is `stemma.layout.json`, both in a Git working
tree. Git already holds every version of both. What Stemma cannot do today is *show* a difference:
J6 promises that "reviewers see the change in both the code diff and the canvas", but the canvas only
ever shows the model as it is, so the change itself — what a branch adds, what an evening's edits
did, what moved since a release — is visible only as C# lines in a diff tool
([F-017](../../features/F-017-what-changed.md)).

Showing it needs the model as it was at some revision, and a comparison with the model as it is.
Three questions: where the old model comes from, which layer reads it, and where the comparison runs.

## Decision

1. **The old model is read from Git, on demand, and kept nowhere.** `GET /api/workspace/arch-at?rev=`
   runs `git show <rev>:./Architecture/<file>` for each model file at that revision and parses the
   text with the engine's own reader (`DslReader.TryRead`), merged exactly as the live model is
   (`ArchModelMerge`). The sidecar at that revision comes back as the file says, for where removed
   elements used to sit. Nothing is cached on disk, nothing is written, and closing the comparison
   leaves no trace — Git is the history, as the project's design defaults say.
2. **Git is read by `Stemma.Web`, through the `git` command, not by the engine.** The engine stays
   Roslyn + `Stemma.Model`; it gains only `ArchModelMerge`, the merge the live read already did,
   lifted out so both reads share it. The command line, rather than a library, because the
   self-contained tarball ships no native code today, and because `git` is already what scaffolding a
   model runs (`WorkspaceScaffold`). Every argument goes through `ArgumentList` — never a shell — and a
   revision is refused unless it looks like one (no leading `-`, a short safe alphabet), so a request
   cannot become an option or a command.
3. **The comparison runs in the client**, in `lib/modelDiff.ts`, against the model the canvas already
   has. It is pure, matches by id, and recomputes as the person edits, so a comparison with the last
   commit is a live view of "what have I changed".
4. **No Git is not an error.** A model outside a repository, or a machine without `git`, gets a
   *Compare* control that is visible, greyed, and says why.

## Consequences

- **Positive:** "what changes" is a picture for the first time — for a review, for a meeting about a
  proposal, for an evening's work before committing. No new store, no new file, no new dependency.
- **Negative / trade-offs:** a comparison is as fast as `git show` on a few files — fine for a model,
  not free; the endpoint runs once per comparison and is not polled. Views are compared by what they
  draw now: a view file changed between the revisions is not itself diffed.
- **Neutral:** the same endpoint is what a `stemma diff` for agents would call; it is not built here.

## Alternatives considered

- **LibGit2Sharp** — no process per read, but native binaries per platform in a package that today
  ships none, for a read that happens once per comparison.
- **Snapshots kept by Stemma** (a model copy per session or per save) — a second store of the model;
  rule 3 forbids it, and Git already has every version.
- **Diff on the server** — would send a second model shape over the wire and recompute on every edit;
  the client already holds the current model and redraws on every edit anyway.
- **Reading history in the engine** — would put process and VCS concerns into the layer whose purity
  is a rule (ADR-0008).

## Relationship to the inviolable rules

Fidelity is untouched: nothing is written. Engine purity holds: the engine gains a pure merge; Git is
a web-layer concern. The model/presentation boundary holds: the old model is read, not stored, and the
comparison is session state.

## References

- [F-017](../../features/F-017-what-changed.md) — the feature.
- `src/Stemma.Web/Services/GitHistory.cs`, `src/Stemma.Engine/ArchModel/ArchModelMerge.cs`,
  `src/Stemma.Web.Client/src/lib/modelDiff.ts`.
- [ADR-0008](./README.md) — the engine stays pure.
