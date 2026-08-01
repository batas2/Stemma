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

Until the shell exists, `run.sh` gains a `--window` flag that opens the app in the user's browser in
app-mode (`--app=`), giving a chrome-less window with its own icon today for essentially no work.

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
existing sample, `RiskArch`) and *stress* (250 / 400).

Chromium baseline, recorded 2026-08-01 on this machine (120 Hz display):

| profile | mean fps | p50 | p95 | p99 | frames > 16.7 ms |
|---|---|---|---|---|---|
| realistic (60/70) | 118.9 | 8.3 ms | 8.4 ms | 8.5 ms | 0.3% |
| stress (250/400) | 118.9 | 8.3 ms | 8.4 ms | 8.5 ms | 0% |

**The WebKitGTK half has not been run**: this machine has no WebKitGTK runtime installed
(`libwebkit2gtk-4.0`/`4.1` absent, no Epiphany, no PyGObject WebKit2), and installing one needs root.
Until it is run, this ADR is a decision made on architecture-fit, not on measured rendering.

Acceptance bar, to be recorded here when the run happens: p95 frame time within roughly 2× of the
Chromium baseline at the realistic profile, and no sustained frame times above 33 ms while panning.
If WebKitGTK misses that, the fallback is **Electron** — accepting ~150 MB and a Node toolchain to
guarantee the renderer — and this ADR is superseded.

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
