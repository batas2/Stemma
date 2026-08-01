# Design Tokens

Tokens are expressed as Tailwind utilities and a small set of CSS variables/utility classes in
`src/Stemma.Web.Client/src/styles.css`. **Use the shared tokens; do not hard-code raw colours or
z-indexes.** Both themes are always defined.

## Colour roles

| Role | Use | Typical value |
|---|---|---|
| Accent (primary/selection/active) | Selected node/edge, primary buttons, active rail icon | `indigo-500` / `rgb(99 102 241)`; `violet` for custom views |
| Destructive / risk | Delete, risks | `rose-500/600` |
| Warning | Warnings, "to-adapt" | `amber-500` / `#f59e0b` |
| Success / owned | Confirmations, ownership | `emerald-500` / `#10b981` |
| Body text | Default text | `text-body` |
| Muted / faint | Secondary / hint text | `text-muted`, `text-faint` |
| Default border | Hairlines between surfaces | `border-default`, `border-subtle` |
| Overlay surface | Popovers/menus | `surface-overlay` |

Element/edge **content** colours (node fills, edge colours) are user-controlled presentation, stored
in the sidecar — see `lib/nodeStyles.ts` / `lib/edgeStyles.ts`. The palettes offered to users live in
the inspector (`ColorSwatches`, `FILLS`, `COLORS`).

## Z-index scale (use the named layer, never a magic number)

CSS variables in `styles.css`, exposed as utilities:

| Utility | Layer |
|---|---|
| `.z-chrome` | Canvas chrome (resize handles, controls) |
| `.z-popover` | Popovers, dropdowns, swatch palettes, autocomplete |
| `.z-menu` | Context menus |
| `.z-modal` | Dialogs / modals (and the inspector hide overlay) |
| `.z-toast` | Toasts (top of everything) |

## Spacing, radius, elevation

- **Spacing:** Tailwind scale; panels use tight gaps (`gap-1`/`gap-2`), `p-3`/`p-4` for panel bodies.
- **Radius:** `rounded-md` for controls/cards, `rounded-lg`/`rounded-xl` for panels and the modal.
  Node corner radius is a per-node style token (`radius`, 0–28px).
- **Shadow / elevation:** node shadow is a style token (`none` · `soft` · `raised` · `glow`); overlays
  use `shadow-lg`/`shadow-2xl`.

## Canvas tokens

- **Background:** dotted grid (`BackgroundVariant.Dots`, gap 20). Snap grid is 20px.
- **Zoom:** `minZoom 0.05` … `maxZoom 2.5` (zoom far out to find strays).
- **Connection dots (handles):** 6 per node (top ×2, bottom ×2, left, right), 6px, scaling to indigo
  on node hover/selection (`.react-flow__handle`).
- **Selection:** selected relationships render a soft indigo halo + endpoint pins; selected nodes use
  React Flow selection styling.

## Animation tokens

- Node animations: `marching` · `pulse` · `glow` · `breathe` · `bounce` · `shake`, with a speed
  (`slow`/`normal`/`fast`).
- Edge "flow" animation: marching dashes with a speed class (`stemma-edge-slow/fast`).
- All of the above are gated by `prefers-reduced-motion`.

## Rich-text content tokens

`.archnote` (shared) and `.archnote-rich` (full editor) define headings, lists, tables, blockquote,
code blocks, `mark` highlight, task checkboxes, and links — keep new note styling in those classes,
not inline.

## Rule

When you need a colour, spacing, z-index, or elevation, reach for the token. If a token is missing,
add it to `styles.css` (with both themes) and document it here — don't inline a one-off.
