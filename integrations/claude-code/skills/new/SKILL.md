---
name: new
description: Start a Stemma architecture model from a description of a system — the model, its system context and container views, its rules — checked, rendered and ready to review.
argument-hint: "<what to design, e.g. a food-delivery platform with courier tracking>"
disable-model-invocation: true
---

Design the architecture described below as a Stemma workspace, following the `architecture` skill of this
plugin step by step (read its SKILL.md first, and its reference files when a step needs them).

What to design: $ARGUMENTS

- Put the workspace in `architecture/` at the root of the current repository unless the user named a
  place, or one already exists there (then extend it rather than starting over).
- Make the decisions a competent architect would make for what was described, and list them in your
  summary as decisions — the user prefers reviewing calls to answering questions. Ask only if the system's
  boundary is genuinely ambiguous.
- Deliver at least a system context view and a container view, rules for every constraint stated or
  clearly implied, and `Rule.Use("c4")`.
- Finish only when `stemma validate` reports no errors and each view renders with no layout warnings;
  then look at the images, and hand over as the skill's step 8 says.
