# Feature: The presenter view — your notes and the next page on your screen, the picture on theirs

| Field | Value |
|---|---|
| **ID** | F-019 |
| **Status** | `Shipped` |
| **Owner** | Bartosz |
| **Persona served** | Solution Architect ("Aria") presenting to the team that will build it |
| **Roadmap horizon** | `Next` (deferred from [F-013](./F-013-books.md)) |
| **Created / Updated** | 2026-10-21 / 2026-10-21 |

## 1. Product — why

- **Problem:** presenting a book puts the narrative over the picture on the one screen there is. With
  a projector, the room reads the presenter's notes while the presenter talks, the notes take space
  from the diagram, and the presenter cannot see what comes next or how long they have been talking.
  Every presentation tool people already use (Keynote, PowerPoint) splits the two.
- **Why now:** books (F-013) shipped with the presenter view deferred; this is the one thing missing
  to use them in a real meeting room.
- **Value:** the room sees only the architecture; the presenter sees what to say, what comes next,
  the time, and can steer from either screen.
- **Out of scope:** a thumbnail of the next page (the next page's title, view and first lines stand
  in); speaker notes separate from the narrative; remote control from a phone.

## 2. User story & acceptance criteria

> As an **architect presenting**, I want **my notes, the next page and a timer on my screen while the
> room sees only the diagram**, so that **I can talk to the picture instead of reading it out**.

- [x] AC1 — While presenting, **P** (or the ⧉ button among the controls) opens the presenter view in a
      window of its own; the book editor's **With notes** opens it and starts presenting in one click.
      In the desktop app the presenter view opens in the system browser.
- [x] AC2 — The presenter view shows the book and audience, the page **now** — title, the view it
      shows, what it points at, a problem if it has one, the narrative in large type — the page
      **next**, every page as a list to jump to, the **elapsed time** (pause, reset) and the **time of
      day**, and a progress bar.
- [x] AC3 — **Either window steers**: Next / Previous / a page from the list / Blank / End on the
      console, and the same keys and clicker as presenting (arrows, Space, PageUp/Down, Home/End, B,
      Esc) in either window.
- [x] AC4 — Once a presenter view is open, the narrative card leaves the projector; N brings it back.
- [x] AC5 — Ending the presentation, from either window, tells the console, which says so; a console
      left open from an earlier presentation never steers a new one.
- [x] AC6 — The console holds no model and mounts none of the editor: no shortcut in it can edit
      anything. Nothing is written.

## 3. Architecture impact

- [x] **Model or presentation?** Neither: the presenting window's position in a book, relayed.
- [x] **Transport:** two hub methods, `PresenterState` and `PresenterCommand`, passed to every other
      connected window and kept nowhere. A relay rather than a window-to-window channel, because the
      desktop shell's window and the system browser share no browser storage or channel; through the
      server they need nothing in common but the address. Each presentation has a session id.
- [x] **Desktop shell:** a second request, `openInBrowser`, which opens only the backend's own
      loopback address (`ShellBridge.IsOwnPage`) — the page cannot use the shell to open anything else.
- [x] **ADR needed?** No: no store, no boundary moves; the relay is transient and stateless.
- **Affected files/areas:** `Stemma.Web/Hubs/WorkspaceHub.cs`, `Stemma.Desktop/ShellBridge.cs` and
  `Program.cs`, `lib/presenterLink.ts`, `lib/signalr.ts`, `lib/shell.ts`, `lib/presenterKeys.ts`,
  `components/PresenterConsole.tsx` (new), `BookPresenter.tsx`, `BookFooter.tsx`, `main.tsx`.

## 4. UX impact

- [x] **Journey(s) touched:** J6c (present a book), step 3.
- [x] **States:** *waiting* — the console says it is waiting for a presentation and what to do;
      *ended* — it says so and offers to close; *popup blocked* — a toast says how to allow it, and the
      presentation goes on without it. Opening a window takes a browser out of full screen; that is
      not taken as stopping, and the toast says to press F on the projector.
- [x] **Accessibility:** the console is landmarks (*Now*, *Next*, *Pages*), large type, buttons with
      names; the timer is not a live region (it would talk every second).

## 5. UI impact

- [x] **Components:** `PresenterConsole` (new, dark by design — a lit laptop in a dim room is a lamp),
      a ⧉ button in the presenting controls, *With notes* in the book editor.

## 7. Test plan

- [x] Unit: the protocol — session matching, message shapes, the console's address, elapsed time
      (`presenterLink.test.ts`); P is the console's key (`presenterKeys.test.ts`).
- [x] Desktop: `openInBrowser` opens the app's own page and refuses any other address, scheme, port,
      host or user info (`ShellBridgeTests`).
- [x] Journey: present, P, the console follows, Next / ← / a page from the list turn the projector,
      End ends both (`tests/journey/presenter-view.spec.ts`).

## 8. Definition of Done

- [x] All ACs met and demoed
- [x] `dotnet test` green · `tsc` clean · `vite build` clean · `vitest` green · journeys green
- [x] Docs updated: this record, F-013 (no longer deferred), the features index, `ux/user-journeys.md`,
      `ui/components.md`
