---
name: respond
description: Work through the open review comments on a Stemma model — change the model where a comment asks for it, check and render, answer each comment on its card, resolve what was done, and summarise the change.
argument-hint: "[workspace path] [which comments, e.g. 'the payments ones' or a comment id]"
disable-model-invocation: true
---

Answer the review left on the Stemma model in this repository (or at the path given), following "The
review loop" in `reference/review.md` of the plugin's `architecture` skill. Read the skill's SKILL.md
first if you have not this session.

Arguments: $ARGUMENTS

1. Find the workspace (a folder with `Architecture/*.cs`); if there are several, use the one named, or ask.
2. `stemma comments <workspace> --json` — the open comments, each with what it is on and its thread. If
   the arguments name some of them, work on those only.
3. For each comment, decide what it asks for: a change to the model, a views or rules change, an answer,
   or a question back. Read the thread first — a reply may already have settled it.
4. Make the changes in the files, then `stemma validate <workspace> --json` and render every view you
   touched (`stemma render ... --json`), fixing what they report, as the skill's loop says.
5. Answer every comment you worked on, on its card:
   - done → `stemma comments resolve <id> "<what you changed, in a sentence>" --workspace <workspace>`
   - answered without a change → `stemma comments reply <id> "<the answer>"` and leave it open for the
     architect to resolve
   - unclear, or a decision only the architect can make → `stemma comments reply <id> "<the question>"`
     and leave it open
   Never resolve a comment you did not act on, and never resolve one you disagree with — reply with why.
6. Finish with `stemma diff <workspace>` and give the user a short summary: per comment what you did, the
   comments still open and why, and the model's change. Offer `stemma diff --markdown` for the pull request.
