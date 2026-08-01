# Value Proposition & Differentiation

## The one-liner

**Stemma is a web-based architecture modeling tool where the C# source on disk is the model
database; UI edits are translated into Roslyn rewrites of real `.cs` files.** The diagram cannot
drift from the code because the diagram *is* the code.

## Core value propositions

1. **Zero drift.** No export, no sync job, no "is this current?" The canvas is a live projection of
   source files; editing the canvas edits the files.
2. **Trustworthy edits.** Round-trip fidelity guarantees a UI change produces a diff containing only
   the intended change — so architects and engineers can share one artifact without fear.
3. **Git-native lifecycle.** Branches, PRs, tags, blame, merge — a model's whole history and every
   decision are auditable with the tools teams already use.
4. **Richer than a class diagram.** Capabilities, data flows, dependencies, decisions, risks,
   questions, assumptions, ownership and lifecycle are first-class — so the model captures *intent*,
   not just structure.
5. **One model, many audiences.** Architects own the canonical model; product, security, and
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

The defensible wedge is the **intersection**: a *redesignable* diagram (unlike reverse-engineering
tools) that is *the actual code* (unlike draw.io/Structurizr) with a *fidelity guarantee* (unique).

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
