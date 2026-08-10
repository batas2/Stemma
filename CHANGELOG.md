# Changelog

Notable changes to Stemma. Grouped by what a user would notice, not by commit.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) loosely; Stemma is not
versioned yet, so entries are dated and the top section is what is in `main` but unreleased.

## Unreleased

### Diagrams without a mouse — 2026-08-08

The largest change so far. A model plus a view now becomes a publication-ready image from one
command, with no browser open and no dragging. Background, the six decisions behind it, and what is
still missing: [`.doc/product/agent-authored-diagrams.md`](./.doc/product/agent-authored-diagrams.md).

**Added**

- **`stemma render`** — a new `src/Stemma.Cli`. Turns a workspace and a view into PNG or SVG, with
  `--profile`, `--palette`, `--theme light,dark`, `--scale`, `--pad` and transparency. Each render
  starts its own short-lived backend, so it never disturbs a workspace you have open.
- **`stemma validate`** — reports the things the compiler cannot: dangling ids in flows,
  dependencies, `aboutId` and views; duplicate ids; a view that resolves to nothing; free-form shapes
  anchored to elements that no longer exist. `--json` for a machine, `--strict` to fail on warnings.
- **A publication render profile and named palettes.** Strips what is app UI rather than diagram ink
  — kind chips, icons, shadows, the dot grid, colour-coded status — and repaints from a palette.
  Ships the technique, not anyone's brand: `dual-theme` is one ink legible on both a light and a dark
  page, which is the general problem a transparent export has.
- **Layout as a constraint.** A view can carry `grid`, `row`, `column` or `stack` in the sidecar,
  solved on open. It stays live: a drag records an offset against the arrangement rather than
  replacing it, so adding a box later re-solves and keeps your corrections. Authorable from the
  canvas selection or as text.
- **A `Concept` element kind and a `Relation` link kind** — a box and an arrow that assert nothing
  about a system, so an essay's argument no longer has to declare itself a Bounded Context.
  [ADR-0018](./.doc/architecture/decisions/0018-concept-element-kind.md),
  [ADR-0019](./.doc/architecture/decisions/0019-relation-link-kind.md).
- **A published JSON Schema for `stemma.layout.json`**, with a `$schema` pointer stamped into every
  sidecar so editors validate it live. The format was deliberately undocumented; that stopped being
  tenable once something other than the canvas started writing it.
- **A protocol reference** for producing a diagram entirely from text, written for a reader who
  cannot see the result: [`.doc/protocol/authoring-a-diagram.md`](./.doc/protocol/authoring-a-diagram.md).
- **A render manifest and `stemma render --check`.** Each render fingerprints the model, the view and
  the layout; `--check` fails when a committed image no longer matches its source, without rendering
  anything.
- **True vector SVG.** Under the publication profile the node body is `<rect>` and `<text>` rather
  than HTML, so `--format svg` produces a file that opens outside a browser.

**Changed**

- Node titles **wrap instead of clipping**. They were truncated at roughly thirty characters, which
  was quietly shaping the prose people wrote to fit a box.
- Image export takes **transparency, scale and padding** as options, surfaced in the export menu and
  remembered. The default is unchanged.
- The **draw.io export honours the active view and the committed layout**, labels an element with its
  name, and defaults to one ink on a transparent page with kinds told apart by shape. It previously
  emitted the whole model on a fixed grid in draw.io's pastel defaults, which had to be rebuilt by
  hand. The old palette remains as `classic`.
- The **per-view layout mode moved from `localStorage` into the sidecar**, so a fresh clone
  reproduces the author's canvas.

**Fixed**

- **[B-001](./.doc/bugs/B-001-layout-sidecar-drops-shapes-and-edge-handles.md) — free-form shapes and
  edge dock anchors never reached disk.** The client wrote them; the server's type declared neither
  and dropped them during model binding, in both directions. Two shipped features survived only until
  reload.
- **The committed layout could lose to a grid nobody authored.** The canvas never re-read positions
  after the sidecar finished loading, and a node that already existed kept its position across every
  rebuild — so whichever positions existed at first paint were final.
- **Publication renders were drawn with no edges at all.** Hiding the connection dots with
  `display: none` removed them from layout, and React Flow derives edge geometry from those boxes.
- Renders were **not reproducible**: the same view came out at three different sizes, because the
  crop was measured from a DOM whose bezier overshoot moves between runs and whose fit was still
  animating.
- A **correlation id could take the client down** on an insecure origin, where `crypto.randomUUID` is
  present and throws rather than absent.

### Diagnostics — 2026-08-08

The backend had one diagnostic statement in it, and eight `catch` blocks that swallowed without a
trace; the client had twenty-one. The contract is
[ADR-0020](./.doc/architecture/decisions/0020-diagnostics-contract.md).

**Added**

- **Leveled, structured logging** through `[LoggerMessage]`, with stable event ids grouped by
  subsystem. Console in `simple` or `json`, and a rolling file in `~/.stemma/logs/` capped at 20 MB
  per file and 14 days. Level, format and directory are configurable from `appsettings.json`, the
  environment, `run.sh`, or at runtime with no restart.
- **A fidelity record.** Every document write carries a content hash before and after at `Debug`, a
  unified diff at `Trace`, and a `Critical` if what landed on disk is not what Roslyn intended —
  emitted before the result is handed back. The central guarantee was previously observable only as a
  bad `git diff` after the fact.
- **Correlation from the click to the write.** One id per user action, carried on HTTP and on the
  SignalR invocation, inherited by every record produced downstream.
- **A diagnostics bundle**, redacted by default — model content erased, absolute paths reduced — with
  an explicit opt-in. **There is no network sink and none can be configured:** a Stemma record
  carries the user's architecture.

**Fixed**

- Every silent `catch` in `src/` now either logs or carries a comment stating why silence is correct.
  The one that mattered most: losing the pre-operation snapshot silently disabled undo for that
  operation and recorded nothing.

---

Earlier history is in the commit log; this file starts here.
