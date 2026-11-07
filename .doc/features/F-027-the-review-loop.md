# Feature: The review loop — comments an agent works through, and the change said in words

| Field | Value |
|---|---|
| **ID** | F-027 |
| **Status** | `Shipped` |
| **Owner** | Bartosz |
| **Persona served** | The Solution Architect ("Aria") reviewing what an agent built, and the Architect's Agent ("Theo") answering the review |
| **Roadmap horizon** | `Next` (the piece the agent programme left for later — [`agent-architecture-workflow.md`](../product/agent-architecture-workflow.md) §4) |
| **Created / Updated** | 2026-11-07 / 2026-11-07 |

## 1. Product — why

- **Problem:** an agent builds the architecture and the architect reviews it in Stemma, where the
  review naturally takes the form of comments on the cards: *this should be asynchronous*, *who owns
  this?*, *wrong level for this view*. The comments are in `comments.stemma.json`, and the agent has
  no way to work through them: nothing lists the open ones with what they are about, and nothing
  replies or resolves except the app. So the review is retyped into the chat, and the answers end up
  there rather than on the card. The other way round is just as broken: `/stemma:review` reports its
  findings in the chat, where nobody looking at the canvas sees them. And when the change goes to a
  pull request, the only account of it is a C# diff — nothing says, in the words of the model, that
  two containers were added and a flow now goes the other way.
- **Why now:** every piece the loop needs exists — comments written as changes (B-018), the watcher
  that shows an outside change, *What changed* (F-017), the plugin (F-026). This is the wiring.
- **Value:** *the review happens where the architecture is.* The architect comments on the card; the
  agent changes the model, answers on the card and resolves; the canvas shows where the conversation
  is; the pull request says what changed in the model's own words. Nothing new is stored: the
  comments stay where the app keeps them, and the change is read from Git.
- **Out of scope:** an overview of every open comment in the app (the cards show where they are; a
  list is a later step); comments on relationships in the app (the inspector has none today); a
  GitHub integration that posts the summary itself (`--markdown` is printed, the agent or a CI step
  posts it); notifications; editing or deleting a comment from the command line.

## 2. User story & acceptance criteria

> As **an architect reviewing an agent's architecture**, I want **to leave my review as comments on
> the cards and have the agent work through them, answering each one where I left it,** so that **the
> review and its answers stay with the model, and the pull request says what changed.**

- [x] **AC1 — Open comments, listed with what they are about.** `stemma comments [<ws>]` lists the
  open comments: who, when, the thread, and the target named from the model — its kind and name as
  well as its id — or *no longer in the model* when it has gone. `--all` includes the resolved ones,
  `--on <id>` only one target's, `--json` is for an agent.
- [x] **AC2 — Answered on the card.** `stemma comments reply <id> <text>`, `resolve <id> [<text>]`
  (with a closing reply) and `reopen <id>` each write the one change they are, onto the file as it is
  now, through the same writer as the app (B-018): every other byte of `comments.stemma.json` stays.
  `stemma comments add --on <id> <text>` starts a comment on an element, a relationship or a view, and
  refuses an id the workspace does not have.
- [x] **AC3 — Refusals write nothing.** An unknown comment id is refused with the open ids listed
  (exit 2); a file that does not parse is refused and left as it is (exit 3), as the app refuses it.
- [x] **AC4 — Who wrote it.** `--author`, else `STEMMA_AUTHOR`, else *Claude* when the command runs
  inside Claude Code, else `git config user.name`, else *anonymous*: an agent's reply never appears
  under the architect's name because it forgot a flag.
- [x] **AC5 — Seen in the app as it happens.** A reply, resolution or comment written by the command
  line while the app is open appears in the open comments panel and on the cards without a reload.
- [x] **AC6 — The cards say where the conversation is.** A card with open comments carries a small
  count; pressing it selects the card and opens its comments. Not drawn when presenting, in a
  publication render or in an exported image.
- [x] **AC7 — The change in words.** `stemma diff [<ws>]` compares the working tree with a revision —
  by default where the current branch started from the default branch, or the last commit on the
  default branch — and says what was added, removed and changed, element by element and link by link,
  in the same words the app's *What changed* uses, from one shared set of cases. It also says which
  comments were opened and resolved since. `--base <rev>` picks the revision; `--markdown` writes a
  pull-request section; `--json` is for an agent. Outside a repository, or with no such revision, it
  says so (exit 2).
- [x] **AC8 — The loop, in the plugin.** `/stemma:respond` works through the open comments: changes the
  model where a comment asks for it, validates and renders, replies to each, resolves what it did, and
  ends with `stemma diff`. `/stemma:review` offers to leave its findings as comments on the cards. The
  skill's reference says how, and what a good reply is.

## 3. Architecture impact

- [x] **Model or presentation?** Neither changes. Comments are the collaboration sidecar the app
  already writes; the diff is computed and printed, never kept.
- [x] **New/changed operations:** none.
- [x] **Fidelity:** `comments.stemma.json` is edited by `CommentsPatch`, the app's writer, through
  `CommentsFile`; no model file is touched.
- [x] **Engine purity:** the engine gains `CommentsFile` (the comments file, read and patched, as the
  engine already does for the app) and `ModelDiff` (pure). Git stays out of the engine: the CLI runs it
  through `GitHistory`, the same source file the web layer compiles ([ADR-0031](../architecture/decisions/0031-the-review-loop-through-the-files.md)).
- [x] **Sidecar:** no new section.
- [x] **ADR needed?** [ADR-0031](../architecture/decisions/0031-the-review-loop-through-the-files.md).
- **Affected files/areas:** `src/Stemma.Engine/Workspace/CommentsFile.cs` (new),
  `src/Stemma.Engine/ArchModel/ModelDiff.cs` (new), `src/Stemma.Web/Services/GitHistory.cs`,
  `src/Stemma.Cli/CommentsCommand.cs` (new), `src/Stemma.Cli/DiffCommand.cs` (new),
  `src/Stemma.Cli/Program.cs`, `src/Stemma.Cli/Stemma.Cli.csproj`,
  `src/Stemma.Web.Client/src/lib/modelDiff.ts`, `lib/comments.ts`, `lib/store.ts`,
  `components/ArchCanvas.tsx`, `components/nodes/ArchNodeView.tsx`, `components/ArchInspector.tsx`,
  `tests/shared/model-diff.cases.json` (new), `integrations/claude-code/`.

## 4. UX impact

- [x] **Journey touched:** J6 (export & share) — *review an agent's architecture*: comment on the
  cards, ask the agent to respond, see the answers on the cards, merge with a summary.
- [x] **States:** no comments (no badge; `stemma comments` says *no open comments*); a target gone (named
  as such); an unreadable comments file (refused, as in the app); not a repository (`diff` says so).
- [x] **Interactions:** the badge is a button: click or Enter selects the card and opens its comments.
- [x] **Accessibility:** the badge has an accessible name (*Show 3 open comments*), a 24 px hit target, and
  is not the only sign — the inspector's comments rail shows the count too.

## 5. UI impact

- [x] **Components:** `ArchNodeView` gains the comment badge; `ArchInspector` opens on its comments.
- [x] **Tokens:** the existing indigo accent of the comments panel; no new token.
- [x] **Both themes:** checked on screen.
- [x] **Layout:** on the card's top edge near the left — clear of the corner, where a selected card's resize handle is, of the docking dots, and of the validation dot (top right).

## 6. Technical prerequisites & dependencies

- [x] `CommentsPatch` and the comments watcher ([B-018](../bugs/B-018-comments-written-whole-and-read-as-empty.md)).
- [x] `GitHistory` and `ArchModelMerge` ([ADR-0024](../architecture/decisions/0024-history-read-from-git.md)).
- [x] The plugin ([F-026](./F-026-stemma-for-claude-code.md)).

## 7. Test plan

| Kind | What it proves |
|---|---|
| Shared cases (`tests/shared/model-diff.cases.json`) | The engine's `ModelDiff` and the client's `diffModels` say the same thing about the same two models, in the same words. |
| Unit (C#, `CommentsFileTests`) | Each change is that change on the file as it is; an unreadable file is refused and kept. |
| CLI (`CommentsCommandTests`) | List, `--all`, `--on`, `--json`; reply, resolve with a reply, reopen, add; unknown id and unknown target refused; the author chain. |
| CLI (`DiffCommandTests`) | On a scratch repository: the default base on a branch and on the default branch, `--base`, text, Markdown and JSON, comments opened and resolved; not a repository, a revision that is not one. |
| Unit (client, `comments.test.ts`) | The badge's count ignores resolved comments and comments on views and shapes. |
| Journey (`review-loop.spec.ts`) | A card shows its open count and the badge opens its comments; a file written outside (as the command line writes it) changes the counts and the thread without a reload; a comment posted in the app is counted at once; presenting draws no badge. |
| Plugin | `/stemma:respond` run headless (`claude -p`) against a scratch workspace with two open comments, on 2026-11-07: the queue comment was acted on (a queue and a worker added, `flow_save` moved to start at the worker) and resolved with a reply saying so; the on-call question was answered with a question back and left open; both replies signed *Claude*; `validate` clean, the view rendered with no layout warnings; it ended with `stemma diff`. |

## 8. Definition of Done

- [x] All ACs met and demoed
- [x] States handled; accessibility bar met
- [x] `dotnet test` green · `tsc` clean · `vite build` clean · `vitest` green
- [x] Model/presentation boundary respected; no new data store
- [x] Docs: this record, ADR-0031, the decision index, the features index, the roadmap, the plugin's
  skill and README, `CHANGELOG.md`
- [x] Reviewed against all four pillars

## 9. Notes / open questions

- **Two implementations of the diff.** ADR-0024 put the comparison in the client so it recomputes as
  the person edits; the command line needs it without a browser. Rather than one calling the other, both
  are held to the same cases file. Writing those cases found that neither said a container's technology
  or a description had changed (both added after F-017); both do now. An independent review then found
  two inputs the cases did not cover and the two sides answered differently — a reference going from
  `""` to absent (the engine threw) and a target with two `Tag.For` calls (one side kept the first tag,
  the other the last). Both are cases now, and both sides read an empty reference as none and merge a
  target's tags part by part.
- **Next:** an overview of the open comments in the app, beside Views & Books; comments on relationships
  in the inspector.
