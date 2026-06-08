# Verso Documentation — Single Source of Truth (SSOT)

This directory is the authoritative, structured home for everything about Verso: why it exists,
how it is built, how it should look and feel, and how it is extended. It supersedes the historical
notes now archived under [`../.doc.legacy/`](../.doc.legacy/).

> **Rule of thumb:** if a decision, contract, or convention matters beyond a single pull request,
> it belongs here. If it is a disposable working note, it does not.

## How this is organised

The docs are split along the four perspectives every change must consider — **Product, Architecture,
UX, UI** — plus the shared engineering standards and the actionable templates.

| Area | Read it when… |
|---|---|
| [`product/`](./product/) | You want to know *why* Verso exists, who it's for, and where it's going. |
| [`architecture/`](./architecture/) | You need to understand how the system is built and the rules you must not break. |
| [`ux/`](./ux/) | You're designing a flow, a state, or an interaction. |
| [`ui/`](./ui/) | You're touching the visual system, tokens, or components. |
| [`engineering/`](./engineering/) | You need conventions, testing rules, contribution flow, or vocabulary. |
| [`templates/`](./templates/) | You're starting a feature, filing a bug, or recording a decision. |
| [`features/`](./features/) | Active and shipped feature records (instances of the feature template). |
| [`bugs/`](./bugs/) | The bug triage board (instances of the bug template). |

## The four pillars (every change is reviewed against all four)

1. **Product** — Why does this exist? Who is the user? What problem does it solve?
2. **Architecture** — Clear boundaries, data structures, and rules so any developer onboards instantly.
3. **UX** — User journeys and every state: empty, loading, error, optimistic.
4. **UI** — Visual consistency, component layout rules, and frontend structure.

## Start here

- New to Verso? → [`product/vision.md`](./product/vision.md) then [`architecture/overview.md`](./architecture/overview.md).
- Implementing a change? → [`templates/feature-template.md`](./templates/feature-template.md).
- Fixing something? → [`templates/bug-template.md`](./templates/bug-template.md).

## The one rule that overrides everything

Verso's promise is **round-trip fidelity**: a UI edit must produce a `git diff` containing *only* the
intended change. This constraint is described in [`architecture/engine-backend.md`](./architecture/engine-backend.md)
and [`engineering/conventions.md`](./engineering/conventions.md) and is non-negotiable. When in doubt,
favour fidelity over features.

## Doc conventions

- **Prose, not bullet-dumps.** Explain the *why*, then the *how*.
- **Link, don't duplicate.** Each fact lives in exactly one file; everything else links to it.
- **Keep it current.** Out-of-date docs are worse than none. The Docs Librarian owns coherence.
- **Date assumptions.** Convert "next quarter" to an absolute date.
