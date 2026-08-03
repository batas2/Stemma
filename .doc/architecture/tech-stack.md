# Tech Stack & Conventions

## Stack at a glance

| Layer | Tech |
|---|---|
| Engine / Model | .NET 10, C#, Roslyn (`Microsoft.CodeAnalysis`, MSBuildWorkspace, `DocumentEditor`) |
| Web host | ASP.NET Core 10, SignalR, REST (minimal/controller endpoints) |
| Frontend | React 19, Vite, TypeScript, `@xyflow/react` (React Flow 12), `zustand`, Tailwind CSS |
| Rich text | contenteditable + a custom markdown ⇄ DOM bridge (`lib/markdownDom.ts`); Monaco available |
| Export | `html-to-image` (PNG/SVG) |
| Backend tests | xUnit + FluentAssertions |
| Frontend tests | vitest (+ happy-dom for DOM-touching units) |
| Storage | Git working tree — `.cs` model + `stemma.layout.json` sidecar |

Sample workspaces target `net8.0` and reference `src/Stemma.Model` (they only need the DSL
vocabulary), e.g. [`../../samples/AuroraRail/AuroraRail.csproj`](../../samples/AuroraRail/AuroraRail.csproj).
A workspace with no project file at all loads through the SDK-free path (ADR-0016).

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
