# Feature: Desktop shell — run Stemma in its own window

| Field | Value |
|---|---|
| **ID** | F-002 |
| **Status** | `Draft` |
| **Owner** | Bartosz |
| **Persona served** | Solo solution/data architect; consultant architect (see [`../product/users-and-personas.md`](../product/users-and-personas.md)) |
| **Roadmap horizon** | `Next` |
| **Created / Updated** | 2026-08-01 / 2026-08-01 |

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

- [ ] AC1 — A single command (`stemma`, or the desktop entry) opens a native window with the app
      loaded; no terminal, no URL, no visible port.
- [ ] AC2 — Closing the window shuts down the backend. No orphaned process holds the port; a second
      launch either focuses the running instance or starts cleanly.
- [ ] AC3 — Window size, position and maximised state persist between runs.
- [ ] AC4 — **Open** and **Create** use the OS folder picker; a path can still be typed.
- [ ] AC5 — `stemma --workspace <path>` opens that workspace directly (the existing `run.sh` flag),
      so a `.desktop` file can register Stemma as a folder handler later.
- [ ] AC6 — Canvas interaction (pan/zoom/drag on the largest sample) is smooth in the shell's engine —
      no worse than Chromium today. This is the gating acceptance test, see §6.
- [ ] AC7 — Browser mode still works unchanged for development and for anyone who prefers it.

## 3. Architecture impact

- [ ] **Model or presentation?** Neither. This is host/packaging only; no model, no sidecar, no
      operations.
- [ ] **New/changed operations:** none.
- [ ] **Fidelity:** untouched — the shell does not participate in rewrites.
- [ ] **Engine purity:** preserved. The shell wraps `Stemma.Web`; `Stemma.Engine` gains nothing.
- [ ] **Sidecar:** none. Window geometry is *app* state, not model or view presentation — it belongs
      in the existing per-user config directory (`~/.stemma/`), **not** in `stemma.layout.json` and
      not in a new store.
- [ ] **ADR needed?** Yes — the shell choice is hard to reverse and constrains packaging. Write it
      once the §6 spike settles the renderer question.
- **Affected files/areas:** `src/Stemma.Web/Program.cs` (host lifetime, dynamic port binding),
  `run.sh`, a new `src/Stemma.Desktop/` project, packaging scripts.

## 4. UX impact

- [ ] **Journey(s) touched:** J1 (open and orient) loses its "type a path" step in favour of a
      picker. All other journeys are unchanged inside the window.
- [ ] **States defined:** launching (window visible with a splash while Kestrel binds — never a blank
      white window); backend-failed-to-start (an in-window error with the log path, not a dead page);
      second-instance (focus the existing window).
- [ ] **Interactions:** standard window controls; keyboard shortcuts must not collide with the
      shell's own (verify Ctrl+W does not silently discard work).
- [ ] **Accessibility:** the window must respect the system font scale and `prefers-reduced-motion`;
      the webview must expose the existing ARIA tree to AT unchanged.

## 5. UI impact

- [ ] **Components touched/added:** none inside the app. New: a launch/splash surface and an
      OS-level icon set derived from `StemmaMark`.
- [ ] **Tokens:** unchanged.
- [ ] **Both themes:** the window chrome must follow the system light/dark preference so the title
      bar does not clash with the in-app theme.
- [ ] **Layout/rail behavior:** unchanged.

## 6. Technical prerequisites & dependencies

**The blocking constraint.** `WorkspaceLoader` calls `MSBuildLocator.RegisterDefaults()` and
`MSBuildWorkspace.Create()` (`src/Stemma.Engine/Workspace/WorkspaceLoader.cs:21`), so **a .NET SDK
must be installed on the machine** — a self-contained bundle does not remove that requirement. Two
ways out, and they are not exclusive:

1. Document the SDK as a prerequisite (honest, but a poor first-run for a non-developer architect).
2. Add an SDK-free loader for *model-only* workspaces — a workspace whose only reference is
   `Stemma.Model` does not need MSBuild; parsing `Architecture/*.cs` into an `AdhocWorkspace` is
   enough. This also unblocks [F-003](./F-003-from-scratch-onboarding.md) and is the higher-value
   fix. Needs its own ADR: it introduces a second load path with different fidelity guarantees.

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

- [ ] Photino's Linux builds have historically tracked `webkit2gtk-4.0` while modern Flatpak runtimes
      want `4.1` — confirm the current package's requirement before choosing a distribution format.
- [ ] Distribution order: tarball + `.desktop` file → AppImage → Flatpak (only if there is demand).
- [ ] Port binding must become dynamic (bind :0, read the assigned port) so two instances cannot
      collide; this also removes most of `run.sh`'s cleanup logic.

## 7. Test plan

- [ ] Manual: launch, resize, close, relaunch; verify no process survives and geometry restores.
- [ ] Automated: a smoke test that boots the host with a dynamic port and asserts the SPA is served.
- [ ] Performance: the §6 canvas benchmark, recorded as numbers in this record before B is accepted.
- [ ] Regression: `./run.sh --dev` and `--prod` must behave exactly as before.

## 8. Definition of Done

- [ ] All ACs met and demoed
- [ ] States handled; accessibility bar met
- [ ] `dotnet test` green · `tsc` clean · `vite build` clean · `vitest` green
- [ ] Model/presentation boundary respected; no new data store
- [ ] Docs updated: `../architecture/tech-stack.md`, `../ux/user-journeys.md` (J1), `README.md`
- [ ] Reviewed against all four pillars

## 9. Notes / open questions

- Does the desktop shell change the licensing story? A packaged binary is what a commercial licence
  would actually be sold against — coordinate with [commercialization](../product/commercialization.md) Phase 2a.
- Windows/macOS are free-ish with option B, but neither is a target until Linux is solid.
