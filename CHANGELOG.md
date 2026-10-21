# Changelog

Notable changes to Stemma. Grouped by what a user would notice, not by commit.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) loosely, and versions
follow [Semantic Versioning](https://semver.org/). A version's section is also its release notes;
within one, entries are dated. How a release is cut:
[`.doc/engineering/releasing.md`](./.doc/engineering/releasing.md).

## Unreleased

### Faster on the canvas, clearer in the room — 2026-10-21

Six things that make Stemma quicker to work in and easier to present with. Every one of them has a
keyboard path; none of them adds a file to your repository.

**Added**

- **Copy, paste and duplicate** ([F-015](./.doc/features/F-015-copy-paste-duplicate.md)).
  Select boxes and press **⌘C**, then **⌘V**: you get "*Name* copy" with its status, owner, notes,
  custom properties, look, and the relationships between the copies. A paste lands a step down and
  right of the originals (each further paste a step further), or in the middle of the screen when
  they are out of sight; **right-click the canvas → Paste here** puts it exactly where you clicked.
  Copy a bounded context and its modules come with it; paste a module inside a context's box and it
  joins that context. **⌘D** duplicates in place without touching the clipboard. *(Ctrl instead of
  ⌘ on Linux and Windows.)*
- **Copy a look from one box to others.** **⌥⌘C** copies the style of the selected box or
  relationship, **⌥⌘V** pastes it onto everything selected; each box keeps its own size. Also as
  *Copy style* / *Paste style* at the top of the Appearance panel and in the right-click menus.
- **One ⌘Z for the last thing you did, whatever it was.** A paste of eight boxes and arrows is one
  step, a move is one step, a change of look is one step — and changes of look can be undone for
  the first time. Steps are undone in the order you made them, the toast says what was undone, and
  the boxes it touched are ringed for a moment (brought on screen if they were not).
- **Go anywhere with ⌘K** ([F-016](./.doc/features/F-016-go-anywhere.md)). The palette now lists
  every view (with how many elements each draws), every book, and every element with its kind and
  where it lives. Type a few letters of a name, an id, a squad or a context and press Enter: Stemma
  opens a view that draws the element, glides to it and rings it once. The same happens when you
  click an element in the sidebar.
- **Back and forward.** **⌘[** and **⌘]**, or **‹ ›** at the left of the view tabs, go back and
  forward through the views you visited. Each view now opens at the pan and zoom you left it at.
  Reloading the page brings you back to the same view and selection.
- **"Appears in"** at the top of an element's Properties: the views that draw it and the book pages
  that point at it, one click each.
- **What changed, drawn on the diagram** ([F-017](./.doc/features/F-017-what-changed.md)). Click
  **Compare** in the top bar and pick *the last commit* (your uncommitted changes), *where this
  branch started*, a tag, or a recent commit. New boxes are marked **New**, altered ones
  **Changed**, and removed ones appear as struck-through ghosts where they used to be; the rest
  fades. The bar at the bottom counts the changes and lists them with what changed about each
  ("Renamed from …", "Status target → current"); click one to see it. Keep editing and the marks
  follow. **Done**, or Escape, ends it. The status bar always says how many changes you have since
  the last commit — click it to see them drawn. Nothing is written while comparing; Stemma reads
  the old version straight from Git.
- **Find on this view with ⌘F** ([F-018](./.doc/features/F-018-find-on-the-view.md)). Type a word,
  or tap a chip for a status, a squad or a kind: what matches stays lit and everything else fades
  (or hides). **Enter** walks through the matches, **Shift+Enter** walks back. Narrow a word to one
  field with `status:target`, `squad:core`, `kind:module`, `in:payments` or `#tag`. With a book open
  on this view, **Point the page at these** turns the answer into a slide.
- **A presenter view for a second screen** ([F-019](./.doc/features/F-019-presenter-view.md)).
  While presenting, press **P** — or use **With notes** in the book editor — and a second window
  shows the page now (with its narrative in large type), the page next, every page as a list to jump
  to, an elapsed timer and the time. The projector shows the diagram alone. Either window turns the
  page, with the buttons, the arrow keys or a clicker; **End** stops both. In the desktop app the
  presenter view opens in your browser.
- **Steps: play a flow one arrow at a time** ([F-020](./.doc/features/F-020-flow-steps.md)). In the
  book editor, under a page's narrative, press **Record** and click the relationships on the canvas
  in the order things happen (or add the selected one). Give each step a line to say. When you
  present, every **Next** lights the next arrow — numbered ①②③, the current one in amber — before
  the page turns, and **Back** unwinds them. The PDF shows the whole flow and lists the steps.
  `stemma validate` reports a step whose relationship no longer exists (`book/dangling-step`).

**Changed**

- **Tab** walks the boxes on the view you are looking at, in name order, instead of every element
  of the model.
- **AddElement and AddLink report the id they created** (`ElementAdded` / `LinkAdded` deltas), for
  anything that goes on to place, style or link what it just added.
- **Arrows stand still unless you ask them to flow.** Dependencies and relations used to flow by
  default, which slowed a large view to a crawl. Turn it on per arrow under **Appearance → Animation
  → Animated flow**; with *Reduce motion* set in your system, a flowing arrow keeps its dashes and
  stands still.

**Fixed**

- **Only Stemma's own window can use the local server.** Any web page open in your browser could
  reach it — open the live connection and edit the model, close the workspace, or do so under a
  name that pointed back at your machine. Those requests are now refused.
- **A type can only be added inside the workspace, under a real name.** A path or a name that was
  not one could write outside the workspace or put arbitrary code into a file.
- **A note's link can no longer run a script** when the note is opened in the editor.
- **Saving never leaves `stemma.layout.json` half-written,** even if Stemma is stopped mid-save, and
  a layout file that is not valid UTF-8 is refused rather than read wrongly and written back.
- **An edit that is refused, or fails while writing, puts every byte back** — including a file's
  byte-order mark — and a model file that is not UTF-8 is left alone rather than rewritten.
- **A new view in a project kept in a subfolder** no longer replaced a file of the same name there.
- **Switching workspaces can no longer mix their layouts.** A change still being saved when you
  opened another workspace could land in the new one's file, and reopening a workspace could show
  it with no layout and then save that emptiness over the file.
- **Reversing an arrow (↔ in Appearance), or dragging one of its ends to another box, keeps it the
  same relationship.** A relation came back as a dependency without its label, and its status,
  owner and look were dropped; if the new ends were refused, the arrow was simply gone. Now it keeps
  everything, is one ⌘Z, and is put back if it cannot be moved.
- **A relation's label is edited as its label.** The inspector showed it as a *Kind* of "uses".
- **The inspector no longer carries a half-typed value** from one selected box to the next.

- Pressing **Escape** to close a right-click menu also cleared your selection, and the arrow keys
  that move through the menu also nudged the selected box. The menu now keeps the keyboard to itself.
- Every item in **⌘K** was set in spaced capitals.
- Clicking a view's tab while **Concerns** was open left the Concerns list on screen.
- In the dark theme the **Draft** and **Glass** style presets could not be read.
- The validation strip said "1 errors".

## 0.1.0 — 2026-10-17

The first release: everything below, as one version you can install in one command. It is the
first point at which the promise Stemma is built on — the `git diff` of an edit is that edit — is
held by tests for every file it writes: the code, the presentation sidecar and the comments.

```bash
dotnet tool install -g Stemma                # with the .NET 10 SDK

# or, with no .NET at all:
mkdir -p ~/.local/share && curl -fsSL https://github.com/batas2/Stemma/releases/latest/download/stemma-linux-x64.tar.gz | tar -xz -C ~/.local/share && ~/.local/share/stemma/install.sh
```

Linux x64 only, for now: it is the one platform this release is built and tested for.

### Installable — 2026-10-17

**Added**

- **`dotnet tool install -g Stemma`.** One package holds what the tarball holds except the runtime:
  `stemma render` and `stemma validate`, and `stemma open` for the window.
- **A version.** `stemma --version` and `stemma-desktop --version` say which Stemma this is, the
  host reports it at `/api/diagnostics`, and the diagnostics bundle — the thing you paste into an
  issue — carries the commit it was built from as well. It is written down in one place,
  `Directory.Build.props`.
- **Releases.** A tag builds, tests and packages its commit, tries the tarball and the tool package
  the way you would — the tarball with no .NET on the machine, the tool installed from its package
  alone — and drafts a release with both attached and their SHA-256 sums.
- **A credit in every exported report.** "Made with Stemma", linking to the project page, at the foot
  of the rail; a printed report carries it as a line of text.

**Fixed**

- **[B-016](./.doc/bugs/B-016-tarball-render-needs-the-dotnet-it-ships-without.md) — `stemma render`
  from the tarball needed the `dotnet` the tarball is built to do without.** On a machine with no
  .NET every render failed before it began. The CLI now starts the host and the window the way it
  was itself shipped: on the runtime it is running on, or from their own executables when it
  carries its runtime with it. The tarball's README says what `render` does need: Google Chrome.
- **[B-017](./.doc/bugs/B-017-new-model-left-uncommitted-where-git-knows-nobody.md) — a new model
  was left uncommitted where git had not been told who you are**, so your first `git status` listed
  every file Stemma wrote. The scaffold's one commit is now made in Stemma's name when git has no
  name for you, for that commit only; your own first commit still asks.

### Fidelity, enforced — 2026-10-17

The fidelity suite the testing guide has always described — every operation, a minimal, a realistic
and a pathological fixture, the diff containing only the intended change — did not exist. What did
exist checked each edit with `Contains`, which passes while the comment two lines up disappears.
Writing the suite properly, comparing whole files byte for byte, failed 52 of its first 54 cases.
Everything below was found by it or on the way to it. The rules each operation now keeps are written
down, for the first time, in the [operations catalog](./.doc/architecture/engine-backend.md#the-operations-catalog).

**Added**

- **The fidelity suite** (`tests/Stemma.Engine.Tests/Fidelity/`). Every model and type operation,
  against three fixtures each — the pathological ones with a BOM, tabs, mixed line endings,
  `#region`/`#if`, block comments inside argument lists and named arguments — compared with
  hand-written edits, then undone and redone, byte for byte: 84 cases.
- **The operations catalog** — what each operation edits exactly and what it refuses.

**Fixed**

- **[B-009](./.doc/bugs/B-009-edits-rebuild-the-declaration.md) — setting an attribute or a tag
  rewrote the whole declaration.** Moving a module, setting what a Risk is about, a payload or a
  lifecycle deleted the comments around the line, re-indented it, collapsed it onto one line and —
  for a tag — deleted the RAPID roles. Removing an element took every comment and `#endregion` above
  it, and a tagged element or link could not be removed at all. Each edit now changes one argument,
  in place. Declarations written with named arguments, which the reader could not see, are read and
  edited like the rest.
- **[B-007](./.doc/bugs/B-007-undo-rebuilds-instead-of-restoring.md) — undo rebuilt what an edit
  removed** at the end of the method, without its comment, its tag or what it was about. Undo now
  puts back exactly what the edit changed, so edit-then-undo is no diff at all; when the file has
  been edited elsewhere in between, it falls back to re-declaring rather than erasing that edit.
- **[B-008](./.doc/bugs/B-008-outside-edit-is-written-back-forever.md) — an outside edit was written
  back to disk about once a second, forever**, without its BOM, with every canvas re-fetching each
  time. And an edit made in the second before the watcher noticed a save was written over that save;
  it is now refused as `ChangedOnDisk`, the save is read, and a retry lands on top of it.
- **[B-006](./.doc/bugs/B-006-model-only-edit-adds-a-byte-order-mark.md) — the first edit to a
  model created from the start screen gave the file a BOM**, so line 1 changed in every first diff.
- **[B-010](./.doc/bugs/B-010-saving-a-view-rewrites-its-file.md) — saving a view regenerated its
  file from a template**, losing its doc comment, renaming it after the view, and deleting any other
  view file that quoted its id. Views are now edited in place by the engine. A new file in a project
  workspace no longer adds a duplicate `<Compile Include>` to the `.csproj`.
- **[B-011](./.doc/bugs/B-011-type-operations-ignore-layout.md) — the type operations ignored
  layout:** a new property landed on the closing brace's line, removing one left its doc comment on
  the next, and RemoveInheritance on a type with only interfaces removed an interface.
- **[B-012](./.doc/bugs/B-012-the-browser-outranks-the-repository.md) — the browser's copy of a
  workspace outranked the repository.** A view deleted in a pull, a note or style a teammate removed
  came back on every open from `localStorage`, and a returned view was written back into `Views/`
  the first time it was edited. Each open put this browser's layout modes over the committed ones,
  by way of a write sent before the sidecar had been read, and if the read was slow that write
  replaced `stemma.layout.json` with the modes alone. The browser's copy is now a cache: it is drawn
  until the repository has been read and then replaced, never merged. Views are read from the code
  on every refresh, and a refused view save is put back and said, not only logged.
- **[B-015](./.doc/bugs/B-015-outside-changes-to-the-set-of-files-are-missed.md) — a pull that added
  or deleted files was not taken in.** A view pulled in while the canvas was open was saved into a
  second file with the same id. A deleted file went on being part of the model, and when it came
  back it was taken for an echo. Of several files changed at once, only the last was read. The
  engine's set of files now follows the disk.
- **[B-013](./.doc/bugs/B-013-append-to-a-crowded-line-starts-a-new-one.md) — an id added to a view
  laid out several ids to a line** went on a line of its own, at column 0. It now goes at the end of
  the last line.
- **[B-014](./.doc/bugs/B-014-the-sidecar-is-written-whole-from-a-stale-copy.md) — every canvas
  edit rewrote the whole of `stemma.layout.json`,** re-serialized from the copy read at the start of
  the session: a box dragged into a view was a 102-line diff, and a change made to the sidecar
  outside during the session was written over. The canvas now sends what changed and the engine
  applies it to the file's text as it is
  ([ADR-0021](./.doc/architecture/decisions/0021-sidecar-written-as-changes.md)). The same drag is
  +8/−1, and a pull made mid-session is read and kept. A sidecar that does not parse is refused
  rather than read as empty and written back.
- **[B-018](./.doc/bugs/B-018-comments-written-whole-and-read-as-empty.md) — comments were written
  whole from the panel's copy, and a file that did not parse read as none.** A comment that arrived
  in a pull while the panel was open was lost with the next one posted; every write re-serialized
  the file, dropping keys it did not know and escaping every Polish letter; and a file a merge had
  left its markers in showed no comments and was replaced by the next one. The panel now sends
  what it did — add, reply, resolve, remove — by id, onto the file as it is, and shows the file the
  engine answers with; an open panel picks up a comment written outside. A file that does not parse
  is said to be, with the line to look at, and nothing is written to it; the report export says the
  same instead of shipping without comments.
- **New text in a sidecar is no longer escaped unless the file already escapes.** A file with raw
  characters, or none at all yet, gets them raw.

### The first ten minutes — 2026-08-11

Stemma was good at opening a model and weak at starting one. Walking the real path from a scratch
directory found six distinct stops, and two of them were invisible from inside a development
checkout. [F-003](./.doc/features/F-003-from-scratch-onboarding.md) is the whole account; this is
what changed.

**Added**

- **Three doors on the start screen** — start from a template, start empty, or open something that
  exists. A model is created by *name* and lands in `~/stemma/<name>`: no filesystem path is typed
  at any point, which is what the old flow demanded of everyone.
- **Templates** — a C4 system with its containers, DDD contexts with their capabilities, and a data
  flow. Each is a *script of the ordinary operations*, so what it leaves behind is ordinary C# you
  can rename or delete; nothing is stored that describes a template, and there is nothing to
  migrate when the vocabulary moves.
- **Guidance on an empty canvas** instead of a bare grid. Every way to add the first element —
  right-click, the palette, ⌘K — was invisible until you already knew it existed. It disappears for
  good once the model has something in it.
- **The line of C# your first box became**, shown once and dismissible, read back out of
  `Architecture.cs` rather than rendered from the model. It is the only place in the product where
  the premise is demonstrated instead of asserted, and it is only worth anything because it is the
  file's own text. New: `GET /api/workspace/source/{id}`.

**Fixed**

- **Creating an element did not actually focus its name field.** It has claimed to since the feature
  was written, and the code reads as correct: the editor mounts, calls `focus()`, selects the text.
  React Flow keeps a node `visibility: hidden` until it has measured it, a new element mounts its
  editor before that measurement, and focusing a hidden element does nothing at all — so the field
  looked ready to type into and what you typed went to the canvas as shortcuts. Found by driving the
  journey rather than by reading the code, which is the same lesson as the render defects: a call
  that succeeds is not an outcome that happened.
- **The rename field had no accessible name**, so it announced as "edit text, blank" — and it is the
  first thing on the canvas that an element's creator meets.

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
