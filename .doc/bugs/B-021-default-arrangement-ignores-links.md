# Bug: A view nobody arranged is drawn in one long row

| Field | Value |
|---|---|
| **ID** | B-021 |
| **Status** | Fixed |
| **Severity** | S2 major |
| **Area** | `layout` |
| **Reported by / Date** | Audit for the Architect's Agent ([`agent-architecture-workflow.md`](../product/agent-architecture-workflow.md) §1, A2) / 2026-10-22 |
| **Affected version / commit** | `7264f79` |

## 1. Summary

A view with no saved positions — every view an agent writes, and every new element in a view that has
some — is placed by a "hierarchical" default that is not given the links. It can only sort by kind,
so seventeen containers come out side by side in one row with the edges drawn through the boxes
between their ends. The first picture an agent sees of its own architecture is unreadable.

## 2. Steps to reproduce

1. Write a workspace with three people, eleven containers and seventeen data flows, and one view that
   lists them all; no `stemma.layout.json`.
2. `stemma render --workspace . --view view_containers --out out.png --profile app`.

- **Expected:** a layered arrangement that follows the flows.
- **Actual:** people in one row, every other element in a second row, 1656×159 at scale 2.
- **Frequency:** always.

## 3. Triage

- [x] **Severity & priority agreed** — S2: the default picture is wrong, silently.
- [x] **Reproduced** — two workspaces (17 and 3 elements).
- [x] **Regression?** No; it has always been this way.
- [x] **Pillar(s) affected:** Product, UX.

## 4. UX / UI impact

- [x] **User-visible symptom:** wrong render — a row instead of a layout.
- [x] **Severity to trust:** an agent judges its work by this picture.

## 5. Root cause

`ArchCanvas.tsx:167`:

```ts
function defaultPositions(elements: ArchElement[]): Record<string, SavedPosition> {
  return layoutHierarchical(elements, []);
}
```

`layoutHierarchical` assigns layers by kind and then by longest path over the links; given none, it
stops at the kind tiers. Every person lands in tier 0 and every system and container in tier 1.

## 6. Fix

- **Approach:** two parts. (1) The default is given the view's links, so where it is still used — the
  element added to a view whose others are placed — it follows the flows. (2) A view where *no*
  member has a position is laid out by the layered constraint (F-021) instead, which is what a
  picture nobody arranged should get. Nothing is written to the sidecar for either.
- **Affected files:** `src/Stemma.Web.Client/src/components/ArchCanvas.tsx`, `lib/autoLayout.ts`.
- [x] Fix implemented
- [x] Inviolable rules respected
- [x] No new data store / boundary intact

## 7. Regression test (required)

- [x] A test that **fails before** the fix and **passes after**
- **Test location:** `src/Stemma.Web.Client/src/lib/autoLayout.test.ts`
- **What it asserts:** the default arrangement of a chain a → b → c over three containers puts them in
  three different layers, not one.

## 8. Verification

- [x] `dotnet test` green · `tsc` clean · `vite build` clean · `vitest` green
- [x] The audit workspace re-rendered and looked at.
