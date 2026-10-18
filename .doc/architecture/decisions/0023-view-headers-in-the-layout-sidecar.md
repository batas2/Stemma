# ADR-0023: A view's header is presentation, kept with the view in the layout sidecar

| Field | Value |
|---|---|
| **Status** | `Proposed` |
| **Date** | 2026-10-18 |
| **Deciders** | Bartosz |

## Context

A view is a named subset of the model, drawn. Shown to a room or read in a report, it needs what a
slide has around its picture: a title, the sentence it is there to make, how to read it, and what its
colours mean ([F-014](../../features/F-014-self-explaining-views.md)). Today those live in the
architect's head, or as free-form label shapes placed by hand: shapes scale with the zoom, leave the
frame as soon as a book page frames its focus, and a legend drawn by hand is wrong the day a card's
verdict changes.

Two questions need answering: where the words are kept, and where they are drawn.

## Decision

1. **The header is presentation and lives in `stemma.layout.json`, under the view's own entry:**
   `views.<key>.header`, with `title`, `message`, `context` and `legend`. Saying what a picture is
   for, and what its colours mean, asserts nothing about the system; deleting a header leaves the
   architecture exactly as true as it was. Kept under the view, it goes where the view's positions,
   routes and shapes go, and is written as changes ([ADR-0021](./0021-sidecar-written-as-changes.md)),
   so editing the message is one line in a diff.
2. **The legend is computed unless written.** Without a `legend`, the header lists the lifecycle
   statuses the view's elements carry, each with a swatch taken from how those cards are drawn, and
   the kinds of link drawn. A written `legend` replaces the computed one; an entry that names a
   `status` still takes its swatch from the view, so a restyle cannot leave the key behind.
3. **The header is drawn in screen space, over the top of the canvas, not on it.** It stays
   readable at any zoom and stays in place while a presented page moves the camera into its focus.
   The fit and the book framing leave room for it.
4. **It is part of the picture where the picture is a slide, and not where it is a figure.** The
   canvas, presenting, the PDF deck and the report show it. `stemma render` and single-image export
   do not: an image placed in a document gets its caption from the document.

## Consequences

- **Positive:** a view carries its own explanation into every place it is shown; the legend is
  correct by construction; nothing in the model or in `Views/` changes.
- **Negative / trade-offs:** the header takes height from the canvas; a rendered image does not
  carry it; the report renders it a second time, in its own renderer.
- **Neutral:** `stemma validate` gains `header/*` rules; the schema describes the member.

## Alternatives considered

- **Fields on the `View` record in `Views/*.cs`** — the words would be versioned beside the view's
  membership, but they say how the view is presented, not what is true, and rule 3 puts that in the
  sidecar; every keystroke would be a Roslyn rewrite of a source file.
- **Label shapes** — positioned ink: they scale with the zoom, leave the frame when the camera
  moves, and a legend made of them is maintained by hand.
- **A title block drawn on the canvas, above the content** — reads like a page in draw.io, but has
  the same two faults as shapes when a page frames its focus.

## Relationship to the inviolable rules

Presentation stays in the sidecar (rule 3); no source file is touched, so fidelity is not engaged;
the engine stores the member without reading it (rule 6).

## References

- [F-014](../../features/F-014-self-explaining-views.md), [ADR-0021](./0021-sidecar-written-as-changes.md),
  [ADR-0022](./0022-books-in-the-layout-sidecar.md)
