---
name: review
description: Review a Stemma architecture model — validate, render and lint every view, check it against the C4 checklist and its own rules, and report what would mislead the team that receives it.
argument-hint: "[workspace path] [focus, e.g. 'payments' or 'the container view']"
disable-model-invocation: true
---

Review the Stemma architecture model in this repository (or at the path given) following
`reference/review.md` of the plugin's `architecture` skill. Read the skill's SKILL.md first if you have
not this session.

Arguments: $ARGUMENTS

1. Find the workspace (a folder with `Architecture/*.cs`); if there are several, review the one named,
   or ask which.
2. Run the mechanical checks for every view: `stemma validate --json`, `stemma inspect --view <id> --json`,
   `stemma render ... --json` into a temporary folder. Read each rendered PNG.
3. Go through the C4 checklist and the design questions in `reference/review.md`.
4. Report findings ordered by how much they would mislead the receiving team, each with its location
   (view / element / link id), why it matters and the change you propose. Do not change files unless the
   user asks; offer to.
