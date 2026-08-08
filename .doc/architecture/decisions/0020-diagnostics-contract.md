# ADR-0020: The diagnostics contract — levels, categories, and no network sink

| Field | Value |
|---|---|
| **Status** | `Accepted` |
| **Date** | 2026-08-08 |
| **Deciders** | Bartosz |

## Context

The backend had one diagnostic statement in it. Everything else that failed, failed silently: eight
`catch` blocks swallowed without a trace and twenty-one client promise chains ended in
`.catch(() => {})`. `StemmaEngine` could lose the pre-operation snapshot that undo depends on and
record nothing, so "undo stopped working" was unanswerable.

Three things make that untenable now rather than eventually. The desktop shell (F-002) removes the
terminal and must name a log path in its failure surface. `stemma render` (F-004) is driven by an
agent whose only channel is stdout. And round-trip fidelity — the project's central promise — is
currently observable only as a bad `git diff` after the fact.

The decisions below are cross-cutting and expensive to change once call sites exist, which is why
they belong in an ADR rather than only in [F-011](../../features/F-011-diagnostics-and-logging.md).

## Decision

**1. The engine depends on the logging *abstraction* only.**
`Stemma.Engine` may reference `Microsoft.Extensions.Logging.Abstractions` and nothing else from the
logging stack — no provider, no sink, no formatter, no `IConfiguration`. Every engine type takes
`ILogger<T>` by constructor injection and defaults to `NullLogger<T>.Instance`, so the engine stays
constructible and testable with no logging stack present.

**2. Six levels, with domain meanings.**

| Level | Means | Default |
|---|---|:--:|
| `Trace` | What Roslyn did — node paths, document text, raw watcher events. | off |
| `Debug` | What the engine decided — which document, which loader, which inverse. | off |
| `Information` | An outcome the user caused and would recognise. Exactly one per outcome. | on |
| `Warning` | Degraded but continued. Must name what the user will observe as different. | on |
| `Error` | The user's intent did not happen. Carries the exception and the `opId`. | on |
| `Critical` | The user's source may be damaged. Effectively reserved for the fidelity guard. | on |

Two rules keep this from rotting. `Trace` is not verbose `Debug`: `Debug` reconstructs a decision,
`Trace` reconstructs a rewrite. And `Warning` is not a small `Error`: if the intent completed it is
at most a warning, if it did not it is an error, and there is no middle.

**3. Categories are dot-separated and stable; event ids are numbered by subsystem.**
`Stemma.Engine.Workspace` 1000–1099, `.Operations` 1100–1199, `.Fidelity` 1200–1299, `.Watcher`
1300–1399, `.Adapters` 1400–1499, `.Validation` 1500–1599; `Stemma.Web.Api` 2000–2099, `.Hub`
2100–2199, `.Export` 2200–2299, `.Ai` 2300–2399 (reserved); `Stemma.Client.*` 9000–9999. An event id
is what a maintainer greps for in a bundle pasted into an issue, so it outranks the message text and
must not be renumbered.

**4. Every record goes through `[LoggerMessage]`. No interpolation in a log call, ever.**
`$"opened {path}"` is an unsearchable blob and, more importantly, cannot be redacted — by the time
the logger sees it there are no properties left. `CA1848` is left as an error so this is mechanical
rather than a review habit.

**5. No network sink ships. Not disabled — absent.**
A Stemma record contains element and context names, ownership and risk annotations, absolute paths,
and potentially C# source. That is not incidental PII; it is the user's confidential architecture,
which is exactly what a solution architect cannot leak. Adding a network sink is a code change that
must come back through an ADR.

**6. Local logs are unredacted; the bundle is redacted by default.**
Local logs are the user's own model on the user's own machine, and redacting them would destroy the
value to buy nothing. The bundle is the artifact that travels, so model content is erased and
identifiers are reduced to something stable but unreadable, with an explicit opt-in — never
pre-ticked — to include model content.

## Consequences

- **Positive:** a failed edit becomes legible instead of silent, and the fidelity guarantee becomes
  observable in the field rather than only under `dotnet test`.
- **Positive:** the provider choice stays reversible. No call site names a sink, so swapping one is a
  change in one file.
- **Negative:** every engine type that logs grows a constructor parameter, and every log call is a
  generated partial method rather than a one-liner. That is the cost of structure, and it is what
  makes redaction possible at all.
- **Negative:** the level taxonomy is convention, and conventions drift. Three mechanical guards
  carry it — `CA1848`, the "exactly one record per operation" test, and the silence sweep.
- **Neutral:** the log lives in `~/.stemma/logs/`, beside the existing `recent.json`. It is per-user
  machine state, never workspace content and never in Git, so rule 3 is untouched: **logs are not the
  change history — Git is.**

## Alternatives considered

**Log directly to `ILogger` extension methods** (`logger.LogInformation($"...")`). One line instead
of a declared method, and it forfeits redaction, allocates on every call including disabled ones, and
produces messages nothing can query.

**Ship OTLP to a collector**, which is the prevailing guidance for a service. Wrong for a local-first
tool whose records contain the user's architecture; see decision 5.

**Hand-roll the file sink.** Avoids a dependency and puts rotation, retention and concurrent-write
safety in our hands, none of which is a problem worth owning.

**Refuse the operation on a fidelity mismatch rather than logging `Critical`.** Arguably what "round
trip fidelity is the most important constraint" implies, and a behaviour change rather than a
diagnostic one. Deliberately deferred, and named here so it is not forgotten.

## References

- [F-011](../../features/F-011-diagnostics-and-logging.md) — the feature record this contract serves.
- [`engineering/conventions.md`](../../engineering/conventions.md) — where the rules are restated for day-to-day use.
