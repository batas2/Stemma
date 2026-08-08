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
