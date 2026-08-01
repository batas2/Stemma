# UX Principles

Stemma's UX exists to make a powerful, slightly dangerous idea — *the diagram is the code* — feel
safe, direct, and fast. These principles are the lens every interaction is judged through.

## 1. Direct manipulation, real consequences

The canvas is not a sketch; every gesture is a real edit to source files. So interactions must be
**immediate and legible**: you drag a box and it moves; you rename and the code changes; you draw a
relationship and a link appears. No "apply" step, no hidden staging area. The user should always be
able to answer "what did that just do to my repo?"

## 2. Never surprise, never lose work

Because edits are real, the cardinal sin is the *unexpected* change. This maps directly to the
backend's fidelity contract — and to UX: no silent reflows, no positions that jump back, no notes
that vanish. When the system must reconcile (a poll, a remote delta), it must do so **without
clobbering in-flight local work**. A surprise here costs trust, and trust is unrecoverable.

## 3. One source of truth, projected many ways

There is exactly one model. Views are *projections*, not copies. The UX must make it obvious that
switching a view changes the lens, not the data — and that presentation choices (layout, color,
notes) are remembered **per view** without forking the model.

## 4. The model is in the code; presentation is in the sidecar

Users feel this split even if they never name it: structural edits (add, rename, link) are
"committable" model changes; cosmetic edits (move, color, note) are presentation. The UI should make
structural changes feel deliberate and cosmetic changes feel free and reversible.

## 5. Progressive disclosure

An architect should be productive with the canvas and a couple of clicks, then discover depth on
demand: the inspector rail reveals one panel at a time; the full editor opens only when the inline
one isn't enough; layout tuning is there when you want it and out of the way when you don't.

## 6. Calm by default, motion with intent

Animation spotlights what changed (a new element, a running data flow), never decorates. The product
respects `prefers-reduced-motion`. Density is high (it's a pro tool) but never noisy — disabled
controls stay visible so features are discoverable, but recede until usable.

## 7. Keyboard- and review-friendly

Architects work in long sessions and review in PRs. Selection, multi-select, undo, view switching,
and search should be reachable from the keyboard, and every change should read cleanly in a `git
diff`.

## Applying these

Every feature spec and bug report carries an explicit **UX impact** section (see the
[templates](../templates/)). Reviewers — and the UX/UI Critic —
check a change against these seven principles and against the state matrix in
[`states-and-interactions.md`](./states-and-interactions.md).
