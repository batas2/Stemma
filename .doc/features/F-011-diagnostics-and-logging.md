# Feature: Diagnostics & logging — a leveled, structured record of what the engine did

| Field | Value |
|---|---|
| **ID** | F-011 |
| **Status** | `Shipped` (v1) — see §11 for what is not built |
| **Owner** | Bartosz |
| **Persona served** | Senior Engineer ("Sam") reads it; Solution Architect ("Aria") and Data Architect ("Devin") benefit when an edit fails; The Essayist's Agent ("Ada") depends on it, having no UI to show an error in (see [`../product/users-and-personas.md`](../product/users-and-personas.md)) |
| **Roadmap horizon** | `Next` |
| **Created / Updated** | 2026-08-08 / 2026-08-08 |

> **Id note.** F-004…F-010 are reserved by the agent-authored-diagrams programme
> ([`../features/README.md`](./README.md)). This record takes the next free id, F-011.

## 1. Product — why

- **Problem:** Stemma currently has, in the whole backend, **one** diagnostic statement —
  `Console.Error.WriteLine($"[workspace] …")` at
  [`src/Stemma.Engine/Workspace/WorkspaceLoader.cs:40`](../../src/Stemma.Engine/Workspace/WorkspaceLoader.cs) —
  plus whatever ASP.NET Core prints by default. Everything else that goes wrong goes wrong silently:
  **8 exception handlers in the backend swallow without a trace** and **21 promise chains in the
  client end in `.catch(() => {})`**. Concretely, `StemmaEngine.ApplyInternalAsync` does
  `try { _archBeforeOp = await ReadArchModelAsync(ct); } catch { _archBeforeOp = null; }` — when that
  fires, undo silently stops working for that operation and *nothing anywhere records it*.
  `ExternalWatcher` swallows three separate failure paths, so "my colleague's edit didn't show up"
  is currently unanswerable.
- **Why now:** three forces converge.
  1. **The desktop shell removes the terminal.** [F-002](./F-002-desktop-shell.md) puts Stemma in a
     Photino window with no console attached; its own AC states the launch failure mode must be "an
     in-window error with the log path, not a dead page". There is no log, and no path. F-002 cannot
     meet that AC until this record ships.
  2. **The headless path has no UI at all.** `stemma render` (F-004) run by an agent has exactly one
     output channel for what went wrong, and it is stdout.
  3. **Fidelity is the project's central promise and is currently unobservable.** When a rewrite
     damages trivia, the only artifact is a bad `git diff` after the fact, with no record of which
     operation, which document, or which Roslyn path produced it.
- **Value:** serves **Trustworthy edits**
  ([`../product/value-proposition.md`](../product/value-proposition.md)) by making a failed edit
  legible instead of silent, and turns the fidelity contract from a promise checked only by the test
  suite into one observable in the field.
- **Out of scope:**
  - **Logs are not the change history. Git is.** No audit trail of model edits, no "who changed
    what" store — that is what the diff and the commit are for, and building it here would be the
    parallel data store rule 3 forbids.
  - No telemetry, no crash reporting to a server, no phone-home of any kind (see §3.6).
  - No metrics or distributed tracing signals (`Meter`, `Activity` spans). Log records only. The
    design must not *preclude* them later, but shipping them now is scope for an observability
    product Stemma is not.
  - No log-driven alerting, dashboards, or retention policy beyond a local disk cap.

## 2. User story & acceptance criteria

> As a **senior engineer debugging a failed model edit**, I want a leveled, structured, correlated
> record of what the engine actually did, so that I can explain a bad diff or a lost edit without
> reproducing it under a debugger.

- [x] AC1 — Every operation applied through `StemmaEngine.ApplyAsync` emits exactly **one**
      `Information` record on success and **one** `Error` record on failure, each carrying `opId`,
      operation type, workspace id, affected document path, and elapsed milliseconds. No operation
      completes with zero records.
- [x] AC2 — Log level is configurable **per category** and changeable **without a rebuild**, via
      `appsettings.json`, an environment variable, and a `run.sh` flag. Raising a category to `Trace`
      at runtime takes effect without restarting the process. Serilog is given the
      `Logging:LogLevel` categories itself (its provider bypasses the framework's filters): one set
      quieter than the default — `Microsoft.AspNetCore` at `Warning`, assumed when nothing says
      otherwise — stays at least that quiet when the level is changed; one set louder says at least
      that much; every other category follows the level, and `none` silences them all.
- [x] AC3 — Console output is available in two formatters — `simple` (human-readable, coloured) and
      `json` (one JSON object per line) — selectable at launch. `simple` is the default for
      `./run.sh --dev`; `json` is the default when stdout is not a TTY.
- [x] AC4 — A rolling file sink writes JSON-lines to `~/.stemma/logs/`, rotating daily and by size,
      with a total disk cap that is enforced without user action. The desktop shell can name the
      current file path in an error surface (F-002's requirement).
- [x] AC5 — A single user action is traceable end to end: the client generates a correlation id per
      action, sends it on the HTTP call and the SignalR invocation, and **every** backend record
      produced while handling it carries that id — from the API endpoint through the engine to the
      Roslyn document write.
- [x] AC6 — Every `catch` in `src/` either logs or carries a comment stating why silence is correct.
      Zero unexplained swallows remain (from 8 backend + 21 client today).
- [x] AC7 — A failed fidelity verification emits `Critical` naming the document, the operation, and
      the before/after content hashes, and does so *before* the damaged file is handed back to the
      user.
- [x] AC8 — **Logging does not perturb rewrites.** The fidelity suite produces byte-identical output
      with logging at `Trace` and at `None`, proven by a test, not by inspection.
- [x] AC9 — The user can produce a **diagnostics bundle** (recent log records + environment facts) in
      one action. It is **redacted by default** — no element names, no source text, no absolute paths
      — with an explicit opt-in to include model content. The records are the newest 500, oldest
      first, across however many daily files they span.
- [x] AC10 — No log record leaves the machine. There is no network sink, and none can be configured
      without a code change (see §3.6).

## 3. Architecture impact

- [ ] **Model or presentation?** **Neither.** Logging is host and engine infrastructure. It writes no
      model, touches no sidecar, and adds no operation. The log file lives in `~/.stemma/logs/` —
      per-user machine state, alongside the existing `~/.stemma/recent.json`
      ([`RecentWorkspaces.cs`](../../src/Stemma.Engine/Workspace/RecentWorkspaces.cs)) — never in the
      workspace, never in Git.
- [ ] **New/changed operations:** none. No fidelity fixtures needed for the feature itself; see AC8
      for the fixture the feature owes the *existing* suite.
- [ ] **Fidelity:** untouched by construction, and this must be enforced rather than assumed —
      logging code sits beside `DocumentEditor` calls and must never participate in one. AC8 is the
      guard.
- [ ] **Engine purity:** preserved, with a caveat worth stating plainly (§3.1).
- [ ] **Sidecar:** none.
- [x] **ADR needed?** **Yes** — written as [ADR-0020](../architecture/decisions/0020-diagnostics-contract.md). Not for the dependency (already taken, §3.1) but for the
      *contract*: the level taxonomy, the category scheme, the no-network rule, and the redaction
      classes. Those are cross-cutting, expensive to change once call sites exist, and a future
      contributor needs one page to conform to rather than a 300-line feature record.
- **Affected files/areas:** `src/Stemma.Engine/Stemma.Engine.csproj` (already carries the reference),
  `src/Stemma.Engine/Workspace/*` (constructor injection), `src/Stemma.Engine/ArchModel/*`,
  `src/Stemma.Web/Program.cs` (provider wiring, request correlation),
  `src/Stemma.Web/Services/EngineHost.cs`, `src/Stemma.Web/Hubs/WorkspaceHub.cs`, a new
  `src/Stemma.Web/Diagnostics/`, a new `src/Stemma.Web.Client/src/lib/log.ts`, `run.sh`,
  `appsettings.json`.

### 3.1 Engine purity — the honest position

Conventions rule 6 says `Stemma.Engine` depends on "Roslyn + `Stemma.Model`, nothing else".
The project file already reads otherwise: alongside Roslyn it carries `Microsoft.Build.Locator`,
`Markdig`, `YamlDotNet` — and **`Microsoft.Extensions.Logging.Abstractions` 10.0.0, which is
referenced today and used by zero lines of code.** The rule as practised means *no web, no LLM, no
hosting concerns*, not *no packages*.

This feature does not widen that. The binding constraint, which the ADR should state:

> The engine may depend on **`Microsoft.Extensions.Logging.Abstractions` only** — the `ILogger<T>`
> contract. It must never reference a provider, a sink, a formatter, or `IConfiguration`. Every
> engine type takes `ILogger<T>` by constructor injection and **defaults to
> `NullLogger<T>.Instance`**, so the engine remains constructible, testable, and embeddable with no
> logging stack present at all.

That keeps the engine a library rather than an application, which is the point rule 6 was protecting.

### 3.2 Level taxonomy

Levels are worthless unless a `Warning` means the same thing in every file. The industry guidance is
consistent on the shape ([Better Stack](https://betterstack.com/community/guides/logging/log-levels-explained/),
[Dash0](https://www.dash0.com/knowledge/log-levels)); what follows binds it to Stemma's domain, which
is the part that actually prevents drift.

| Level | Stemma meaning | Enabled by default | Examples |
|---|---|:--:|---|
| `Trace` | Roslyn-level detail. Syntax node paths, per-token rewrite steps, full before/after document text, every raw filesystem watcher event. Expensive; may allocate freely because it is off. | no | `DocumentEditor` node replacement; unified diff of a rewritten document |
| `Debug` | Internal decisions a developer needs to reconstruct a run. Which document was resolved for an id, which loader path was chosen, sidecar merge outcomes, undo inverse construction, cache hits. | no | "resolved id → `Architecture/Architecture.cs`"; "`WorkspaceKind.ModelOnly` (no SDK)" |
| `Information` | **Facts about outcomes the user caused or would recognise.** Exactly one per user-visible outcome — no progress chatter, no "entering method". | **yes** | workspace opened (n projects, n elements); operation applied; view saved; report exported; watcher reload completed |
| `Warning` | Degraded but continued. A fallback ran, something was dropped, or a limit is near. **Every warning must name what the user will observe as different.** | **yes** | "no SDK found — opened as model-only, project references ignored"; "sidecar entry for unknown element dropped"; "SignalR broadcast failed; client will resync on reload" |
| `Error` | **The user's intent did not happen.** An operation failed, a file could not be written, a request was rejected. Always carries the exception object and the `opId`. | **yes** | `RenameElementOp` failed; layout write denied by permissions; view file unparseable |
| `Critical` | **The user's source may be damaged, or the workspace is unsafe to keep editing.** Reserved almost entirely for the fidelity guard (§3.5) and partial-write failures. A Critical is a bug report, not a log line. | **yes** | fidelity verification failed after write; write interrupted leaving a document mid-edit |

Two rules that keep the taxonomy from rotting:

- **`Trace` is not "verbose `Debug`".** `Debug` reconstructs *what the engine decided*; `Trace`
  reconstructs *what Roslyn did*. If a record would still make sense to someone who has never opened
  `DslWriter.cs`, it is not `Trace`.
- **`Warning` is not "a small `Error`".** If the user's intent completed, it is at most a `Warning`.
  If it did not, it is an `Error`. There is no middle.

### 3.3 Categories and event ids

Dot-separated UpperCamelCase, per the
[OpenTelemetry .NET guidance](https://opentelemetry.io/docs/languages/dotnet/logs/best-practices/),
so `Logging:LogLevel:Stemma.Engine.Fidelity` filters a subsystem without listing every class. The
category is the fully-qualified type name by default; the table fixes the **prefixes** that must
exist because they are the units people filter on.

| Category prefix | Owns | EventId range |
|---|---|---|
| `Stemma.Engine.Workspace` | open/close/reload, loader selection, MSBuild vs model-only | 1000–1099 |
| `Stemma.Engine.Operations` | the `ApplyAsync` pipeline, undo/redo | 1100–1199 |
| `Stemma.Engine.Fidelity` | rewrite verification, hashes, trivia guards | 1200–1299 |
| `Stemma.Engine.Watcher` | `ExternalWatcher`, debounce, external-edit sync | 1300–1399 |
| `Stemma.Engine.Adapters` | DSL reader/writer, YAML, views, sidecars | 1400–1499 |
| `Stemma.Engine.Validation` | rule engine, violations | 1500–1599 |
| `Stemma.Web.Api` | endpoint entry/exit, request correlation | 2000–2099 |
| `Stemma.Web.Hub` | SignalR connection lifecycle, broadcasts | 2100–2199 |
| `Stemma.Web.Export` | report, PDF, mermaid, drawio | 2200–2299 |
| `Stemma.Web.Ai` | Claude transport — reserved; see §9 | 2300–2399 |
| `Stemma.Client.*` | browser-side records, mirrored into the same schema | 9000–9999 |

Stable `EventId`s matter more here than in a cloud service: they are what a maintainer greps for in a
bundle pasted into a GitHub issue, and they survive message rewording.

### 3.4 Structured logging is mandatory

All records go through the **`[LoggerMessage]` source generator**. This is the current .NET
recommendation and is enforced by the built-in analyzer `CA1848`, which flags `LogInformation()`-style
calls; the generator parses the message template once at compile time instead of on every call and
avoids boxing value-type arguments
([Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/extensions/logger-message-generator),
[high-performance logging](https://learn.microsoft.com/en-us/dotnet/core/extensions/logging/high-performance-logging)).

Non-negotiables:

- **No string interpolation in log calls, ever.** `$"opened {path}"` produces an unsearchable blob;
  `"Workspace opened {WorkspacePath}"` produces a queryable field. This is also the mechanism
  redaction hooks into (§3.6) — an interpolated string cannot be redacted because by the time the
  logger sees it there are no longer any properties.
- **Exceptions are a parameter, not part of the template.** The OTel spec has dedicated exception
  attributes and only populates them when the exception is passed as an argument.
- **`IsEnabled()` is not called routinely** — the API is already optimised for disabled loggers.
  Call it only to guard genuinely expensive argument construction, which in practice means the
  `Trace` diff in §3.5.
- **One `LoggerFactory` per process**, owned by the host and disposed on shutdown. Disposing early
  makes later records vanish silently; not disposing drops buffered ones.

Define partial methods in a static `Log` class per subsystem, e.g.:

```csharp
internal static partial class EngineLog
{
    [LoggerMessage(EventId = 1101, Level = LogLevel.Information,
        Message = "Operation {OperationType} applied to {DocumentPath} in {ElapsedMs} ms")]
    public static partial void OperationApplied(
        ILogger logger, string operationType, string documentPath, long elapsedMs);
}
```

### 3.5 The fidelity log — why this feature is worth building *here*

A generic "add logging" record would stop at §3.4. The reason this one earns its place is that
Stemma's central guarantee is currently invisible between test runs.

- At **`Debug`**, every document write emits the document path plus a **content hash before and
  after** (SHA-256, first 12 hex chars). Cheap, always affordable, and enough to prove after the fact
  which operation touched which file and whether it changed at all.
- At **`Trace`**, the same write emits a **unified diff** of the document. This is the expensive
  record and the one legitimate use of `IsEnabled()`. With it, a fidelity bug reported by a user is
  reproducible from the log alone, without their proprietary source.
- A **post-write verification** — re-parse the written document and compare its full-fidelity text
  against the intended tree — emits **`Critical`** on mismatch, carrying operation, document, and both
  hashes. Per the standing rule, a failure here is fixed in the implementation, never in the test;
  the log record exists so the failure is *noticed* in the field, where there is no test.

This is what makes the roadmap's claim auditable rather than merely asserted, and it costs one hash
per write.

### 3.6 Privacy — the constraint that overrides the industry default

The prevailing best practice is to ship structured logs to a central backend over OTLP and correlate
them with traces. **For Stemma that guidance is wrong, and the spec must say so explicitly** so that
nobody "improves" it later.

A Stemma log record contains element names, bounded-context names, ownership and risk annotations,
absolute filesystem paths, and potentially C# source text. That is not incidental PII — **it is the
user's confidential system architecture**, which is precisely what a solution architect cannot leak.
Stemma is local-first because the engine compiles the user's repository; the logs inherit that
posture.

Therefore:

1. **No network sink ships. Not disabled-by-default — absent.** Adding one is a code change that must
   go through an ADR. This is AC10.
2. **Local logs are unredacted.** They are the user's own model on the user's own machine; redacting
   them would destroy the feature's value to buy nothing.
3. **The diagnostics bundle is redacted by default** — it is the artifact that travels. Model content
   is erased, absolute paths are reduced to workspace-relative, and the git-derived author from
   `/api/author` is dropped. An explicit, clearly-labelled opt-in includes model content for users
   who can share it.

Redaction is implemented with
[`Microsoft.Extensions.Compliance.Redaction`](https://learn.microsoft.com/en-us/dotnet/core/extensions/data-redaction):
declare data classification attributes and apply them to logged parameters, with `ErasingRedactor` for
model content and `HmacRedactor` for identifiers that must stay correlatable across records without
being readable. Note the library's hard constraint, which reinforces §3.4: **redaction only applies to
values passed through `[LoggerMessage]` with `[LogProperties]`/`[TagProvider]`.** Interpolated strings
cannot be redacted. Two data classes suffice:

| Classification | Covers | Bundle redactor |
|---|---|---|
| `ModelContent` | element ids and names, contexts, tags, C# source text, unified diffs | `ErasingRedactor` |
| `UserIdentity` | git `user.name` / `user.email`, home-relative absolute paths | `HmacRedactor` (stable, unreadable) |

### 3.7 Correlation — one id from click to Roslyn

Correlation is the single highest-value item after the levels themselves, and Stemma is unusually well
placed for it: **`OperationBase.OpId` already exists** and already flows from the client through the
API into `ApplyAsync` and the undo stack. The work is to make it a logging scope rather than to invent
an identifier.

- The client generates a correlation id per **user action** (not per request — one canvas drag may
  produce several calls) and sends it as `X-Correlation-Id` on HTTP and as an argument on SignalR
  invocations, per the standard practice for
  [request-trace correlation](https://oneuptime.com/blog/post/2026-01-30-request-trace-correlation/view).
- Middleware in `Stemma.Web` opens an `ILogger.BeginScope` carrying `correlationId`, `workspaceId`
  (an HMAC of the root path, never the path itself in the bundle), and `opId` once known. Every
  record emitted downstream inherits them.
- The response echoes the correlation id back, so a client-side error record can name the server
  exchange that produced it.

The payoff, stated as the acceptance test (AC5): one grep on a correlation id returns the click, the
HTTP call, the operation, the document write, the fidelity hashes, and the SignalR broadcast that told
the other panels to refresh — in order.

## 4. UX impact

- [ ] **Journey(s) touched:** none in the happy path — that is deliberate; a logging feature the user
      notices while things work has failed. Two failure paths in
      [`../ux/user-journeys.md`](../ux/user-journeys.md) change:
      **J1 (open and orient)** — a workspace that fails to open shows the reason and offers the log,
      instead of a bare toast; **J2 (edit the model)** — a failed operation surfaces its `opId` so the
      report the user files is actionable.
- [ ] **States defined:** *error* gains a "Details" affordance revealing the last records for that
      correlation id; *empty* for the diagnostics panel when the buffer is empty; *loading* while a
      bundle is assembled; **launch-failure** — the F-002 in-window surface naming the log file path.
- [ ] **Interactions:** open the diagnostics panel from the existing error toast and from a
      keyboard path consistent with the shortcut scheme; change the live level from a dropdown; copy
      the bundle to the clipboard or save it to a file. The redaction opt-in is a checkbox on the copy
      action, **default off**, with one line of plain text stating what it will include — never a
      pre-ticked box, since the consequence is disclosing the user's architecture.
- [ ] **Accessibility:** the panel is a normal focus-trapped surface, reachable and dismissible by
      keyboard; records are a semantic list, not a `<pre>` blob, so a screen reader can move by item;
      level is conveyed by text and shape, never by colour alone; the copy action announces success
      via a live region.

## 5. UI impact

- [ ] **Components touched/added:** one new panel (`DiagnosticsPanel`) in the existing right-rail
      pattern alongside `CommentsPanel`; a `LogRecordRow`; a level badge. The existing error toast
      gains a "Details" link. Register both in [`../ui/components.md`](../ui/components.md).
- [ ] **Tokens:** reuse the existing semantic status tokens for warning/error/critical. **No new
      colour tokens** — if `Critical` needs a colour that does not exist, that is a gap in
      [`../ui/design-tokens.md`](../ui/design-tokens.md) to close there first, not a one-off here.
      Records are monospace at the existing code type scale.
- [ ] **Both themes:** verified dark + light; the level badges must clear contrast in both, which the
      shape-plus-text rule above already guarantees if colour fails.
- [ ] **Layout/rail behavior:** lives in the right rail, disabled-not-hidden when no workspace is
      open (the log still exists and still matters — that is exactly when open fails).

## 6. Technical prerequisites & dependencies

- [ ] **`Microsoft.Extensions.Logging.Abstractions`** — already referenced by `Stemma.Engine` and
      currently unused. No new engine dependency.
- [ ] **A file sink.** `Microsoft.Extensions.Logging` has **no built-in file provider**; the
      three built-in console formatters are `Simple`, `Systemd` and `Json`
      ([Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/extensions/console-log-formatter)),
      and that is the whole of the box. **Recommendation: `Serilog.Extensions.Logging` +
      `Serilog.Sinks.File`**, wired as a *provider behind `ILogger`* so no call site ever references
      Serilog and the choice stays reversible. Rationale over the alternatives: NLog is equivalent but
      heavier to configure for one sink; the OpenTelemetry file exporter drags in the OTel SDK to
      solve a problem we have scoped out; hand-rolling rotation is a solved problem not worth owning.
      **The engine must not see this dependency** (§3.1).
- [ ] **`Microsoft.Extensions.Compliance.Redaction`** in `Stemma.Web` only, for the bundle path.
- [ ] **`CA1848` raised to error** in `Directory.Build.props`. The repo already sets
      `TreatWarningsAsErrors`, so this mostly means *not* adding it to `WarningsNotAsErrors` — it
      mechanically enforces §3.4 instead of relying on review.
- [ ] **Rotation and retention policy**, enforced without user action: daily roll, 20 MB per file,
      **200 MB or 14 days total, whichever comes first**. A modelling tool must never be the reason a
      laptop runs out of disk, and small files are cheaper to read and ship than one large one.
- [ ] **Configuration surface**, precedence low → high:

  | Source | Form |
  |---|---|
  | `appsettings.json` | standard `Logging:LogLevel:<Category>` — already present in the file |
  | environment | `STEMMA_LOG_LEVEL`, `STEMMA_LOG_FORMAT=simple\|json`, `STEMMA_LOG_FILE=on\|off`, `STEMMA_LOG_DIR` |
  | `run.sh` | `--log-level <level>`, `--log-format <fmt>` |
  | runtime | the diagnostics panel dropdown, via `IOptionsMonitor` reload — no restart (AC2) |

- [ ] **Depends on / blocks:** **blocks [F-002](./F-002-desktop-shell.md)** — its
      backend-failed-to-start AC needs a log file and a path to name. Should land before or with the
      shell. Serves F-004 (`stemma render`), whose only error channel is stdout, which makes the
      `json` console formatter (AC3) a hard requirement rather than a nicety.
- [ ] **No sample workspace changes.** Logging touches no workspace content.

## 7. Test plan

- [ ] **Fidelity fixtures:** none owed for new operations (there are none). **But AC8 owes the
      existing suite a new test:** run the round-trip corpus twice, once with the logger factory at
      `Trace` and once at `None`, and assert the produced source is byte-identical. This is the test
      that stops a future contributor from "just tidying up" inside a rewrite path while adding a log
      line.
- [ ] **Level discipline (backend unit):** with a fake `ILoggerProvider`, assert `ApplyAsync` emits
      exactly one `Information` on success and exactly one `Error` on failure (AC1) — the test that
      keeps `Information` from silting up into a progress firehose.
- [ ] **Correlation (integration):** drive `WebApplicationFactory` with an `X-Correlation-Id`, assert
      every captured record within the request carries it, including those emitted from engine types
      and from the SignalR broadcast (AC5).
- [ ] **Redaction (unit):** assert a bundle built from records containing element names and absolute
      paths contains neither, and that the opt-in path does contain them (AC9). Include a **negative
      test** proving an interpolated-string log call is *not* redacted — encoding the §3.6 limitation
      as an executable warning rather than a paragraph nobody rereads.
- [ ] **No network sink (architecture test):** assert no provider in the composed logger factory
      opens a socket, and that the assembly references no HTTP-capable sink package (AC10).
- [ ] **Rotation (unit):** write past the size and count caps against a temp directory; assert files
      roll, the cap holds, and the oldest are removed.
- [ ] **Frontend unit (vitest):** level filtering, ring-buffer eviction, correlation id propagation on
      the fetch and SignalR wrappers, and the error boundary emitting exactly one `Error`.
- [ ] **Regression:** `./run.sh --dev` and `--prod` behave as before; console output at default level
      is *quieter* than today's ASP.NET default, not noisier.
- [ ] **Silence sweep (lint or test):** fail the build on a `catch` block in `src/` that neither logs
      nor carries a justifying comment (AC6).

## 8. Definition of Done

- [ ] All ACs met and demoed
- [ ] States handled; accessibility bar met
- [ ] `dotnet test` green · `tsc` clean · `vite build` clean · `vitest` green
- [ ] Model/presentation boundary respected; no new data store — the log is machine state in
      `~/.stemma/`, not model and not sidecar
- [ ] The ADR from §3 written, `Accepted`, and referenced from `conventions.md`
- [ ] Docs updated: [`../engineering/conventions.md`](../engineering/conventions.md) gains the logging
      rules (levels, `[LoggerMessage]`, no interpolation, no network sink);
      [`../architecture/tech-stack.md`](../architecture/tech-stack.md) gains the sink choice;
      [`../architecture/overview.md`](../architecture/overview.md) notes the diagnostics surface;
      `README.md` documents the env vars and the log location
- [ ] Reviewed against all four pillars

## 9. Notes / open questions

- **Is `Critical` on a fidelity failure enough, or should the engine refuse to hand back the
  document?** §3.5 logs and continues. The stronger position — fail the operation and restore the
  original text — is arguably what "round-trip fidelity is the most important constraint" implies. It
  is a behaviour change beyond logging, so it is deliberately *not* in this record, but the ADR should
  name it as the follow-up rather than let it be forgotten.
- **`Stemma.Web.Ai` (category 2300–2399) is reserved for a transport that does not exist yet.**
  `appsettings.json` carries `Stemma:Ai:Transport: "cli"` and `run.sh` prints a transport advisory,
  but a grep of `src/` finds no implementing code. When it lands it will log prompts and responses —
  the single highest-risk logging surface in the product, since a prompt embeds the model. It must be
  `Debug`-and-below, classified `ModelContent`, and never in the default bundle. Flagging it now is
  cheaper than retrofitting it.
- **`workspaceId` derivation.** An HMAC of the absolute root path is stable per machine and
  unreadable in a bundle, but is not stable *across* machines for the same repository — which would
  be the more useful property if a team ever compares bundles. Deferred; the local case is the one
  that exists.
- **Client records are mirrored into the backend schema but never streamed.** They reach disk only
  when the user builds a bundle. This is a deliberate cost — a client crash before that is
  unrecoverable — accepted because a streaming client log is a telemetry pipe by another name.
- **Level guidance is only as good as its enforcement.** AC1, the silence sweep, and `CA1848` are the
  three mechanical guards; everything else in §3.2 is convention and will drift without them.

## 10. References

Market practice this record draws on, current as of 2026-08:

- [Compile-time logging source generation](https://learn.microsoft.com/en-us/dotnet/core/extensions/logger-message-generator) · [High-performance logging](https://learn.microsoft.com/en-us/dotnet/core/extensions/logging/high-performance-logging) — Microsoft Learn
- [OpenTelemetry .NET logging best practices](https://opentelemetry.io/docs/languages/dotnet/logs/best-practices/) — `ILogger` as the API, category naming, exceptions as parameters, factory lifetime
- [OpenTelemetry Logs Data Model](https://opentelemetry.io/docs/specs/otel/logs/data-model/) · [Semantic conventions explainer](https://www.dash0.com/knowledge/otel-semantic-conventions-explainer) — the record shape the JSON sink should not gratuitously diverge from
- [Log levels explained](https://betterstack.com/community/guides/logging/log-levels-explained/) — Better Stack · [Log levels with OpenTelemetry](https://www.dash0.com/knowledge/log-levels) — Dash0
- [Data redaction in .NET](https://learn.microsoft.com/en-us/dotnet/core/extensions/data-redaction) · [Compliance libraries](https://learn.microsoft.com/en-us/dotnet/core/extensions/compliance) — Microsoft Learn · [Redacting sensitive data](https://andrewlock.net/redacting-sensitive-data-with-microsoft-extensions-compliance/) — Andrew Lock
- [Console log formatting](https://learn.microsoft.com/en-us/dotnet/core/extensions/console-log-formatter) — Simple / Systemd / Json, and the absence of a built-in file provider
- [Request-trace correlation](https://oneuptime.com/blog/post/2026-01-30-request-trace-correlation/view) · [Correlating frontend and backend traces](https://oneuptime.com/blog/post/2026-01-15-correlate-frontend-backend-traces-react/view) — OneUptime
- [Log retention policies](https://last9.io/blog/log-retention/) — Last9 · [Log rotation strategies](https://oneuptime.com/blog/post/2026-01-25-log-rotation-strategies/view) — OneUptime

## 11. What shipped, and what did not

Shipped on 2026-08-08: [ADR-0020](../architecture/decisions/0020-diagnostics-contract.md); the
engine's `[LoggerMessage]` records with `ILogger<T>` injected and defaulting to `NullLogger`; the
fidelity hashes, the `Trace` diff and the `Critical` verification on the one write path; the console
and rolling-file providers with the level, format and directory configurable four ways; correlation
from the client through HTTP and SignalR into the engine; the redacted diagnostics bundle; and the
silence sweep — zero bare `catch` blocks remain in `src/` on either side.

**Not built, and each one is a real gap rather than an oversight:**

- **The `DiagnosticsPanel` and the toast "Details" affordance (§4, §5).** The data is all there —
  `lib/log.ts` holds a bounded, level-filtered buffer and the endpoints exist — but there is no UI
  surface over it. Until there is, an ordinary user cannot see a record; a developer with devtools
  or a terminal can. This is the largest outstanding piece.
- **`Microsoft.Extensions.Compliance.Redaction` (§3.6).** Redaction is implemented directly over the
  record properties rather than through classification attributes and `ErasingRedactor`/`HmacRedactor`.
  The behaviour the ACs ask for holds and is tested, including the negative test proving an
  interpolated message is *not* redacted; the library would make the classification declarative
  rather than a list of property names in one file, which is the better long-term shape.
- **`CA1848` raised to error.** The rule is followed and stated in `conventions.md`, but it is not
  yet mechanically enforced, so §3.4 currently rests on review.
- **The silence sweep as a build gate (§7).** Done once, by hand, and verified by grep. Nothing stops
  the next bare `catch` from landing.
- **`WorkspaceLoader` and the adapters** log only where a path was already failing silently. The
  `Debug` records that reconstruct a load — which document was resolved for an id, sidecar merge
  outcomes — are declared in the taxonomy and not yet emitted.
