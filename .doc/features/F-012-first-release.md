# Feature: The first release — a version, a way to cut one, and a one-command install

| Field | Value |
|---|---|
| **ID** | F-012 |
| **Status** | `Shipped` — 0.1.0 is cut by pushing its tag; see §9 for what is the maintainer's to do |
| **Owner** | Bartosz |
| **Persona served** | Solo solution/data architect; consultant architect (see [`../product/users-and-personas.md`](../product/users-and-personas.md)) |
| **Roadmap horizon** | `Now` |
| **Created / Updated** | 2026-10-17 / 2026-10-17 |

## 1. Product — why

- **Problem:** Stemma could be used only by someone willing to clone it and build it. Nothing had a
  version: the client's `package.json` said 0.1.0 and every assembly 1.0.0, so a bug report could
  not say which build it came from. The tarball existed, but was built by hand on the maintainer's
  machine, and had never been tried anywhere else; the first time it was, `stemma render` did not
  work ([B-016](../bugs/B-016-tarball-render-needs-the-dotnet-it-ships-without.md)). The
  `dotnet tool install -g Stemma` that the commercialization plan, ADR-0017 and F-002 all promise
  did not exist.
- **Why now:** the fidelity promise — the diff of an edit is that edit — became true for both
  stores on 2026-10-17 (B-006…B-015) and is held by tests. It is the thing worth showing, and
  Phase 0 of the [commercialization plan](../product/commercialization.md) cannot finish without
  something installable: its exit criterion is "tool installable in one command".
- **Value:** *Git-native lifecycle* and *trustworthy edits* reach someone who has not read the
  source. Every exported report now carries a credit back, so a shared report is how its readers
  hear of Stemma.
- **Out of scope:** platforms other than linux-x64; AppImage, Flatpak, Docker; code signing;
  auto-update; telemetry and an update check (see §9).

## 2. User story & acceptance criteria

> As an **architect who has heard of Stemma**, I want to install it with one command and know which
> version I have, so that trying it costs a minute and a problem I hit can be reported precisely.

- [x] AC1 — One version, written once: `VersionPrefix` in `Directory.Build.props`. `stemma --version`
      and `stemma-desktop --version` print it, `GET /api/diagnostics` reports it, the diagnostics
      bundle carries it with the commit it was built from, and the tarball's README names it.
- [x] AC2 — `dotnet tool install -g Stemma` installs `stemma` with everything it needs beside it:
      `render` and `validate` work, and `stemma open` brings up the window with the workspace loaded.
- [x] AC3 — The tarball works on a machine with no .NET: unpacked somewhere new, with `dotnet`
      hidden, `validate` and `render` both succeed (B-016 fixed).
- [x] AC4 — Pushing a tag `vX.Y.Z` builds, tests and packages that commit, tries the tarball and the
      tool package the way a user would, and leaves a draft release with both attached, their
      SHA-256 sums and the changelog's section for the version as its notes. A tag that disagrees
      with `Directory.Build.props`, or a version with no changelog section, stops it before anything
      is built.
- [x] AC5 — Publishing that draft pushes the tool packages to nuget.org when the repository has a
      `NUGET_API_KEY` secret, and says it skipped them when it does not.
- [x] AC6 — Every exported report says it was made with Stemma and links to the project page
      ([F-001](./F-001-architecture-report-export.md) AC10).

## 3. Architecture impact

- [x] **Model or presentation?** Neither. Build, packaging and the CLI's process launching.
- [x] **New/changed operations:** none.
- [x] **Fidelity:** untouched; no source rewrites.
- [x] **Engine purity:** `StemmaVersion` reads the engine's own assembly attribute and depends on
      nothing.
- [x] **Sidecar:** no change.
- [x] **ADR needed?** No. The tool package keeps ADR-0017's boundary: the CLI still does not
      reference the shell, and the shell reaches the package by its own `dotnet publish`.
- **Affected files/areas:**
  - `Directory.Build.props` (the version), `src/Stemma.Engine/Diagnostics/StemmaVersion.cs`
  - `src/Stemma.Cli/` — `Program.cs` (`--version`), `SiblingProgram.cs` (B-016),
    `Stemma.Cli.csproj` (the tool package), `PackageReadme.md`
  - `src/Stemma.Desktop/` (`--version`), `src/Stemma.Web/StemmaWebHost.cs` (diagnostics)
  - `scripts/package/` (`smoke-test.sh`, the tarball's README), `scripts/release/notes.sh`
  - `.github/workflows/release.yml`
  - `src/Stemma.Web.Client/src/report/viewer.js`, `viewer.css` (the credit)

## 4. UX impact

- [x] **Journey(s) touched:** none inside the app. The journey before it — finding Stemma,
      installing it, opening a first model — is now one command long.
- [x] **States defined:** the release workflow's failures each say what to fix: a tag that disagrees
      with the version, a missing changelog section, an unbuilt front end at pack time.
- [x] **Interactions:** `--version` on both binaries.
- [x] **Accessibility:** n/a.

## 5. UI impact

- [x] **Components touched/added:** the report's rail gains a credit line, and its logo a link;
      a print-only line carries the credit on paper.
- [x] **Tokens:** the report's own (`--vr-faint`, `--vr-accent`).
- [x] **Both themes:** the credit uses theme tokens, so it follows the report's dark toggle.
- [x] **Layout/rail behavior:** at the foot of the rail, under the note about comments.

## 6. Technical prerequisites & dependencies

- [x] .NET 10's platform-specific tool packages (`ToolPackageRuntimeIdentifiers`). A single
      portable package would carry Playwright's Node driver for every platform and be too large.
- [x] Google Chrome on the machine for `stemma render`, as before; WebKitGTK 4.1 for the window.
- [x] Blocks Phase 0's exit criterion in the [commercialization plan](../product/commercialization.md).

## 7. Test plan

- [x] `tests/Stemma.Engine.Tests/StemmaVersionTests.cs` — the release is the version in
      `Directory.Build.props`; the build is the release plus the commit.
- [x] `tests/Stemma.Cli.Tests/VersionCommandTests.cs` — the shipped `stemma --version`.
- [x] `tests/Stemma.Cli.Tests/SiblingProgramTests.cs` — B-016.
- [x] `tests/Stemma.Desktop.Tests/DesktopOptionsTests.cs` — `--version` never starts the host.
- [x] `tests/Stemma.Web.Tests/DiagnosticsVersionTests.cs` — the endpoint and the bundle.
- [x] `src/Stemma.Web.Client/src/report/credit.test.ts` — the real viewer carries the credit.
- [x] `scripts/package/smoke-test.sh` — the tarball with `dotnet` hidden, and the tool package
      installed from its folder alone. Both run in the release workflow before anything is drafted.
- [x] By hand, 2026-10-17: the tool installed into a fresh tool path opened the window on the
      self-model, served the page and the workspace, and closed with its backend.

## 8. Definition of Done

- [x] All ACs met and demoed
- [x] States handled
- [x] `dotnet test` green · `tsc` clean · `vite build` clean · `vitest` green
- [x] Model/presentation boundary respected; no new data store
- [x] Docs updated: this record, the features index, the changelog, the README, `releasing.md`,
      `testing.md`, `tech-stack.md`, the roadmap, the commercialization plan
- [x] Reviewed against all four pillars

## 9. Notes / open questions

- **The maintainer's to do.** Push the tag; read the draft and publish it. Before the first publish
  reaches nuget.org, the `NUGET_API_KEY` secret has to exist; the first push of `Stemma` is what
  claims the id, so until then it is unclaimed. The domain, the GitHub org and the trademark search
  stay where the [commercialization plan](../product/commercialization.md) lists them.
- **A known advisory ships.** `Microsoft.CodeAnalysis.Workspaces.MSBuild` 4.14 brings
  `Microsoft.Build.Tasks.Core` 17.7.2, flagged by GHSA-h4j7-5rxr-p4wc (CVE-2025-26646, a spoofing
  issue in the `DownloadFile` build task). Stemma never runs that task: it edits project files
  in-process and evaluates projects through Roslyn's out-of-process build host, which uses the
  installed SDK's MSBuild. Pinning a patched MSBuild was tried and is not a fix: MSBuildLocator
  refuses direct MSBuild references that ship their assemblies, and every patched line pulls
  `System.Security.Cryptography.Xml` 9.0.0, which carries advisories of its own. The way out is
  `ExcludeAssets="runtime"` with MSBuild loaded from the SDK, which changes how the model-only path
  behaves without one, so it is a change of its own with its own tests, not part of a release.
- **Telemetry and an update check are not in this release.** Both are network calls, and
  [ADR-0020](../architecture/decisions/0020-diagnostics-contract.md) says a network sink comes back
  through an ADR; and there is nowhere to send them yet. Until there is, release downloads and
  nuget.org install counts are the usage signal, and they cost nothing.
