# Feature: Copy, paste, duplicate — and copy a look from one box to another

| Field | Value |
|---|---|
| **ID** | F-015 |
| **Status** | `Shipped` |
| **Owner** | Bartosz |
| **Persona served** | Solution Architect ("Aria"), Data Architect ("Devin") |
| **Roadmap horizon** | `Next` (Inspector & editor polish) |
| **Created / Updated** | 2026-10-21 / 2026-10-21 |

## 1. Product — why

- **Problem:** the only thing the canvas can copy is an element's id. Drawing three containers that
  look alike means adding one, styling it, then adding and styling the next two from scratch; a
  bounded context with its modules has to be rebuilt box by box to try a variant. The look of a box
  can be applied only by repeating every click in the Appearance panel. And one ⌘Z undoes one
  operation, so anything made of several steps takes several presses, while a box moved before it
  was undone first whatever the order.
- **Why now:** these are the gestures every drawing tool has. Their absence is felt in the first
  ten minutes, long before the architecture is.
- **Value:** the canvas behaves like the tools the architect already knows (Keynote, Figma,
  draw.io), so the model gets built at the speed of thought; *undo* means "the last thing I did".
- **Out of scope:** *Cut*. A cut-and-paste looks like a move but makes new ids, and every view,
  book page and `aboutId` that named the old ones would be left pointing at nothing. Moving is
  dragging; *Move to Bounded Context…* re-parents. Pasting between two Stemma windows (the clipboard
  is the window's own; the system clipboard gets the names as text).

## 2. User story & acceptance criteria

> As an **architect**, I want to **copy, paste and duplicate boxes and their looks** so that **I
> build and restyle a model as fast as I would sketch it**.

- [x] AC1 — **⌘C** copies the selected element(s) — the canvas selection, or the one selected element —
      with everything about them: kind, the attributes their kind has, lifecycle and ownership, the
      relationships *between* them, and their presentation (style, notes, custom properties, where
      they sit relative to each other). The names go to the system clipboard as text, one per line.
      Text selected on the page is copied as text instead, as everywhere else.
- [x] AC2 — **⌘V** pastes a copy into the model as it is now: each element named "*Name* copy"
      ("*Name* copy 2" when that is taken), arranged as they were — cascading 32 px from the originals
      while they are on screen (each further paste a step further), otherwise in the middle of what is
      on screen. Right-click → **Paste here** puts the copy's corner where the menu was opened; the
      pointer alone never decides, because a pointer parked somewhere is not a choice. A copied
      context's modules go into the copied context; a module pasted inside a bounded context's box goes
      into that context, and one pasted outside every box is top level — the same rule as dropping a
      new one. References to elements that were not copied are kept when those still exist (a risk
      keeps pointing at what it was about), and dropped when they do not (pasting into another model).
- [x] AC3 — **⌘D** duplicates the selection in place, 32 px down and right, without touching the
      clipboard.
- [x] AC4 — After a paste or duplicate, the copies are selected (several at once when there are
      several), so the next gesture — drag, ⌘D again, Delete — applies to them. On a view from
      `Views/` the copies join the view; on a built-in lens that does not draw a kind, the toast says
      where it went.
- [x] AC5 — **⌥⌘C / ⌥⌘V** copy and paste a *look*: an element's style (fill, border, shadow, text,
      accent, animation, which fields show — not its size) onto every selected element, or a
      relationship's style (line, routing, ends, colour, animation, label size) onto the selected
      relationship. Also in the context menus and at the top of the Appearance panel, disabled — not
      hidden — until a look of that sort has been copied.
- [x] AC6 — **One ⌘Z undoes the last thing done, whatever it was:** a paste of five boxes and two
      relationships is one step, a move is one step, a pasted look is one step, and they are undone in
      the order they were done. A change of appearance — a colour, a preset, a resize — is undoable for
      the first time. Each undo and redo names what it undid.
- [x] AC7 — The right-click menus carry *Copy*, *Duplicate*, *Copy style*, *Paste style* on an element,
      *Copy style* / *Paste style* on a relationship, and *Paste here* on the empty canvas, each with
      its shortcut; the shortcut sheet (?) lists them.

## 3. Architecture impact

- [x] **Model or presentation?** Both, each on its own side: the copies are ordinary operations
      (`AddElement`, `AddLink`, `SetLifecycle`, `SetOwnership`, `SetElementAttribute`); their looks,
      notes, custom properties and positions are sidecar entries under the new ids.
- [x] **New/changed operations:** none. `AddElement` and `AddLink` now *say* the id they made — an
      `ElementAdded` / `LinkAdded` delta in the result — instead of leaving the client to find it by
      diffing the model it reads back. No source rewrite changes, so the fidelity suite is untouched.
- [x] **Fidelity:** unaffected; nothing new is written to `Architecture.cs` that an existing operation
      did not already write.
- [x] **Engine purity:** the deltas are plain records in `Operations.cs`.
- [x] **Sidecar:** no new section; the copies' entries are the ones an element already has.
- [x] **ADR needed?** No — no new store, operation or boundary. The undo journal is client state
      (`lib/history.ts`) in front of the engine's stack and the layout stack, the same split as before.
- **Affected files/areas:** `Stemma.Engine/Operations/Operations.cs`, `StemmaEngine.cs` (deltas),
  `Stemma.Web/Hubs/WorkspaceHub.cs` (undo depth), `lib/clipboard.ts`, `lib/history.ts`,
  `lib/signalr.ts`, `lib/store.ts`, `lib/shortcuts.ts`, `App.tsx`, `ArchCanvas.tsx`,
  `ArchInspector.tsx`, `ShortcutHelp.tsx`.

## 4. UX impact

- [x] **Journey(s) touched:** J2 (edit the model) gains copy/paste/duplicate; J3 (arrange) and J4
      (style) gain copy-a-look and undo of appearance.
- [x] **States:** *empty clipboard* — Paste items disabled with the reason in the tooltip; *error* — an
      operation refused part-way stops the paste, says which element and why, and leaves what landed
      selected so it can be undone in one step; *optimistic* — positions are written under the new ids
      before the model is read back, so a copy appears where it is going to stay instead of jumping.
- [x] **Interactions:** ⌘C, ⌘V, ⌘D, ⌥⌘C, ⌥⌘V (Ctrl on Linux and Windows); none of them fire while
      typing in a field. Undo/redo toasts name the step ("Undid Paste 3 elements").
- [x] **Accessibility:** every gesture has a keyboard path and a menu path; nothing is mouse-only.

## 5. UI impact

- [x] **Components touched:** context menus, Appearance panel header (two small text buttons),
      shortcut sheet. No new surface.
- [x] **Tokens:** existing.
- [x] **Both themes:** checked.

## 6. Technical prerequisites & dependencies

- [x] The `UndoState` the hub returns carries the engine stack's depth, so a grouped undo can tell
      whether anyone else has edited since and fall back to one step if so.

## 7. Test plan

- [x] Engine: `AddElement` / `AddLink` return the id the model then holds (`ArchModelTests`).
- [x] Client unit: the copy payload and the paste plan — names, internal links only, remapped
      context/system/about, references dropped when missing, relative positions, cascade
      (`clipboard.test.ts`); the journal — chronological order across kinds, grouping, coalesced
      style edits, depth mismatch falling back to one step, redo dropped by a new step
      (`history.test.ts`); shortcut matching with ⌥ (`shortcuts.test.ts`).
- [x] Journey: copy two linked boxes, paste, the file gains exactly the two declarations, the link and
      nothing else; one ⌘Z puts back every byte (`tests/journey/copy-paste.spec.ts`).

## 8. Definition of Done

- [x] All ACs met and demoed
- [x] States handled; accessibility bar met
- [x] `dotnet test` green · `tsc` clean · `vite build` clean · `vitest` green · journeys green
- [x] Model/presentation boundary respected; no new data store
- [x] Docs updated: this record, the features index, `ux/user-journeys.md` (J2), `ui/components.md`,
      `architecture/data-flow-and-sync.md` (the new deltas)

## 9. Notes / open questions

- **Found on the way:** an open context menu let its keys through to the canvas — Escape closed the
  menu *and* cleared the selection behind it, and the arrows moving through the menu also nudged the
  selected box (writing the sidecar). The menu now takes every key until it closes.

- Option-drag to duplicate (Keynote, Figma) would want React Flow's drag to start on a copy; left
  for later, since ⌘D then drag does the same in one more key.
