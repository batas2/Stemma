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
                                      └── debounced PUT /api/workspace/layout ──► stemma.layout.json
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

Operations are a closed, polymorphic set (`Stemma.Engine/Operations/Operations.cs`) — e.g.
`AddElement`, `RenameElement`, `RemoveElement`, `SetElementContext`, `SetElementAttribute`,
`AddLink`, `RemoveLink`, `SetLinkAttribute`, `SetLifecycle`, `SetOwnership`. Each:

- is serialized as JSON with a `kind` discriminator and an `opId`;
- maps to a single targeted Roslyn rewrite preserving trivia;
- returns either a success (with a delta) or a structured failure reason.

To add one, follow the procedure in [`engine-backend.md`](./engine-backend.md#adding-or-changing-an-operation-the-procedure).

## The presentation sidecar (`stemma.layout.json`)

A committed JSON file with top-level sections: `views` (per-view `nodes` positions, `edges`
waypoints/handles, `shapes`), `nodeStyles`, `edgeStyles`, `notes`, `customProps`, `annotations`.
Frontend rules that keep it correct:

1. **Fetch once per workspace** (`primeLayoutSidecar`, `primedRoot` guard); the in-memory cache is
   then authoritative and debounce-flushed.
2. **Never re-fetch mid-session** — re-fetching overwrites not-yet-flushed local edits. This was the
   root cause of the "drag snaps back / routing reverts / canvas blinks" bugs.
3. **One shared cache** routes node styles, edge styles, notes, custom props, and shapes — they must
   not keep separate caches that clobber each other on save.

## The read path & live sync

- On open: REST returns the model snapshot + the engine primes the sidecar; the client hydrates
  presentation once (`stemma:sidecar-primed` → `rehydratePresentation`).
- During a session: model edits broadcast as **deltas** over SignalR; the client merges them.
  External file edits (git pull, IDE) are picked up by the engine and broadcast too.
- The client merges deltas **without clobbering in-flight local edits** — the same discipline as the
  sidecar cache.

## Why no database

Persistence is Git. While a workspace is open the model lives in memory; on save it is the files.
This is a hard architectural boundary (see [`../product/vision.md`](../product/vision.md) non-goals
and [`engine-backend.md`](./engine-backend.md) rule 6). Sessions, history, branching, and conflict
resolution are Git's job, not a bespoke store's.
