# Design Language

Verso looks like a calm, dense, professional tool — closer to a code editor than a consumer app. The
visual system serves long sessions: low chrome, high information density, strong but quiet structure.

## Principles

- **Quiet chrome, loud content.** The model is the hero. Panels, rails, and toolbars are neutral
  surfaces that frame the canvas; they never compete with it.
- **Structure through surfaces, not borders.** Hierarchy comes from layered surfaces (canvas →
  panel → card → control) and subtle elevation, not heavy outlines.
- **Indigo is the accent.** A single accent family (indigo/violet) signals selection, active state,
  and primary actions. Semantic colours (rose = risk/destructive, amber = warning, emerald =
  success/owned) are used sparingly and consistently.
- **Two themes, one system.** Dark and light are first-class; every token has both values; nothing
  is hard-coded to one theme. Dark is the default.
- **Motion with intent.** Animations spotlight change (a new node, a running flow, a selection halo)
  and always honour `prefers-reduced-motion`.

## Surfaces (the elevation ladder)

1. **Canvas** — the deepest surface (near-black in dark, off-white in light); a dotted background
   grid; the working area.
2. **Panels & rails** — the sidebar, the inspector rail and its one open panel, the bottom view tabs,
   the status bar. Neutral, bordered against the canvas with a single hairline.
3. **Cards & sub-sections** — grouped controls inside a panel (e.g. Appearance's Presets / Style /
   Animation sub-sections) sit on a slightly raised surface.
4. **Overlays** — popovers, dropdowns, context menus, dialogs/modals, toasts — the top of the stack,
   with the strongest elevation and a backdrop where appropriate.

Use the shared `surface-overlay` / `border-default` / `text-muted` / `text-faint` utilities rather
than re-deriving colours; see [`design-tokens.md`](./design-tokens.md).

## Typography

- UI text is the system sans stack at small sizes (11–13px is the working range for panels); the
  canvas favours legibility at zoom.
- Monospace (`ui-monospace`) for ids, code, and anything that round-trips to source.
- Rich notes render through the markdown bridge with their own type scale (headings, lists, tables,
  code blocks) under the `.archnote` / `.archnote-rich` classes.

## Iconography

- `lucide-react` throughout, at 3.5–4 (14–16px) in panels and rails. Icons label actions; pair with
  text where space allows (e.g. the Align & distribute buttons are icon-over-label for clarity).

## Density & restraint

It is a pro tool: dense is good, noisy is not. Prefer recessed-until-needed over hidden; prefer one
accent over a rainbow; prefer a hairline over a box. When a screen feels busy, the fix is usually
*fewer borders and one accent*, not more colour.
