# Tech Stack & Conventions

## Stack at a glance

| Layer | Tech |
|---|---|
| Engine / Model | .NET 10, C#, Roslyn (`Microsoft.CodeAnalysis`, MSBuildWorkspace, `DocumentEditor`) |
| Web host | ASP.NET Core 10, SignalR, REST (minimal/controller endpoints) |
| Desktop shell | Photino.NET 4 over the OS webview — WebKitGTK 4.1 / GTK3 on Linux ([ADR-0017](./decisions/0017-desktop-shell-photino.md)) |
| Frontend | React 19, Vite, TypeScript, `@xyflow/react` (React Flow 12), `zustand`, Tailwind CSS |
| Rich text | contenteditable + a custom markdown ⇄ DOM bridge (`lib/markdownDom.ts`); Monaco available |
| Export | `html-to-image` (PNG/SVG) |
| Backend tests | xUnit + FluentAssertions |
| Frontend tests | vitest (+ happy-dom for DOM-touching units) |
| Storage | Git working tree — `.cs` model + `stemma.layout.json` sidecar |

Sample workspaces target `net8.0` and reference `src/Stemma.Model` (they only need the DSL
vocabulary), e.g. [`../../samples/AuroraRail/AuroraRail.csproj`](../../samples/AuroraRail/AuroraRail.csproj).
A workspace with no project file at all loads through the SDK-free path (ADR-0016).

**Three binaries, one host.** `Stemma.Web` is the application; `StemmaWebHost.Build(args)` returns it
so that anything can start it. `stemma-desktop` (`src/Stemma.Desktop`) hosts it in its own process
behind a native window; `stemma` (`src/Stemma.Cli`) runs it as a short-lived child for a render. The
CLI deliberately does **not** reference the shell — the render path must stay headless — so
`stemma open` launches the shell as a process instead.

The host binds `127.0.0.1:0` unless told otherwise and reports the assigned address off
`IServerAddressesFeature`; `--port-file <path>` writes it out for a launcher that is not in the same
process. `run.sh --dev` is the one thing that still pins a port (5050), because the Vite proxy has to
name a target.

## Build & test commands

```bash
# Backend
dotnet build
dotnet test                              # xUnit; round-trip fidelity suite is the core gate

# Frontend (from src/Stemma.Web.Client)
npx tsc --noEmit -p tsconfig.json        # typecheck
npx vite build                           # build
npx vitest run                           # tests
```

Green tests are required per change — see [`../engineering/testing.md`](../engineering/testing.md).

## Conventions that are load-bearing

- **Engine purity.** `Stemma.Engine` depends only on Roslyn + `Stemma.Model`. LLM/web concerns live in
  `Stemma.Web`. Do not add web or LLM references to the engine.
- **Fidelity first.** All the engine rules in [`engine-backend.md`](./engine-backend.md) apply to every
  backend change.
- **Presentation vs model.** The split in [`data-flow-and-sync.md`](./data-flow-and-sync.md) is
  absolute — model in code, presentation in the sidecar, never a third store.
- **Frontend store discipline.** Stable selectors; prime the sidecar once; never rebuild nodes
  mid-drag; preserve `selected` across rebuilds (see [`client-frontend.md`](./client-frontend.md)).
- **Match the surrounding code.** New code should read like its neighbours — same comment density,
  naming, and idiom.

## Versioning & history

The model's history *is* Git history. Branches are work-in-progress; tags mark model snapshots; PRs
are how architecture changes are reviewed (the diff shows in both code and canvas). There is no
separate migration system because there is no separate store.

## Diagnostics

`Microsoft.Extensions.Logging` as the API everywhere; **Serilog** as the provider in `Stemma.Web`
only, with the console and rolling-file sinks. `Microsoft.Extensions.Logging` ships no file provider
and its three console formatters are the whole of the box, so a provider was needed; Serilog was
chosen over NLog (heavier to configure for one sink) and the OpenTelemetry file exporter (drags in
the OTel SDK to solve a problem deliberately scoped out).

It is wired as a provider behind `ILogger`, so **no call site names Serilog** and the choice stays
reversible in one file. The engine never sees it: it depends on
`Microsoft.Extensions.Logging.Abstractions` alone ([ADR-0020](./decisions/0020-diagnostics-contract.md)).

**There is no network sink and none can be configured.** Logs go to the console and to
`~/.stemma/logs/`, capped at 20 MB per file, 10 files, 14 days.
