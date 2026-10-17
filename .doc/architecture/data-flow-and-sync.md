# Data Flow & Synchronization

This describes how an edit travels from a canvas gesture to the source files and back to every
client — and the strict line between **model** state (code) and **presentation** state (sidecar).

## The write path (a UI edit)

```
canvas gesture (drag/rename/link/style/note)
   │
   ├── model change?  ──► operation (polymorphic JSON) ──► SignalR ──► Web ──► Engine
   │                                                                      │
   │                                                       DocumentEditor rewrite of Architecture.cs
   │                                                                      │
   │                                                       recompute model ► delta ► all clients
   │
   └── presentation change?  ──► lib/layout.ts sidecar cache (in-memory)
                                      └── debounced PATCH /api/workspace/layout ──► stemma.layout.json
                                          (what changed, applied to the file as it is)
```

The decisive question for any edit is **"does this change the model or only its presentation?"**

| Model (→ code, via operations) | Presentation (→ `stemma.layout.json`, via the sidecar) |
|---|---|
| Add/rename/remove elements, links | Node positions, per-view layout mode |
| Re-parent a module (contextId) | Node styles (fill, border, shadow, animation) |
| Change a dependency kind / flow payload | Edge styles (color, routing, markers, waypoints, dock handles) |
| Tags (lifecycle, ownership) | Element notes (markdown), custom props |
| View membership | Free-form shapes & annotations |

If you ever find yourself wanting to store model data in the sidecar, or presentation data in the
code, stop — the boundary is wrong.

## Operations (the model edit primitive)

Operations are a closed, polymorphic set (`Stemma.Engine/Operations/Operations.cs`). The full list —
what each one edits exactly, and what it refuses — is the
[operations catalog](./engine-backend.md#the-operations-catalog). Each:

- is serialized as JSON with a `kind` discriminator and an `opId`;
- maps to a single targeted Roslyn rewrite preserving trivia;
- returns either a success (with a delta) or a structured failure reason.

Saving a view is not an operation but goes the same way: `PUT /api/workspace/views` asks the engine,
which edits the view's file in place rather than writing it from a template.

To add one, follow the procedure in [`engine-backend.md`](./engine-backend.md#adding-or-changing-an-operation-the-procedure).

## The presentation sidecar (`stemma.layout.json`)

A committed JSON file with top-level sections: `views` (per-view `nodes` positions, `edges`
waypoints/handles, `shapes`), `nodeStyles`, `edgeStyles`, `notes`, `customProps`, `annotations`.
Frontend rules that keep it correct:

1. **Fetch once per workspace** (`primeLayoutSidecar`, `primedRoot` guard); the in-memory cache is
   then authoritative and debounce-flushed.
2. **Never re-read over unsent edits.** Re-reading on every refresh overwrote not-yet-flushed local
   edits — the root cause of the "drag snaps back / routing reverts / canvas blinks" bugs. The file
   is read again only when the engine says someone else changed it (`SidecarChanged`), and this
   session's unsent edits are laid over what it now says (`rereadLayoutSidecar`). Not reading it
   at all meant the next edit wrote the stale copy over a pull
   ([B-014](../bugs/B-014-the-sidecar-is-written-whole-from-a-stale-copy.md)).
3. **One shared cache** routes node styles, edge styles, notes, custom props, and shapes — they must
   not keep separate caches that clobber each other on save.
4. **Write nothing before it has been read.** Until then there is nothing to measure the edits
   against. Edits made while it loads are held back and sent once it has been read.
5. **The browser's copy is a cache, never a source.** `localStorage` keeps what was drawn last, so
   the canvas has something to show before the sidecar arrives. Once it has, the sidecar *replaces*
   that copy; it is not merged with it, because an entry only the browser has is one the repository
   no longer has ([B-012](../bugs/B-012-the-browser-outranks-the-repository.md)). The one exception
   is the migration of layout modes from before they were committed, which runs once per workspace.
6. **Write what changed, never the file** ([ADR-0021](./decisions/0021-sidecar-written-as-changes.md)).
   The client sends the difference between the copy it last read or wrote and its current one, down
   to the smallest value; the engine applies it to the file's text as it is on disk now, so every
   other byte — order, unknown keys, escaping, number spelling, a hand-formatted line — stays, and
   whatever anyone else changed since stays with it. A file that does not parse is refused, never
   read as empty and written back.

## The read path & live sync

- On open: REST returns the model snapshot + the engine primes the sidecar; the client hydrates
  presentation once (`stemma:sidecar-primed` → `rehydratePresentation`).
- Views are read from `Views/*.cs` on open and on every refresh, and the browser's list is a cache
  of that. A save or delete still on its way is laid over it until the engine answers, so a refresh
  in between does not take the change away.
- During a session: model edits broadcast as **deltas** over SignalR; the client merges them.
  External file edits (git pull, IDE) are picked up by the engine and broadcast too — once per change,
  and without the engine writing the file in reply. Files added and deleted outside are taken in the
  same way, and so is every file a pull touches, not only the last
  ([B-015](../bugs/B-015-outside-changes-to-the-set-of-files-are-missed.md)). An edit computed from a version of a file the
  engine has not yet seen is refused as `ChangedOnDisk` rather than written over it.
- The client merges deltas **without clobbering in-flight local edits** — the same discipline as the
  sidecar cache.

## Why no database

Persistence is Git. While a workspace is open the model lives in memory; on save it is the files.
This is a hard architectural boundary (see [`../product/vision.md`](../product/vision.md) non-goals
and [`engine-backend.md`](./engine-backend.md) rule 6). Sessions, history, branching, and conflict
resolution are Git's job, not a bespoke store's.
