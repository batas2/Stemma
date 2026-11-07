# Stemma for Claude Code

A plugin that teaches Claude Code to build, check, render and review software architecture in
[Stemma](https://github.com/batas2/Stemma): the model is C# in your repository, the pictures are laid
out and routed for you, and the architecture is checked against the rules you write down — and,
optionally, against your code.

## Install

You need the `stemma` command:

```
dotnet tool install -g Stemma          # or the tarball from the project page
```

Then, in Claude Code:

```
/plugin marketplace add batas2/Stemma
/plugin install stemma@stemma
```

## Use

Ask for an architecture in your own words — *"design the containers for a food-delivery platform and
show how an order flows"* — and the `architecture` skill takes over. Or start from a command:

| Command | Does |
|---|---|
| `/stemma:new <what to design>` | A new workspace: model, system context and container views, rules — validated, rendered, handed over. |
| `/stemma:review [path] [focus]` | Validates, renders and lints every view, and reviews the model against the C4 checklist and its rules. |
| `/stemma:from-code <path>` | An as-is model of a .NET codebase, mapped to its projects so the model is checked against the code from then on. |
| `/stemma:respond [path] [which]` | Works through the review comments left on the cards: changes the model, answers each comment where it was left, resolves what it did, and says what changed. |

After every edit to a workspace file, a hook runs `stemma validate` and tells Claude what broke. To review
what Claude built, run `stemma open <workspace>`: the app follows the files as Claude changes them.

Review it there, as comments on the cards — each card shows how many are open — and then ask for
`/stemma:respond`. Claude answers on the cards, signed as Claude, and `stemma diff --markdown` gives the
pull request a summary of the change in the model's own words.

## What is in it

- `skills/architecture/` — the workflow and the reference: the model, views and layout, rules and
  conformance, the review checklist.
- `skills/new`, `skills/review`, `skills/from-code`, `skills/respond` — the four commands.
- `hooks/hooks.json` — validation after edits, via `stemma hook post-edit`.
- `evals/` — cases for `claude plugin eval`.
