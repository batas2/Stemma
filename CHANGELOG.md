# Changelog

Notable changes to Stemma. Grouped by what a user would notice, not by commit.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) loosely; Stemma is not
versioned yet, so entries are dated and the top section is what is in `main` but unreleased.

## Unreleased

### A window of its own — 2026-08-11

Stemma stops being a localhost tab. `stemma-desktop` is one process holding both the server and a
native window: close the window and the backend is gone, because there was never a second thing to
stop. Background and the measured renderer benchmark that gated it:
[F-002](./.doc/features/F-002-desktop-shell.md), [ADR-0017](./.doc/architecture/decisions/0017-desktop-shell-photino.md).

**Added**

- **The desktop shell** (`src/Stemma.Desktop`, Photino over the OS webview). Launch it with
  `./run.sh --window`, `stemma open`, or the binary. Window size and maximised state persist between
  runs, clamped back onto a monitor that still exists; a saved position is honoured where the
  platform permits one, which Wayland does not. A splash while the backend binds, and — if it never
  does — a window that says why and where the log is, rather than a blank white page.
- **A real folder picker.** In the shell, **Open** is the OS dialog instead of a typed absolute path,
  which is the thing a browser tab cannot do and the reason this feature existed. **Create somewhere
  else…** puts a new model wherever you point. In a browser both fall back to what they were.
- **A Linux tarball** — `scripts/package/package-linux.sh` produces a self-contained folder with the
  shell, the CLI, the built front end, a `.desktop` entry and an `install.sh` that needs no root.
  Registered as a folder handler, so "Open with… Stemma" works on a workspace. With the SDK-free
  load path this runs on a machine with no .NET and no Node.
- **`stemma open`** — the window, from the command line the CLI already owns. The shell stays a
  separate binary so the render path never acquires a native webview.

**Changed**

- **The port is the OS's to choose.** Kestrel binds `:0` and the assignment is read back off the
  server rather than scraped from a log line, so a second instance never collides with the first.
  `run.sh --prod` uses it and prints the real URL; the stale-process reclaim now runs only in
  `--dev`, which still pins 5050 because the Vite proxy has to name a target.
- **The backend can be hosted, not only run.** `Program.cs` was 450 lines of top-level statements;
  the application moved to `StemmaWebHost.Build(args)` and `Program.cs` became four lines that call
  it. Same endpoints, same behaviour — the shell simply needs the object rather than a process.

**Fixed**

- **[B-005](./.doc/bugs/B-005-cors-policy-refuses-the-page-the-host-is-serving.md) — the host refused
  the page it was serving.** The CORS allow-list named the Vite dev server and nothing else, so under
  `--prod` (and in the shell, where the port is unknowable in advance) every request logged a policy
  failure. Nothing broke — a same-origin request does not need the header — but roughly sixty records
  per page load buried the log the shell points at when something is genuinely wrong.

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
  Every workspace Stemma creates now also carries a short `STEMMA.md` brief at its root — the
  vocabulary, the id prefixes, and the four rules nothing else enforces — so an agent editing the
  files by hand lands on them instead of on source archaeology.
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

### Render fixes — 2026-08-10

Three defects found by using `stemma render` to produce figures for a real essay. All three shared a
shape: the command exited `0` and printed dimensions while the picture was not the one the file
described.

**Fixed**

- **[B-002](./.doc/bugs/B-002-render-ignores-authored-node-positions.md) — a hand-written layout was
  silently auto-arranged.** A view stating absolute `nodes` positions rendered in the default
  arrangement instead. On a view no human had opened, the first paint happened before the sidecar
  finished loading, and the placeholder positions it produced then outranked the authored ones on
  every later pass. The schema and the protocol reference both promised those positions were
  authoritative; they are now.
- **[B-003](./.doc/bugs/B-003-render-transparent-emits-opaque-png.md) — transparent renders were
  opaque, and the manifest said otherwise.** A wrapper inside the canvas painted the page colour
  from an inline style that the publication profile never named, so every exported PNG shipped with
  a light slab baked in — the exact thing the transparent export exists to remove. The manifest's
  `transparent` was a copy of the request, so it recorded `true` beside a file with no alpha channel
  at all. It is now read back from the written PNG, and a render whose output contradicts its flags
  fails instead of reporting success.
- **[B-004](./.doc/bugs/B-004-bad-constraint-shape-kills-or-silently-changes-a-render.md) — a
  constraint field of the wrong type killed the render or quietly changed it.** `gap` is a pair on a
  grid and a single number on a row; writing one for the other produced either an error naming a
  JSON type rather than a field, or no error and a different picture. Bad spacing now falls back to
  the default, a single number is accepted for every kind, and **`stemma validate` reports the
  constraint** — wrong gap shape, unknown kind, missing members, and ids arranged but not modelled.

**Changed**

- `stemma render` fails with a sentence naming the view's `layout` when a page cannot place its
  content, rather than surfacing an internal type error.

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
