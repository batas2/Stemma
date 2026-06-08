# States & Interactions

Every surface must define its behavior in all states. This is the checklist reviewers and the
UX/UI Critic hold a change against. A feature is not done until
its states are specified.

## The state matrix (define all that apply)

| State | What the user sees / what must happen |
|---|---|
| **Empty** | No data yet (no model, no selection, no notes). Show a purposeful empty state that explains the next action — never a blank panel. |
| **Loading** | Async work in flight (workspace parse, sidecar prime, export render). Show progress; keep the rest of the UI responsive. |
| **Loaded / idle** | The normal state. Density high but calm; disabled controls visible but recessed. |
| **Error** | An operation failed (rewrite rejected, network blip, export failure). Surface a **toast with the reason**; do **not** apply the change; leave the canvas as it was. |
| **Optimistic** | A local edit is applied immediately and reconciled when the server confirms. On rejection, **roll back** and toast. Never block the UI waiting for confirmation. |
| **Conflict / remote delta** | An edit arrived from elsewhere (another client, git pull, IDE). Merge it **without clobbering in-flight local edits**. |
| **Selected / multi-selected** | Selection is visible on canvas (not just the inspector): selected relationships get a halo + endpoint pins; multi-select shows a count and enables align/distribute. |

## Interaction patterns (the canvas contract)

- **Drag a node** → it follows the cursor and **stays where dropped**. Never rebuild the dragged
  node's identity mid-drag (it would snap back). A manual move flips the view's layout to *Custom*.
- **Marquee select** (Shift-drag) / **additive select** (Ctrl/Cmd-click) → selection must survive the
  ~1.5 s background poll's node rebuild (preserve `selected`).
- **Draw a relationship** → start at a connection dot, end on a connection dot; the edge docks there
  and the arrowhead is visible on the box boundary, never hidden behind it.
- **Reconnect an endpoint** → drag a relationship end to a different dot (presentation) or a different
  box (a model change: the old link is replaced).
- **Inspector** → selecting opens the relevant panel; deselecting collapses to the icon rail; opening
  a panel with nothing selected shows a "pick an element" prompt.
- **Layout** → selecting 2+ elements jumps to the Layout panel's Align & distribute; sliders re-apply
  the active algorithm live.

## Feedback & affordances

- **Toasts** for outcomes (success / error / info) — short, specific, dismissible.
- **Disabled-not-hidden** for context-dependent actions (align needs 2+, distribute needs 3+): keep
  them visible so they're discoverable, greyed until usable.
- **Hover/selection affordances** on nodes (connection dots), edges (dock rings/pins), and shapes.

## Accessibility (the bar)

- **Keyboard:** selection, multi-select, undo/redo, view switching, escape-to-close, and dialog focus
  traps must work without a mouse.
- **Motion:** all canvas animation honours `prefers-reduced-motion`.
- **Contrast:** text and badges meet WCAG AA against their surface in both themes (see
  [`../ui/design-tokens.md`](../ui/design-tokens.md)).
- **Targets:** interactive dots/handles have an adequate hit area even when drawn small.

## How to use this file

When writing a feature or fixing a bug, fill the **UX impact** section of the
[template](../templates/) by walking this matrix: which states change, which interactions are added
or altered, and which accessibility requirements apply.
