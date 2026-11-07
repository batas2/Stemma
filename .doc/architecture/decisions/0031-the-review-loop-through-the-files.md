# ADR-0031: The review loop runs through the files: comments written by the CLI, the change computed in the engine

| Field | Value |
|---|---|
| **Status** | `Proposed` |
| **Date** | 2026-11-07 |
| **Deciders** | Bartosz |

## Context

[F-027](../../features/F-027-the-review-loop.md) lets an agent work through the comments an architect
leaves in Stemma, and say what a change did to the model. Three things have to be decided: how the
command line writes comments while the app may have the same file open; where the model's change is
computed, when ADR-0024 put that computation in the browser; and how the command line reads Git, when
ADR-0024 made Git the web layer's.

## Decision

1. **`stemma comments` edits `comments.stemma.json` with the app's own writer.** `CommentsPatch`, which
   makes each change by id onto the file as it is now and refuses a file it cannot read (B-018), is
   reached through a public `CommentsFile` in the engine that reads, patches and writes the file
   atomically. The app sees the write through the watcher it already has. No second place for
   comments, and no server to talk to: the file is the interface, as the model files are for an
   agent's edits (ADR-0030).
2. **A reply says who wrote it.** The author is `--author`, else `STEMMA_AUTHOR`, else *Claude* when
   the command runs inside Claude Code (which sets `CLAUDECODE`), else Git's `user.name`. A comment
   thread that mixes the architect and an agent has to say which is which; a default that wrote the
   agent's replies under the architect's name would misinform the one reader the thread is for.
3. **The model's change is computed by a pure `ModelDiff` in the engine, as well as by
   `lib/modelDiff.ts` in the client.** The client keeps its own so the comparison stays live as the
   person edits (ADR-0024); the command line needs one without a browser. The two are held to one set
   of cases, `tests/shared/model-diff.cases.json`, which both test suites run: the same two models must
   produce the same changes in the same words.
4. **The command line reads Git through the same `GitHistory` as the web layer**, compiled into both
   from its one source file, so a revision is checked by one rule and the model at a revision is read
   and merged by one rule. The engine still runs no process and reads no history. `stemma diff` is the
   "diff for agents" ADR-0024 anticipated.

## Consequences

- **Positive:** the review is held where the architecture is, and answered there; the pull request
  can say what changed in the model's own words; nothing new is stored and nothing runs in the
  background.
- **Negative / trade-offs:** two implementations of the diff, kept equal by a shared test rather than
  by construction. A write from the command line and one from the app at the same instant are two
  writers on one file: each change is made onto the file as it is, so the window is the length of one
  read-patch-write, the same as two editors saving.
- **Neutral:** a source file compiled into two projects, rather than a third project for one class.

## Alternatives considered

- **The command line talks to a running Stemma** — the engine's comments endpoint already exists, but
  an agent would need the app open, and the review loop would stop working in CI or on a machine where
  nobody opened it.
- **One diff, in the engine, served to the client** — a request on every edit while comparing, for a
  computation the client already does on data it already has.
- **`GitHistory` moved into the engine** — makes the engine a process launcher, which ADR-0008 and
  ADR-0024 keep it from being.
- **A `Stemma.Git` project** — a project, a package reference set and a release artefact for one class.

## Relationship to the inviolable rules

No model file is written. The comments are the existing collaboration sidecar, written as changes
(ADR-0021). The engine gains file IO it already did for the app and a pure comparison; no web, LLM or
process concern.

## References

- [F-027](../../features/F-027-the-review-loop.md), [F-017](../../features/F-017-what-changed.md),
  [B-018](../../bugs/B-018-comments-written-whole-and-read-as-empty.md)
- [ADR-0021](./0021-sidecar-written-as-changes.md), [ADR-0024](./0024-history-read-from-git.md),
  [ADR-0030](./0030-agents-reach-stemma-through-the-cli.md)
