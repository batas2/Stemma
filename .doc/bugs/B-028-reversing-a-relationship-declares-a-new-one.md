# Bug: Reversing or reconnecting a relationship deletes it and declares a new one

| Field | Value |
|---|---|
| **ID** | B-028 |
| **Status** | Fixed |
| **Severity** | S2 major |
| **Area** | `engine` · `canvas` |
| **Reported by / Date** | Bartosz / 2026-11-07 |
| **Affected version / commit** | `35b86f2` |

## 1. Summary

There was no operation that moves a relationship's end, so *Reverse direction* and dragging an end to
another box removed the link and added a new one. The relationship came back under a new id, as a new
declaration at the end of `Build()`, and lost whatever the new declaration did not carry: a data
flow's technology, the comments on it, the book steps that play it, and its place in the file. The
diff of a one-word change was a deleted line and an added one somewhere else.

## 2. Steps to reproduce

1. A model with `var flowOrders = new DataFlow("flow_orders", "mod_checkout", "mod_invoicing", "Order", Technology: "AMQP");`
   in the middle of `Build()`, a comment on the arrow, and a book page whose steps play `flow_orders`.
2. Right-click the arrow → *Reverse direction*.

- **Expected:** `git diff` shows the two ends swapped on that line, and nothing else.
- **Actual:** the line is gone; `var flow001 = new DataFlow("flow_001", "mod_invoicing", "mod_checkout", "Order");`
  appears before `return`, without `AMQP`; `flowOrders` is replaced in `Model.Of(...)`; the comment
  names `flow_orders`, which no longer exists; the book step is reported by `stemma validate` as a
  dangling link.
- **Frequency:** always — every reverse and every reconnect to another box.

## 3. Triage

- [x] **Severity & priority agreed** — S2: an edit the user did not ask for, and data lost with it.
- [x] **Reproduced.**
- [x] **Regression?** No; it has been so since reconnecting was added.
- [x] **Pillar(s) affected:** Product, Architecture.

## 4. UX / UI impact

- [x] **User-visible symptom:** a noisy diff; a comment that no longer shows on its arrow; a book step
  marked broken; the technology label gone from the arrow.
- [x] **Severity to trust:** high — it breaks the promise that the diff is the edit.

## 5. Root cause

`src/Stemma.Web.Client/src/lib/relink.ts` documented it: "There is no operation that moves an end, so
it is the link removed and added again." It copied the kind, label, payload, direction, dependency
kind, status, owner and look onto the new link, but not `technology` (added to `DataFlow` by
[ADR-0027](../architecture/decisions/0027-description-and-technology.md) after `relink` was written),
and nothing it did could keep the id, which is what comments, book steps, a view's `ElementIds` and
the sidecar's edge entries name.

## 6. Fix

- **Approach:** a model operation, `SetLinkEnds`, that replaces the `fromId` and `toId` literals of
  the declaration in place — positional or named, wherever they stand — and checks both ends exist
  in the model, as `AddLink` does. Its undo is the operation with the old ends. The canvas and the
  inspector send it for *Reverse direction* and for an end dragged to another box; reversing also
  swaps the dots each end is docked to and reverses the bends, in every view, so the arrow stays
  where it was drawn and only its head moves. `SetLinkAttribute` no longer accepts `fromId` or `toId`,
  which it used to write without checking that the new end exists.
- **Affected files:** `src/Stemma.Engine/ArchModel/ArchOperations.cs`, `ArchModel/DslWriter.cs`,
  `Workspace/StemmaEngine.cs`, `Workspace/UndoStack.cs`, `Operations/Operations.cs`;
  `src/Stemma.Web.Client/src/lib/relink.ts`, `lib/layout.ts`, `lib/signalr.ts`, `lib/types.ts`,
  `components/ArchCanvas.tsx`, `components/ArchInspector.tsx`.
- [x] Fix implemented
- [x] Inviolable rules respected
- [x] No new data store / boundary intact

## 7. Regression test (required)

- [x] A test that **fails before** the fix and **passes after**
- **Test location:** `tests/Stemma.Engine.Tests/Fidelity/FidelityCases.cs` (`SetLinkEnds.*` against the
  three fixtures), `tests/Stemma.Engine.Tests/LinkEndsTests.cs`, `src/Stemma.Web.Client/src/lib/relink.test.ts`.
- **What it asserts:** a reverse and a reconnect change only the two literals, byte for byte, and undo
  and redo restore each; the id, technology and tag survive; an end that names nothing is refused;
  the client sends one `SetLinkEnds` and swaps the docked dots and the bends.

## 8. Verification

- [x] `dotnet test` green
- [x] `vitest` green
