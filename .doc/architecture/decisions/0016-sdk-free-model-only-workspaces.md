# ADR-0016: SDK-free load path for model-only workspaces

| Field | Value |
|---|---|
| **Status** | `Accepted` |
| **Date** | 2026-08-01 |
| **Deciders** | Bartosz |

## Context

`WorkspaceLoader` has one way to open a workspace: `MSBuildLocator.RegisterDefaults()` followed by
`MSBuildWorkspace.OpenSolutionAsync`/`OpenProjectAsync`. That requires a `.sln` or `.csproj` **and an
installed .NET SDK**. For a repository — the case Stemma was built for — that is exactly right: the
project system knows the real compilation, references, analyzers and target framework.

For a model started from scratch it is all cost and no benefit, and it produces three failures we
can demonstrate ([F-003](../../features/F-003-from-scratch-onboarding.md)):

- The scaffold emits `<PackageReference Include="Stemma.Model" Version="0.1.0" />` when it cannot
  find the local model project. That package is not published, so restore fails and a freshly
  created workspace **cannot be opened at all** off a packaged build. In development the scaffold
  substitutes a `ProjectReference`, which is why this never showed up locally.
- Even with the reference fixed, the user needs a full .NET SDK installed before they can draw a
  box — an absurd prerequisite for an architect evaluating a diagramming tool, and a blocker for
  shipping a desktop bundle ([F-002](../../features/F-002-desktop-shell.md)).
- Loading the scaffold through MSBuild runs a design-time build, which writes `obj/` into the user's
  brand-new model folder before they have typed anything.

A model-only workspace — one whose C# consists of `Architecture/*.cs` and `Views/*.cs` referencing
nothing but `Stemma.Model` — needs none of that. The engine never asks the project system anything
it could not answer itself: it reads syntax trees and rewrites them with `DocumentEditor`. The only
semantic dependency is `Renamer.RenameSymbolAsync` (`StemmaEngine.cs:369,442`), which needs a
`Compilation`, and a compilation needs metadata references — but those can come from the assemblies
the Stemma process is *already running on*, plus the `Stemma.Model` assembly we ship. No SDK, no
restore, no NuGet.

## Decision

We will add a second load path for model-only workspaces, selected automatically, and keep the
MSBuild path unchanged for real repositories.

Selection, in order:

1. A `.sln` exists → **MSBuild**. This is a repository; nothing changes.
2. A `.csproj` exists **and** an SDK is discoverable (`MSBuildLocator.QueryVisualStudioInstances()`
   is non-empty) → **MSBuild**. Existing behaviour, byte for byte.
3. Otherwise, `Architecture/` contains at least one `.cs` file → **model-only**.
4. Otherwise → fail with a message naming what was looked for.

The model-only path builds an `AdhocWorkspace` containing one project, whose documents are the `.cs`
files under the workspace root (excluding `obj/`, `bin/`, and dotfiles), with metadata references
taken from the host's trusted-platform assemblies and `Stemma.Model`. Because `AdhocWorkspace` keeps
changes in memory and never touches disk, the workspace subclass overrides `ApplyDocumentTextChanged`
and `ApplyDocumentAdded` to write the file itself — preserving the original `SourceText` encoding and
byte-order mark, since anything else would be a fidelity violation by another name.

`StemmaEngine` holds the base `Microsoft.CodeAnalysis.Workspace` type instead of `MSBuildWorkspace`.
It only ever used `CurrentSolution`, `TryApplyChanges` and `Dispose`, all of which are declared there.

The scaffold for a new model stops writing a `.csproj` altogether. A model-only workspace does not
need one, and not writing it removes the unresolvable package reference and the `obj/` pollution at
the source rather than papering over them.

## Consequences

- **Positive:** a created workspace opens on a machine with no .NET SDK, no network and no published
  package, which is what makes both the desktop bundle and the from-scratch flow viable. New model
  folders stay clean because no design-time build runs. Load is also markedly faster: no restore, no
  project evaluation.
- **Negative / trade-offs:** two load paths mean two behaviours to keep honest, and the fidelity
  suite must run against both or the second one will silently rot. The model-only path has no
  project system, so it cannot see analyzers, generated files, `Directory.Build.props`, or a real
  target framework; a workspace that quietly depends on any of those must be opened through MSBuild.
  Writing files from a workspace subclass puts disk I/O somewhere a reader may not expect it.
- **Neutral:** users who want IntelliSense over their model in an IDE can add a `.csproj` themselves,
  at which point rule 2 takes over and they are back on the MSBuild path. If `Stemma.Model` is ever
  published, the scaffold may offer a project file again — as an option, not a requirement.

## Alternatives considered

- **Publish `Stemma.Model` to NuGet and keep one path.** Fixes the broken reference but not the SDK
  requirement, the restore, or the `obj/` noise — and it makes first-run depend on the network.
- **Bundle an SDK with the desktop app.** Hundreds of megabytes to run a design-time build whose
  entire output we discard.
- **Parse files directly with `CSharpSyntaxTree.ParseText`, no workspace at all.** Simplest, but it
  gives up `Solution`/`DocumentEditor` and therefore `Renamer`; rename would have to be reimplemented
  as text substitution, which is precisely the class of shortcut that breaks fidelity.

## Relationship to the inviolable rules

Fidelity is the whole risk here and is respected: the model-only path still rewrites through
`DocumentEditor` on real syntax trees, never string concatenation, and the file writer round-trips
the original encoding and BOM. It introduces **no** new store — the `.cs` files remain the database
and the sidecar remains presentation-only. Engine purity is unaffected; the new code is Roslyn and
`System.IO` inside `Stemma.Engine`. The one rule this leans on hardest is the testing rule: the
fidelity fixtures must be executed against **both** load paths, and that is a condition of this ADR,
not a follow-up.

## References

- [F-003](../../features/F-003-from-scratch-onboarding.md) — the onboarding failures this unblocks.
- [F-002](../../features/F-002-desktop-shell.md) — packaging depends on it.
- `src/Stemma.Engine/Workspace/WorkspaceLoader.cs`, `ModelWorkspaceLoader.cs`, `StemmaEngine.cs:369`.
