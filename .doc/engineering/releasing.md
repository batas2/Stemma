# Releasing

How a version of Stemma is cut, and what has to be true before each step. The first release was
0.1.0 on 2026-10-17 ([F-012](../features/F-012-first-release.md)).

## What a release is

A release is a tag, `vX.Y.Z`, on a commit of `master`, with two things built from it and attached to
a GitHub release:

| Artifact | For | Needs on the machine |
|---|---|---|
| `stemma-linux-x64.tar.gz` | Anyone on Linux. Unpack and run, or `./install.sh` to put Stemma on the menu and on `PATH`. Self-contained. | WebKitGTK 4.1 for the window; Google Chrome for `stemma render`; the .NET SDK only for a workspace that is a repository |
| `Stemma.X.Y.Z.nupkg`, `Stemma.linux-x64.X.Y.Z.nupkg` | C# developers: `dotnet tool install -g Stemma`. The first is a pointer to the second, which holds everything the tarball holds except the runtime. | The .NET 10 SDK, which installing a tool needs anyway; WebKitGTK and Chrome as above |

`SHA256SUMS` covers all three. The tarball keeps the same name in every release, so
`https://github.com/batas2/Stemma/releases/latest/download/stemma-linux-x64.tar.gz` always means
the newest one.

## Versions

[Semantic Versioning](https://semver.org/). While the major version is 0, a minor version may change
anything a user relies on, and the changelog says what; a patch only fixes.

The version is written in one place: `VersionPrefix` in [`Directory.Build.props`](../../Directory.Build.props).
Every assembly is stamped with it, and everything that reports a version reads it back from there —
`stemma --version`, `stemma-desktop --version`, `/api/diagnostics`, the diagnostics bundle (which
adds the commit), the tarball's README. Never write a version anywhere else.

## Cutting a release

1. **Write the changelog section.** In [`CHANGELOG.md`](../../CHANGELOG.md), rename `## Unreleased` to
   `## X.Y.Z — YYYY-MM-DD`, give it a paragraph saying what the release is, and start a new, empty
   `## Unreleased` above it. The release's notes *are* this section: a version with none fails the
   release before anything is built.
2. **Set the version.** `VersionPrefix` in `Directory.Build.props` to `X.Y.Z`, if it is not already.
3. **Try it locally**, since CI cannot open a window:

   ```bash
   scripts/package/package-linux.sh --out dist
   dotnet pack src/Stemma.Cli -c Release -o dist/tool
   scripts/package/smoke-test.sh dist/stemma-linux-x64.tar.gz --version X.Y.Z
   scripts/package/smoke-test.sh --tool dist/tool --version X.Y.Z
   ./dist/stemma/stemma-desktop samples/StemmaArchitecture     # the one check that needs a display
   ```

4. **Commit, rehearse on CI, then tag:**

   ```bash
   git commit -am "chore(release): X.Y.Z"
   git push origin master
   gh workflow run release.yml --ref master     # everything the tag does except the release
   git tag -a vX.Y.Z -m "Stemma X.Y.Z"          # once the rehearsal is green
   git push origin vX.Y.Z
   ```

   The rehearsal builds on a clean machine, which yours is not, and attaches what it built to the
   run for a week.

   The [release workflow](../../.github/workflows/release.yml) checks the tag against
   `Directory.Build.props`, runs every test with the front end built (so the render tests render),
   packages both artifacts, runs the smoke test on each, and leaves a **draft** release. Nothing
   public has happened yet.
5. **Read the draft and publish it.** The notes, the assets, their sizes. A wrong draft is deleted,
   fixed and re-tagged at no cost; a published release is public.
6. **nuget.org follows the publish.** Publishing the draft runs the workflow's second job, which
   pushes the tool packages — platform package first, pointer second — and verifies them against
   `SHA256SUMS` before it does. A package on nuget.org can be unlisted but never deleted, which is
   why this waits for a person rather than following the tag.
7. **Record the demo**, if the release changes what it shows: `npm run demo:record` in
   `src/Stemma.Web.Client` films the app renaming a box, the `git diff` that made, and the report it
   exports, into `dist/demo/stemma-demo.mp4` and `.webm`. It is the real app on a scratch copy of
   AuroraRail and asserts the diff it shows, so it cannot claim more than the release does. It needs
   ffmpeg on `PATH`.

## nuget.org

The second job needs a `NUGET_API_KEY` repository secret: an API key scoped to push `Stemma` and
`Stemma.*`. Without it the job says it skipped the push, and the packages remain attached to the
release, installable with `dotnet tool install -g Stemma --add-source <folder>`.

The first push of `Stemma` is what claims the id; until then anyone could. The commercialization
plan lists reserving it with the domain and the GitHub org
([`../product/commercialization.md`](../product/commercialization.md), Phase 0).

## Known advisories

`dotnet build` warns NU1903 for `Microsoft.Build.Tasks.Core` 17.7.2, which Roslyn's
`Workspaces.MSBuild` brings and which ships beside the engine. Why it is not reachable, why pinning
it is not the fix, and what is: [F-012 §9](../features/F-012-first-release.md#9-notes--open-questions).
Any other NU1902/NU1903 warning is new and is looked at before a release.
