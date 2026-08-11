# ADR-0017: Photino as the desktop shell

| Field | Value |
|---|---|
| **Status** | `Accepted` |
| **Date** | 2026-08-01 |
| **Deciders** | Bartosz |

## Context

Stemma runs as `./run.sh` plus a browser tab on `localhost:5050`. It reads as a dev server rather
than a tool: the tab is lost among others, it has no dock or alt-tab identity, closing it leaves
Kestrel running, a second run collides on the port, and a browser tab cannot open a native folder
picker — which is one of the reasons creating a workspace meant typing an absolute path
([F-002](../../features/F-002-desktop-shell.md), [F-003](../../features/F-003-from-scratch-onboarding.md)).

The product is local-first by construction: the engine compiles the user's repository, so the editor
will never be a shared cloud service. A local-first tool that exists only as a localhost URL is
fighting its own distribution story, and the `dotnet tool install -g Stemma` install promised by
commercialization Phase 0 needs something to launch.

The choice is constrained by what Stemma is: a .NET host serving a canvas-heavy React SPA, run by one
maintainer on evenings and weekends. A second language toolchain is a real, recurring cost.

## Decision

We will ship the desktop shell as **Photino.NET**: one .NET process hosting both Kestrel and a native
webview window.

Consequences of that shape: a single `dotnet publish` produces the app, there is no Node or Rust
runtime in the distribution, window lifetime owns process lifetime (closing the window stops the
backend), and native file dialogs become available — which is what lets **Open** use a real folder
picker.

The shell shipped on 2026-08-11 as `src/Stemma.Desktop` (binary: `stemma-desktop`). Kestrel binds
`127.0.0.1:0` in the shell's own process and the assigned address is read back off
`IServerAddressesFeature`, so the window navigates to a port nothing else can collide with and the
"no orphaned process" property holds by construction rather than by cleanup.

`run.sh --window` now launches that shell. It keeps the browser app-mode (`--app=`) it had before as
the fallback for `--dev`, where the app must be served from Vite's origin for HMR to work.

**One consequence worth stating: an origin can no longer be enumerated in advance.** The CORS
allow-list that named the dev server was already wrong for `--prod` and became unfixable once the
port belonged to the OS; it is now a loopback predicate ([B-005](../../bugs/B-005-cors-policy-refuses-the-page-the-host-is-serving.md)).

## Consequences

- **Positive:** one toolchain, one publish, small distribution. The shell is a wrapper, so the app
  keeps working unchanged in a browser for development and for anyone who prefers it. Combined with
  [ADR-0016](./0016-sdk-free-model-only-workspaces.md), a packaged Stemma can create and open models
  on a machine with no .NET SDK at all.
- **Negative / trade-offs:** on Linux, Photino renders through **WebKitGTK**, not Chromium — a
  different engine from the one the app is developed against, with its own bugs and no shared devtools
  story. Photino is also a smaller project than Electron; if it stalls, the wrapper has to be replaced
  (cheap, since it is only a wrapper). Packaging must deal with `webkit2gtk-4.0` versus `4.1`: modern
  Flatpak runtimes want 4.1, and the native package has historically tracked 4.0.
- **Neutral:** Windows and macOS come nearly free later (WebView2 and WKWebView), but neither is a
  target until Linux is solid.

## Verification (the gating risk)

Stemma is a canvas application, so **renderer performance is the one thing that could invalidate this
decision**. `scripts/bench/run-bench.py` measures frame-time percentiles during a scripted
pan → zoom → drift over a scene mirroring React Flow's DOM shape (transformed viewport, absolutely
positioned nodes, an SVG edge layer). Two profiles: *realistic* (60 nodes / 70 edges — the largest
existing sample, `AuroraRail`) and *stress* (250 / 400).

Chromium baseline, recorded 2026-08-01 on this machine (120 Hz display):

| profile | mean fps | p50 | p95 | p99 | frames > 16.7 ms |
|---|---|---|---|---|---|
| realistic (60/70) | 118.9 | 8.3 ms | 8.4 ms | 8.5 ms | 0.3% |
| stress (250/400) | 118.9 | 8.3 ms | 8.4 ms | 8.5 ms | 0% |

**The WebKitGTK half was run on 2026-08-11** — WebKitGTK 2.52.3 / JSC 4.1 via Epiphany 49.2, the
same engine and version Photino renders with on Linux — and **it passes**. Full numbers and their
reading are in [F-002 §7.1](../../features/F-002-desktop-shell.md#71-canvas-benchmark-result-the-6-spike);
the decisive column:

| profile | engine | frames > 33.3 ms | worst frame |
|---|---|---|---|
| realistic (60/70) | WebKit | **0%** | 18 ms |
| stress (250/400) | WebKit | **0.3–0.7%** | ~230 ms, once, reproducibly |

The acceptance bar was written as "p95 within roughly 2× of Chromium, and no sustained frame times
above 33 ms". The second half is met outright. The first half turned out to be the wrong question:
WebKitGTK caps `requestAnimationFrame` at 60 Hz while Chromium presents at 120 on this display, so
every WebKit frame is ~17 ms *by construction* — a cadence difference, not stutter. What the bar was
reaching for is dropped frames, and there are none at the realistic profile.

**Photino is therefore accepted on measurement as well as on fit, and Electron is not needed.** Two
caveats stand: Epiphany is a proxy for Photino rather than Photino itself, so the benchmark should be
re-run against the shell now that it exists; and this is one machine, with no low-end or
software-rendered case tested.

## Alternatives considered

- **Tauri v2.** Smallest bundles and an excellent reputation, but on Linux it renders through the same
  WebKitGTK as Photino, so it buys **no rendering advantage** over the recommendation while adding
  Rust and a two-process lifecycle (Rust shell supervising a .NET sidecar) to a one-person project.
- **Electron.** The safe renderer — Chromium, identical to development — at ~150 MB, a Node toolchain,
  and the job of supervising the .NET process. Kept as the explicit fallback if the benchmark fails.
- **.NET MAUI Blazor Hybrid.** No Linux support. Out.
- **Browser app-mode / PWA only.** Nearly free and genuinely useful, so it ships now — but no native
  dialogs, no process lifetime control, and it still depends on the user's browser.

## Relationship to the inviolable rules

The shell touches none of them: it hosts the existing web app and adds no model, no operations and no
store. Window geometry is application state and belongs in the per-user config directory
(`~/.stemma/`), **not** in `stemma.layout.json` — that sidecar is presentation state for a view, and
reusing it for window size would be exactly the kind of drift rule 3 exists to prevent. Engine purity
is unaffected: the shell wraps `Stemma.Web`, and `Stemma.Engine` gains nothing.

## References

- [F-002](../../features/F-002-desktop-shell.md) — the feature record, including the packaging notes.
- [ADR-0016](./0016-sdk-free-model-only-workspaces.md) — removes the SDK prerequisite that would
  otherwise make a desktop bundle pointless.
- `scripts/bench/` — the harness and how to run it.
