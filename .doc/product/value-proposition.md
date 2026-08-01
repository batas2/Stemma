# Value Proposition & Differentiation

## The one-liner

**Your architecture, written in your source. Humans and AI agents edit the same model — and every
change arrives as a reviewable diff.**

The mechanism behind it: the C# source on disk *is* the model database, and UI edits become Roslyn
rewrites of real `.cs` files. The diagram cannot drift from the code because the diagram is the
code. That mechanism is the proof, not the pitch — see [ADR-0015](../architecture/decisions/0015-project-name-and-market-positioning.md).

## Core value propositions

1. **Zero drift.** No export, no sync job, no "is this current?" The canvas is a live projection of
   source files; editing the canvas edits the files.
2. **Trustworthy edits.** Round-trip fidelity guarantees a UI change produces a diff containing only
   the intended change — so architects and engineers can share one artifact without fear.
3. **Architecture an agent can be held to.** When a large share of committed code is machine-written,
   the constraint that matters is no longer the code but the structure it must respect. The model
   lives in the repository the agent is already editing, and any structural change it makes shows up
   in the same diff a reviewer reads.
4. **Git-native lifecycle.** Branches, PRs, tags, blame, merge — a model's whole history and every
   decision are auditable with the tools teams already use.
5. **Richer than a class diagram.** Capabilities, data flows, dependencies, decisions, risks,
   questions, assumptions, ownership and lifecycle are first-class — so the model captures *intent*,
   not just structure.
6. **One model, many audiences.** Architects own the canonical model; product, security, and
   engineering each get a projected view without a parallel artifact.

## How it compares

| | Stemma | draw.io / Lucidchart | Structurizr | Reverse-eng (NDepend, …) |
|---|---|---|---|---|
| Source of truth | **The code** | A separate file | A separate DSL | The code (read-only) |
| Edit the picture → code follows | **Yes** | No | DSL is the picture, not the code | **No** |
| Drift | **Impossible** | High | Medium (DSL ≠ code) | None, but read-only |
| Git-native diffs/PRs | **Yes** | Binary-ish | Yes (DSL) | N/A |
| Beyond structure (decisions, risk, ownership) | **First-class** | Manual | Limited | No |
| Round-trip fidelity contract | **Yes** | N/A | N/A | N/A |
| Lives where a coding agent works | **In the repo it already edits** | Outside the repo | A DSL beside the code | Read-only analysis |

The defensible wedge is the **intersection**: a *redesignable* diagram (unlike reverse-engineering
tools) that is *the actual code* (unlike draw.io/Structurizr) with a *fidelity guarantee* (unique).
The 2026 version of that wedge is sharper still: everyone else asks a human to keep a second
artifact honest. There is no second artifact here, so an agent editing the repository is editing the
architecture, and the reviewer sees it in the diff either way.

## What we are deliberately NOT competing on

- Pixel-perfect general diagramming (draw.io wins; we adopt the useful subset — shapes, styling,
  free-form annotations — see [`../ui/components.md`](../ui/components.md)).
- Live runtime topology / tracing (observability tools win).
- Full in-browser coding (IDEs win).

## Proof points to protect

- A realistic `Architecture.cs` edited via the UI yields a clean, intent-only diff.
- A real architecture review is run on Stemma and the team keeps using it.
- A sample workspace (see [`../../samples/`](../../samples/)) opens, renders three perspective views,
  and round-trips edits with no fidelity loss.
