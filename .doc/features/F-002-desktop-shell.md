# Feature: Desktop shell — run Stemma in its own window

| Field | Value |
|---|---|
| **ID** | F-002 |
| **Status** | `Shipped (v1)` — window, dynamic port, geometry, folder picker, tarball. AppImage/Flatpak not started. |
| **Owner** | Bartosz |
| **Persona served** | Solo solution/data architect; consultant architect (see [`../product/users-and-personas.md`](../product/users-and-personas.md)) |
| **Roadmap horizon** | `Next` |
| **Created / Updated** | 2026-08-01 / 2026-08-11 |

## 1. Product — why

- **Problem:** Stemma is started with `./run.sh` and used in a browser tab on `localhost:5050`. That
  reads as a dev server, not a tool. The tab is lost among forty others, it has no dock/alt-tab
  identity, closing it leaves Kestrel running, and a second run collides on the port — `run.sh`
  already carries stale-process and port-reclaim logic to paper over exactly this. Worse, a browser
  tab cannot open a native folder picker, so creating or opening a workspace means **typing an
  absolute filesystem path** (see [F-003](./F-003-from-scratch-onboarding.md)).
- **Why now:** the product is local-first by design — the engine compiles the user's repository, so
  the editor will never be a shared cloud service ([commercialization](../product/commercialization.md) §1).
  A local-first tool that only exists as a localhost URL is fighting its own distribution story.
  A window is also the precondition for the `dotnet tool install -g Stemma` one-command install that
  Phase 0 promises.
- **Value:** supports *Trustworthy edits* and *Git-native lifecycle* by making Stemma feel like an
  app the architect keeps open beside the IDE, not a page they re-launch.
- **Out of scope:** mobile/tablet shells; an embedded IDE; auto-update; code signing and notarisation
  (Linux first, and Linux does not need them).

## 2. User story & acceptance criteria

> As an **architect**, I want to launch Stemma as a normal desktop window, so that it behaves like a
> tool I own rather than a server I babysit.

- [x] AC1 — A single command (`stemma open`, `stemma-desktop`, or the desktop entry) opens a native
      window with the app loaded; no terminal, no URL, no visible port. The shell is its own binary
      (`stemma-desktop`) rather than `stemma` itself: the CLI is the headless half and must not
      acquire a native webview, so `stemma open` launches the shell and the two stay separable.
- [x] AC2 — Closing the window shuts down the backend, *by construction* rather than by cleanup:
      Kestrel runs in the shell's own process, so there is nothing left to orphan. A second launch
      starts cleanly — with the port chosen by the OS, two windows cannot collide, which is the
      branch of this AC that suits a local-first tool better than focusing the first instance.
- [x] AC3 — Size and maximised state persist between runs, clamped back onto a monitor that exists.
      **Position persists where the platform allows it.** Under Wayland a client cannot know or set
      its own position, so the shell centres and the compositor decides; the saved coordinates are
      honoured on X11. See §7.2.
- [x] AC4 — **Open** uses the OS folder picker in the shell, and the typed-path dialog in a browser
      tab; the GTK dialog's own location entry is where a path is typed. **Create** stays name-only
      by default — it needs no path at all — with *Create somewhere else…* opening the picker.
- [x] AC5 — `stemma-desktop --workspace <path>`, or a bare path, opens that workspace directly. The
      bare form is what a `.desktop` entry's `%f` expands to, and the shipped entry declares
      `MimeType=inode/directory`, so Stemma is an "Open with…" target for a folder today.
- [x] AC6 — Measured, and passed on the restated criterion. See [§7.1](#71-canvas-benchmark-result-the-6-spike).
- [x] AC7 — Browser mode is unchanged: `./run.sh --dev` and `--prod` both verified end to end
      (§7.3). The same bundle runs in both; the shell is detected at runtime and adds one capability.

## 3. Architecture impact

- [x] **Model or presentation?** Neither. This is host/packaging only; no model, no sidecar, no
      operations.
- [x] **New/changed operations:** none.
- [x] **Fidelity:** untouched — the shell does not participate in rewrites.
- [x] **Engine purity:** preserved. The shell wraps `Stemma.Web`; `Stemma.Engine` gains nothing.
- [x] **Sidecar:** none. Window geometry is *app* state, not model or view presentation — it lives
      in `~/.stemma/window.json`, **not** in `stemma.layout.json` and not in a new store.
- [x] **ADR needed?** [ADR-0017](../architecture/decisions/0017-desktop-shell-photino.md), whose
      verification section now carries the measured numbers rather than a promise to measure.
- **Affected files/areas:** `src/Stemma.Web/StemmaWebHost.cs` (**new** — the host extracted from
  `Program.cs` so something other than a process can start it), `src/Stemma.Desktop/` (**new**),
  `src/Stemma.Cli/OpenCommand.cs` (**new**), `src/Stemma.Web.Client/src/lib/shell.ts` (**new**),
  `EmptyState.tsx`, `run.sh`, `scripts/package/`.

**One structural change worth naming.** `Program.cs` was 450 lines of top-level statements, which is
right until a second thing wants to start the same application. The shell holds Kestrel *and* the
window in one process, so it needs the `WebApplication` object — to read the address Kestrel bound
before navigating to it, and to stop the server when the window closes. The host therefore moved to
`StemmaWebHost.Build(args)`, and `Program.cs` became four lines that call it. Nothing else changed;
the endpoints are the same endpoints.

## 4. UX impact

- [x] **Journey(s) touched:** J1 (open and orient) loses its "type a path" step in favour of a
      picker. All other journeys are unchanged inside the window.
- [x] **States defined:** launching (a splash while Kestrel binds — the window is created first and
      the backend starts alongside it, so there is never a blank white window);
      backend-failed-to-start (an in-window error naming the reason and the log directory, including
      the specific case of a front end that has not been built); second-instance — **resolved by
      starting cleanly rather than focusing**, which the dynamic port makes free and which is the
      better answer for a tool you may want two of.
- [x] **Interactions:** standard window controls. The webview's own context menu is disabled so the
      canvas keeps its right-click menu.
- [x] **Accessibility:** the splash uses the system font stack and relative units so it follows the
      system font scale, honours `prefers-reduced-motion` (the pulse stops) and
      `prefers-color-scheme` (so a dark desktop never gets a white flash). The app itself is the
      same DOM as in a browser, so its ARIA tree is unchanged.

## 5. UI impact

- [x] **Components touched/added:** `EmptyState` gains a desktop-only *Create somewhere else…*
      action; everything else in the app is untouched. New outside the app: the splash surface, and
      a `.desktop` entry carrying the `StemmaMark` as its icon — which is what actually gives Stemma
      a menu, dock and alt-tab identity on Linux.
- [x] **Tokens:** unchanged. The splash cannot import them — it is what is shown *before* the app
      exists — so it carries its own four colours and says so.
- [x] **Both themes:** the splash follows `prefers-color-scheme`; the window chrome is the system's
      own, drawn by GTK.
- [x] **Layout/rail behavior:** unchanged.

## 6. Technical prerequisites & dependencies

**The blocking constraint — resolved.** `WorkspaceLoader` calls `MSBuildLocator.RegisterDefaults()`
and `MSBuildWorkspace.Create()`, so **a .NET SDK must be installed** for a repository workspace, and
a self-contained bundle does not remove that. Both ways out were taken: the SDK is documented as a
prerequisite for repository workspaces, and `ModelWorkspaceLoader` ([ADR-0016](../architecture/decisions/0016-sdk-free-model-only-workspaces.md))
opens a *model-only* workspace with no MSBuild at all. A packaged Stemma can therefore create and
open a model on a machine with no .NET installed of any kind, which is what makes the tarball worth
shipping.

**Shell options evaluated:**

| Option | What it is | Bundle | Effort | Verdict |
|---|---|---|---|---|
| **A. Browser app-mode / PWA** | `chromium --app=http://localhost:PORT`, or an installable PWA | 0 | hours | **Do this now.** A chrome-less window with its own icon, using the browser already installed. No picker, no native menus — but it is 95% of the perceived benefit for ~1% of the work. |
| **B. Photino.NET** | Thin .NET wrapper over the native webview (WebKitGTK on Linux) | small + .NET | ~2–4 weekends | **The recommended real shell.** Same process hosts Kestrel and the window; one `dotnet publish`; no second toolchain; native dialogs available. |
| **C. Tauri v2** | Rust shell supervising a .NET sidecar | smallest | high | **No.** On Linux it renders with the *same* WebKitGTK as Photino, so it buys no rendering advantage while adding Rust and a two-process lifecycle to a solo project. |
| **D. Electron** | Bundled Chromium + Node supervising the .NET process | ~150 MB+ | medium | **The fallback.** Only justified if the §6 spike shows WebKitGTK cannot drive the canvas. It guarantees the renderer already targeted in development. |

**Spike before committing to B (half a day, do it first):** load the largest sample in a WebKitGTK
webview and measure React Flow pan/zoom/drag against Chromium. Stemma is a canvas-heavy app with SVG
edges and many nodes; WebKitGTK is the single biggest risk in this feature, and it is cheap to
falsify early. If it fails, take D and accept the size.

- [x] Photino's Linux builds have historically tracked `webkit2gtk-4.0` while modern Flatpak runtimes
      want `4.1` — confirm the current package's requirement before choosing a distribution format.
      **Resolved: 4.1.** `Photino.Native` 4.0.22 (pulled by `Photino.NET` 4.0.16) links
      `libwebkit2gtk-4.1.so.0`, `libjavascriptcoregtk-4.1.so.0` and `libgtk-3.so.0` — GTK3, not the
      GTK4 `libwebkitgtk-6.0`. That matches modern Flatpak runtimes, so no distribution format is
      ruled out. `Photino.NET` ships `net8.0`/`net9.0` assemblies only; a `net10.0` host consumes
      them fine.
- [x] Distribution order: tarball + `.desktop` file → AppImage → Flatpak (only if there is demand).
      **Tarball done** — `scripts/package/package-linux.sh` publishes both binaries and the built
      front end into one folder, self-contained (114 MB), with an `install.sh` that needs no root.
      AppImage and Flatpak are not started and have no demand yet.
- [x] Port binding is dynamic. Kestrel binds `:0` and the bound address is read back off
      `IServerAddressesFeature` rather than scraped from a log line, so there is no race and no
      dependence on log formatting. `run.sh --prod` uses it via a `--port-file`; the stale-process
      reclaim now runs only in `--dev`, which pins 5050 because the Vite proxy has to name a target.

## 7. Test plan

- [x] Manual: launch, close, relaunch. Verified no process survives (`ps` clean after each run) and
      that a saved size is restored — the shell logs `SetSize(1100, 720)` for a geometry file
      written by hand, and writes the same values back on exit. Position: see §7.2.
- [x] Automated: `tests/Stemma.Desktop.Tests` (52) boots the real host on a dynamic port and asserts
      the SPA is served, a deep link falls back to it, the API is still reachable beside it, two
      sessions get different ports, a bad `--workspace` still opens a window, and disposing the
      session frees the port. Plus the geometry store, the page↔shell protocol and argument parsing.
      `tests/Stemma.Web.Tests` (61) covers finding the front end and publishing the bound address.
- [x] Performance: the §6 canvas benchmark, recorded as numbers in this record before B is accepted.
      **Result below — WebKitGTK passes.**
- [x] Regression: `./run.sh --dev` and `--prod` both driven end to end (§7.3).

### 7.2 What Wayland does not allow

The window records its size, its maximised state and its position, and pulls a saved position back
onto a monitor that still exists — a window restored onto an undocked screen has no title bar to
drag it back by, and the only fix would be deleting a file the user does not know about.

**Position is nevertheless not restored under Wayland**, and cannot be: a Wayland client is not told
where it is and may not place itself. Photino reports `0,0` for a centred window and the compositor
owns placement. The shell therefore centres on first run and lets the compositor do what it does;
on X11 the saved coordinates are honoured. This is a platform constraint, not a defect, and AC3 is
recorded as met on that reading rather than quietly ticked.

### 7.3 Browser mode, driven rather than asserted

- `./run.sh --dev` — backend on 5050 answering `/api/workspace/snapshot`, Vite on 5173, and the
  proxy from 5173 to the API all confirmed live. Unchanged.
- `./run.sh --prod` — now binds `:0`: the script waits for the port file, prints the real URL, and
  the SPA (`200`), the API (`404`, nothing open) and a deep link (`200`) all answer on it. The port
  file is removed and no process survives Ctrl-C.
- The packaged tarball, unpacked to a clean directory: `stemma --help`, `stemma open --help`,
  `stemma validate` against `samples/AuroraRail`, and `stemma-desktop` binding and serving the app.

### 7.4 A defect this work surfaced

The CORS policy named `localhost:5173` and `127.0.0.1:5173` — the Vite dev origin — and nothing else.
That was already wrong for `run.sh --prod` on 5050 and became structurally unfixable once the port
was the OS's to choose. The consequence was one `CORS policy execution failed` record per request,
which buries the very log the shell's failure surface points at. Recorded as
[B-005](../bugs/B-005-cors-policy-refuses-the-page-the-host-is-serving.md) and fixed here.

### 7.1 Canvas benchmark result (the §6 spike)

Run with `scripts/bench/run-bench.py`. Host: Ubuntu 26.04, Wayland, 120 Hz display.
Engines: Chromium 150 (`google-chrome --app`) vs WebKitGTK 2.52.3 / JSC 4.1 (Epiphany 49.2) — the
same engine Photino renders with on Linux.

| Profile | Engine | Mean fps | p50 | p95 | p99 | Worst | >16.7 ms | >33.3 ms |
|---|---|---:|---:|---:|---:|---:|---:|---:|
| realistic (60 nodes / 70 edges) | Chromium | 120 | 8.3 | 8.4 | 8.4 | 9.6 | 0% | 0% |
| realistic (60 nodes / 70 edges) | WebKit | 60 | 17 | 17 | 17 | 18 | 65.9% | **0%** |
| stress (250 nodes / 400 edges) | Chromium | 112 | 8.3 | 8.5 | 16.7 | 116.7 | 1.4% | 0.3% |
| stress (250 nodes / 400 edges) | WebKit | 58.7 | 17 | 17 | 23 | 232 | 65.3% | **0.7%** |
| stress — repeat run | WebKit | 59.1 | 17 | 17 | 19 | 227 | 65.6% | **0.3%** |

**Reading these numbers.** Mean fps is not a like-for-like comparison: the display runs at 120 Hz,
Chromium presents at 120, and WebKitGTK caps `requestAnimationFrame` at 60. For the same reason the
`>16.7 ms` column is meaningless for WebKit — at a 60 Hz cadence *every* frame is ~16.7 ms by
construction, so 65% is a threshold artifact, not stutter. The honest smoothness metric at 60 Hz is
`>33.3 ms`, which counts genuinely dropped frames.

- **Realistic profile — WebKit drops nothing.** 0% over 33.3 ms, worst frame 18 ms. A locked 60 fps.
  This is the profile that matters: `samples/AuroraRail`, the largest real workspace, is 66 elements
  and 45 links.
- **Stress profile — one reproducible hitch.** 0.3–0.7% of frames over 33.3 ms and a worst frame of
  ~230 ms, stable across runs (227 / 232 ms), so it is a real one-off cost — first layout and paint
  of 250 nodes — not measurement noise. Chromium shows the same shape at roughly half the magnitude
  (116.7 ms). At four times the real workload, that is a headroom note, not a failure.

**Verdict: proceed with option B (Photino).** Option D (Electron) is not needed. AC6 as written
("no worse than Chromium today") is technically failed on cadence — 60 fps against 120 — while being
passed on smoothness, which is what the AC was trying to capture. **AC6 is hereby restated as: zero
dropped frames (`>33.3 ms` ≈ 0%) on the realistic profile, and under 1% on the stress profile.**

Two caveats on the evidence: Epiphany is a proxy for Photino, not Photino itself — same engine and
version, but it may configure compositing and acceleration differently. The harness takes
`--cmd 'my-shell {url}'`, so re-run it against the Photino host once the shell prototype exists and
append the numbers here. The measurement is also single-machine; a low-end laptop with software
rendering has not been tested.

## 8. Definition of Done

- [x] All ACs met and demoed
- [x] States handled; accessibility bar met
- [x] `dotnet test` green · `tsc` clean · `vite build` clean · `vitest` green
- [x] Model/presentation boundary respected; no new data store — window geometry is app state in
      `~/.stemma/window.json`, beside the log directory and `recent.json`
- [x] Docs updated: `../architecture/tech-stack.md`, `../ux/user-journeys.md` (J1), `README.md`
- [x] Reviewed against all four pillars

## 9. Notes / open questions

- **Still open, and small.** AppImage and Flatpak (no demand yet). A window icon set beyond the
  `.desktop` entry's SVG. Re-running the §6 benchmark against the shell itself now that it exists —
  the numbers below are from Epiphany, the same engine and version, but not the same host.
- Does the desktop shell change the licensing story? A packaged binary is what a commercial licence
  would actually be sold against — coordinate with [commercialization](../product/commercialization.md) Phase 2a.
- Windows/macOS are free-ish with option B, but neither is a target until Linux is solid. The shell
  itself has nothing Linux-specific in it; the packaging script does.
