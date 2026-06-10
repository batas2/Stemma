# ADR-0014: Architecture report — embedded-JSON renderer and comment-pack round-trip

| Field | Value |
|---|---|
| **Status** | `Accepted` |
| **Date** | 2026-06-10 |
| **Deciders** | Bartosz (decision gate in [F-001](../../features/F-001-architecture-report-export.md) §9) |

## Context

F-001 publishes the architecture as a single self-contained HTML file for three audiences
(builders, stakeholders, peer architects) who do not run Verso. Two structural choices needed a
record: how the diagrams are rendered inside a file that must work offline with zero dependencies
(spec Q2), and how feedback written in that file finds its way back into the workspace without any
server (spec Q3). A constraint discovered during specification: Google Drive's preview does not
execute JavaScript, so the report is *shared* via Drive but *opened* locally (Q1-A).

## Decision

1. **Render from embedded data, not snapshots (Q2-A).** The export embeds the model and the
   presentation sidecar as JSON (`<script type="application/json">`, `<` escaped) plus a
   dependency-free vanilla-JS viewer (`src/report/viewer.js`, inlined verbatim via Vite `?raw`).
   The viewer re-renders every view as SVG using the sidecar's positions, dock handles, waypoints
   and styles — which gives true layer toggling, element-level selection, search and crisp text at
   any zoom. A second Vite build target was considered and dropped: `?raw` inlining achieves the
   single-artifact goal with no build-pipeline changes.
2. **Comment pack as the feedback transport (Q3-A).** Comments written in the report are drafts in
   the reader's `localStorage`, exported on demand as `<workspace>.comments.verso.json` — the
   `CommentsSidecar` schema plus a provenance header. Verso imports a pack (Comments panel →
   import) and merges by comment id: new ids append, existing ids only gain unseen thread replies,
   and the local `resolved` flag always wins. The merge is idempotent; `comments.verso.json`
   remains the only durable home for comments.
3. **Assembly stays in the client (Q9-A, simplified).** The exporting browser re-fetches the model
   and comments from the backend at export time and reads presentation from the sidecar-backed
   caches the canvas itself renders from. The aggregate `export-bundle` endpoint sketched in the
   spec proved unnecessary — existing endpoints already serve fresh on-disk truth — so no backend
   surface was added.

## Consequences

- **Positive:** one file, zero install, works from `file://`; layers/modes/search are real
  interactions, not baked pixels; feedback lands in the model's comment sidecar instead of chat;
  reports are small (≈100 KB on the reference samples vs. a 5 MB budget).
- **Negative / trade-offs:** the viewer re-implements a slice of canvas geometry (dock points,
  bezier paths, BC boxes) — visual parity is close but not pixel-identical (no React Flow in the
  file); two rendering code paths to keep roughly in sync; comments authored in a report carry no
  authentication (author is self-declared in the pack).
- **Neutral:** reader-side state (drafts, layer choices, theme) is keyed by workspace root in
  `localStorage`, so it survives re-exports of the same workspace.

## Alternatives considered

- **Pre-rendered SVG snapshots per view (Q2-B)** — pixel-true but layers/selection would be limited
  to annotated groups, files grow with model size, text export less searchable.
- **Google-Drive-native comments (Q3-B)** — zero build cost but feedback is file-level, not
  element-anchored, and never reaches the model.
- **Backend-rendered report (Q9-B)** — enables CI publishing but adds backend surface now; can be
  layered on later (F-001 Q11-B follow-up).

## Relationship to the inviolable rules

The report is a read-only projection: no source rewrites, no engine involvement beyond existing
read APIs, no new store of truth (the pack is transport; the sidecar stays canonical). Engine
purity and the model/presentation boundary are untouched.

## References

- Feature record: [`.doc/features/F-001-architecture-report-export.md`](../../features/F-001-architecture-report-export.md)
- Generator: `src/Verso.Web.Client/src/report/` (`reportData.ts`, `template.ts`, `viewer.js`, `generateReport.ts`)
- Pack merge: `src/Verso.Web.Client/src/lib/comments.ts` (`mergeCommentPack`), import UI in `CommentsPanel.tsx`
- Related: ADR-0003 (layout sidecar), ADR-0010 (comments as a Git sidecar)
