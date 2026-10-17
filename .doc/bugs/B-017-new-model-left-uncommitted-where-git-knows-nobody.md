# Bug: a new model is left uncommitted where git has not been told who the user is

| Field | Value |
|---|---|
| **ID** | B-017 |
| **Status** | `Fixed` |
| **Severity** | `S3 minor` |
| **Area** | `web` |
| **Reported by / Date** | CI / 2026-10-17 |
| **Affected version / commit** | since the scaffold made its first commit (`9203e08`, F-003) |

## 1. Summary

A model created from the start screen is meant to be a repository with one commit, so that the
first diff its author reads is their own first edit ([F-003](../features/F-003-from-scratch-onboarding.md)
AC4). Git refuses to commit for someone it cannot name, and on a fresh machine nobody has told it a
name yet. The scaffold initialised the repository, staged the files, failed to commit, reported the
failure in a field the canvas never reads, and opened the model. The author's first `git status`
listed every file Stemma had written as added.

## 2. Steps to reproduce

1. A machine where git has no `user.name` or `user.email` and cannot guess them — a fresh install,
   a container, a CI runner.
2. Create a model from the start screen.
3. `git status --porcelain` in it.

- **Expected:** nothing.
- **Actual:** `A  .gitignore`, `A  Architecture/Architecture.cs`, `A  README.md`, `A  STEMMA.md`.
- **Frequency:** always, on such a machine.
- **Evidence:** the first CI run after the F-003 work was pushed, on `master` at `ccc99bd`:
  `FromScratchJourneyTests.The_new_model_is_a_repository_with_nothing_uncommitted` failed with the
  status above. Every machine it had been run on before had an identity.

## 3. Triage

- [x] **Severity & priority agreed:** S3. Nothing is lost and the model works; but the promise of a
      clean first diff fails silently, and on the machines of exactly the people trying Stemma for
      the first time.
- [x] **Reproduced:** on CI, and by the test below with git given an empty configuration.
- [x] **Regression?** No.
- [x] **Pillar(s) affected:** Product (the first ten minutes), Architecture (the scaffold).

## 4. UX / UI impact

- [x] **State involved:** creating a model on a machine where git has no identity.
- [x] **User-visible symptom:** the first `git status` is four added files the user did not write.
- [x] **Severity to trust:** low to medium; the first thing a reviewer sees is not their change.

## 5. Root cause

- `src/Stemma.Web/Services/WorkspaceScaffold.cs` `TryGitInitAsync` ran `git commit` with whatever
  identity the machine had and returned git's refusal as `GitError`.
- `src/Stemma.Web.Client/src/lib/api.ts` `initWorkspace` never reads `gitError`.

## 6. Fix

- **Approach:** before committing, ask git whether it can name an author and a committer
  (`git var GIT_AUTHOR_IDENT` and `GIT_COMMITTER_IDENT`, which apply the same rules as `commit`).
  When it cannot, that one commit is made as `Stemma <stemma@localhost>`, which is who made it,
  passed with `-c` for that command only. Nothing is written into the repository's configuration,
  so the user's own first commit still asks who they are, as git intends.
- **Not done:** the canvas still does not show `gitError`. With the fallback it is reached only when
  git is missing or a hook refuses the commit; showing it is a change to the start screen of its own.
- **Affected files:** `src/Stemma.Web/Services/WorkspaceScaffold.cs`
- [x] Fix implemented
- [x] Inviolable rules respected
- [x] No new data store / boundary intact

## 7. Regression test (required)

- [x] **Test location:** `tests/Stemma.Web.Tests/ScaffoldCommitTests.cs`. Each test gives git a
      configuration of its own, with `user.useConfigOnly`, so the machine running it cannot decide
      the outcome.
  - `Where_git_knows_nobody_the_new_model_is_still_one_clean_commit_made_by_Stemma`
  - `Where_git_knows_the_user_the_commit_is_theirs`
  - `Stemma_is_only_the_committer_for_the_one_commit_it_makes`
- **What it asserts:**
  - The working tree is clean after creation, with an identity or without one.
  - The commit is the user's when git knows them, and Stemma's when it does not.
  - No identity is left in the repository's configuration.

## 8. Verification

- [x] `dotnet test` green, and green again with git given no identity at all
      (`GIT_CONFIG_GLOBAL=/dev/null`, `user.useConfigOnly=true`), as on CI
- [x] Docs updated: the bug board
