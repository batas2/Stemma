# Bug: the CORS policy refuses the page the host is serving

| Field | Value |
|---|---|
| **ID** | B-005 |
| **Status** | `Fixed` |
| **Severity** | `S3 minor` |
| **Area** | `web` |
| **Reported by / Date** | Bartosz / 2026-08-11 |
| **Affected version / commit** | present since CORS was added; found building the desktop shell (F-002) |

## 1. Summary

The default CORS policy allowed exactly two origins — `http://localhost:5173` and
`http://127.0.0.1:5173`, the Vite dev server — so **every request from the page the host itself
serves was refused**. Nothing broke, because a same-origin request does not need the header the
policy withholds. What it produced was one `CORS policy execution failed` record per request, which
buries the log the desktop shell points the user at when something is genuinely wrong (ADR-0020).

## 2. Steps to reproduce

1. `./run.sh --prod` (backend on 5050, no Vite), or launch `stemma-desktop`.
2. Open the app and watch the log — `~/.stemma/logs/stemma-<date>.log`, or stdout.

- **Expected:** nothing. The page is talking to the server that served it.
- **Actual:** for every document, script, stylesheet and API call:

  ```
  CORS policy execution failed.
  Request origin http://127.0.0.1:36565 does not have permission to access the resource.
  ```

- **Frequency:** always, once the app is served from any origin other than `:5173`.
- **Environment:** Linux; WebKitGTK in the shell, and any browser under `run.sh --prod`.
- **Evidence:** ~60 records on a single first load of the shell, drowning the startup sequence.

## 3. Triage

- [x] **Severity & priority agreed** — S3. No user-visible symptom; it damages diagnosability, and
      the diagnostics work exists precisely so that a report is actionable.
- [x] **Reproduced** on both the shell and `run.sh --prod`.
- [x] **Regression?** No — wrong from the day the allow-list was written. Invisible because
      development runs on `:5173`, which is the one origin it named.
- [x] **Pillar(s) affected:** Architecture.

## 4. UX / UI impact

- [x] **State involved:** every state; it is per request.
- [x] **User-visible symptom:** none directly. The cost lands on whoever reads the log after
      something else has gone wrong.
- [x] **Severity to trust:** does not make edits feel unsafe.

## 5. Root cause

`StemmaWebHost.Build` (previously `Program.cs`) configured the default policy with a literal
allow-list:

```csharp
.WithOrigins("http://localhost:5173", "http://127.0.0.1:5173")
```

The list encoded the *development* topology — Vite on one origin, the API on another — as though it
were the only one. It was already wrong for `run.sh --prod`, and the desktop shell made it
structurally unfixable: the port is chosen by the OS at launch, so no literal list can contain it.

This is the same shape as the sidecar bugs on this board: a value that happened to be constant
during development written down as if it were an invariant.

## 6. Fix

- **Approach:** decide by *predicate* rather than by list. Kestrel only ever binds loopback here, so
  any origin that can reach it is already running on the machine and gains nothing from refusal:

  ```csharp
  .SetIsOriginAllowed(StemmaWebHost.IsLocalOrigin)
  ```

  `IsLocalOrigin` is `Uri.IsLoopback` — `localhost`, `127.0.0.1`, `::1`, on any port. `SetIsOriginAllowed`
  echoes the specific origin rather than `*`, so `AllowCredentials` stays legal.
- **Affected files:** `src/Stemma.Web/StemmaWebHost.cs`.
- [x] Fix implemented
- [x] Inviolable rules respected
- [x] No new data store / boundary intact

## 7. Regression test (required)

- [x] Fails before the fix, passes after.
- **Test location:** `tests/Stemma.Desktop.Tests/BackendSessionTests.cs`
  (`The_page_it_serves_is_allowed_to_talk_to_it`) and `tests/Stemma.Web.Tests/StemmaWebHostTests.cs`
  (`Any_origin_on_this_machine_may_ask` / `Nothing_else_may`).
- **What it asserts:** a request carrying the host's own origin — on the port it was actually
  given — comes back with a matching `Access-Control-Allow-Origin`, and a non-loopback origin still
  does not.

## 8. Verification

- [x] `dotnet test` green · `tsc` clean · `vite build` clean · `vitest` green
- [x] Manually verified: a full first load of the packaged shell logs **zero** CORS failures, against
      roughly sixty before.
- [x] Docs updated — the failure mode is on the board below.
