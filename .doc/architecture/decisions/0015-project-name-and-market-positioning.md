# ADR-0015: Project name (Stemma) and market positioning

| Field | Value |
|---|---|
| **Status** | `Accepted` |
| **Date** | 2026-08-01 |
| **Deciders** | Bartosz |

## Context

The project shipped under the name **Verso** (from bookbinding: the reverse side of a leaf). Two
problems surfaced while preparing [Phase 0 of the commercialization
plan](../../product/commercialization.md), and both blocked the landing page.

**The name was not ownable.** "Verso" is in active use by a funded German B2B ESG SaaS
(verso.de) — same continent, same buyer type as ours — by a well-known publisher (Verso Books),
by the former NYSE-listed Verso Corporation, and, worst for us, by an NLnet-funded Servo-based
browser (`versotile-org/verso`) that owns the name on GitHub and Hacker News, which is precisely
where a launch would land. Every usable domain (`verso.dev`, `verso.app`) was parked with a
broker at premium prices. Renaming after launch costs roughly ten times what it costs now.

**The positioning had aged.** The pitch was "diagrams drift from code." That was the pitch in
2019, and Structurizr, IcePanel and Ilograph already answer it. The market's vocabulary moved in
2025–26: with a large share of committed code now AI-assisted and a meaningful fraction merged
without manual review, the named problem is *architectural drift in generated code* — code that
compiles but violates boundaries. The tool category split into "what you designed" (diagramming)
and "what you actually built" (architecture intelligence). Stemma is neither: design state and
built state are the **same artifact**, writable from both ends. Leading with the old framing sells
the weaker half of the product to a shrinking audience.

Doing nothing means launching on an unownable name into a crowded, dated category.

## Decision

We will rename the project to **Stemma**, and reframe the positioning around a single editable
architecture contract shared by humans and AI agents.

A *stemma codicum* is the family tree in manuscript scholarship showing how every surviving copy
of a text descends from one archetype. The name is literally a diagram, of lineage, derived from a
canonical original — which is what this tool draws. It keeps the codicological register of the old
name while being ownable: `stemma.dev`, `stemma.io` and `stemma.app` are unregistered, the NuGet id
`Stemma` is free, and the GitHub org `stemmahq` is available. The only prior software use, a
data-catalog startup, was absorbed into Teradata in 2023 and no longer trades.

The positioning one-liner becomes: **your architecture, written in your source; humans and AI
agents edit the same model, and every change arrives as a reviewable diff.** The mechanism
(Roslyn rewrites of real `.cs` files) stays exactly as it is — it moves from being the pitch to
being the proof.

## Consequences

- **Positive:** the name is defensible and available across every asset that matters for
  distribution (`dotnet tool` id, org, domain). The reframing widens the buyer from "architects who
  like C4" to engineering leads with AI-authored codebases, and promotes the GitHub App
  (commercialization Phase 3) from a growth idea to the centre of the story.
- **Negative / trade-offs:** a full rename touched 336 files — namespaces, the solution, env vars
  (`VERSO_*` → `STEMMA_*`), the config directory, and the sidecar filenames
  (`verso.layout.json` → `stemma.layout.json`, plus the discovered/metrics/comments caches). Any
  workspace created before the rename must have its sidecars renamed by hand; no migration shim is
  provided, which is acceptable only because there are no external users yet. A trademark search
  (EUIPO/USPTO class 9/42) is still outstanding and could in principle force another change.
- **Neutral:** the AI-era framing raises the priority of model-diff quality, since "every change
  arrives as a reviewable diff" is a promise the diff has to keep.

## Alternatives considered

- **Keep Verso.** Zero work, but launches onto a name owned by a live EU B2B software vendor and a
  GitHub-native project, with no clean domain. The collision gets more expensive with every user.
- **Recto** (the facing page; Latin *rectus*, "straight, true"). Semantically clean and the cheapest
  possible rebrand — same aesthetic family, so all existing copy still reads. Rejected because every
  short TLD was broker-held and the asset sweep was materially worse than Stemma's.
- **Trueprint** ("the blueprint that is true"). Explains itself with no gloss and both TLDs were
  free, but a descriptive name is a weak mark, and "print" implies a document rather than a live
  model.
- **Ashlar / Plumb / Tenon / Truss** (masonry and joinery metaphors). All rejected on collision;
  `plumb` in particular is an existing tool for keeping specs and code in sync under AI-assisted
  development — the nearest neighbour imaginable.

## Relationship to the inviolable rules

None are touched. The rename is mechanical: no change to round-trip fidelity, engine purity, or the
model-versus-presentation boundary. The sidecar filenames changed but their role did not — presentation
state stays in the committed sidecar, and no new store is introduced. The reframing implies no new
data: "humans and AI agents edit the same model" means both go through the existing operations against
`Architecture.cs`, and the LLM path stays in `Stemma.Web` per [ADR-0008](./README.md).

## References

- [`../../product/commercialization.md`](../../product/commercialization.md) §4 Phase 0.1 — the naming task this closes.
- [`../../product/value-proposition.md`](../../product/value-proposition.md) — the one-liner this ADR rewrites.
- `README.md` — the etymology note.
- Rename commit: `chore: rename the project from Verso to Stemma`.
