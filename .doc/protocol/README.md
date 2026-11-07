# Protocol

The agent-facing contract for producing a Stemma diagram **without opening the app**.

`.doc/architecture/` explains the DSL to people building Stemma. This directory explains it to
someone who will never see the canvas — an agent with a filesystem and a shell, or anyone who would
rather write a workspace than draw one — and therefore states the things a person discovers by
looking and an agent cannot.

| Document | Read it when… |
|---|---|
| [`authoring-a-diagram.md`](./authoring-a-diagram.md) | You are producing a diagram from text: the model, the view, the layout, the render, and the checks. |

Everything in it has been run. The three worked examples are transcripts rather than sketches, which
is the only way a reference of this kind stays true.

## With a coding agent

For Claude Code, the same contract ships as a plugin: [`integrations/claude-code/`](../../integrations/claude-code/)
— a skill that carries this reference and the workflow around it (model → views → rules → `validate` →
`render` and its lint → look → hand over), four commands (`/stemma:new`, `/stemma:review`,
`/stemma:from-code`, and `/stemma:respond`, which answers the review comments left on the cards), and a
hook that validates after every edit ([F-026](../features/F-026-stemma-for-claude-code.md),
[F-027](../features/F-027-the-review-loop.md), [ADR-0030](../architecture/decisions/0030-agents-reach-stemma-through-the-cli.md)). Any other agent can be
pointed at the skill's Markdown: the CLI is the interface.
