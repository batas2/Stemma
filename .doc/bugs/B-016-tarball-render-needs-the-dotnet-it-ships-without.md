# Bug: `stemma render` from the tarball needs the `dotnet` the tarball is built to do without

| Field | Value |
|---|---|
| **ID** | B-016 |
| **Status** | `Fixed` |
| **Severity** | `S2 major` |
| **Area** | `cli` |
| **Reported by / Date** | Bartosz / 2026-10-17 |
| **Affected version / commit** | since the tarball (`443f2cb`, 2026-08-11) |

## 1. Summary

The Linux tarball is self-contained so that a machine with no .NET installed can run Stemma, and its
README lists `./stemma render` among the things to do with it. On such a machine every render
failed before it began:

```
stemma render: An error occurred trying to start process 'dotnet' with working directory '…'. No such file or directory
```

A render runs its own short-lived web host, and the CLI started that host as `dotnet Stemma.Web.dll`
whatever layout it was running from. On the developer's machine and in CI there is always a
`dotnet` on PATH, so it was never seen. `stemma open` had the converse fault: it looked only for the
shell's executable, which a framework-dependent layout (the tool package) need not carry.

## 2. Steps to reproduce

1. `scripts/package/package-linux.sh` and unpack the tarball.
2. Run it with no `dotnet` on PATH:
   `env -i HOME=$HOME PATH=<a PATH without dotnet> ./stemma/stemma render --workspace <ws> --view <id> --out x.png`

- **Expected:** `x.png`.
- **Actual:** the error above, exit 1.
- **Frequency:** always, on exactly the machines the tarball is for.
- **Environment:** the self-contained tarball on a machine without the .NET SDK.
- **Evidence:** found by testing the tarball as a release would ship it, from a clean unpack with
  `dotnet` hidden.

## 3. Triage

- [x] **Severity & priority agreed:** S2. A documented command of the distributed build fails every
      time for the audience it is distributed to. It blocks the first release.
- [x] **Reproduced:** from a clean unpack, `dotnet` hidden from PATH.
- [x] **Regression?** No. It has been wrong since the tarball was first built.
- [x] **Pillar(s) affected:** Architecture: how the CLI starts what ships beside it.

## 4. UX / UI impact

- [x] **State involved:** `stemma render` from the tarball; `stemma open` from a framework-dependent
      layout.
- [x] **User-visible symptom:** an error about a process named `dotnet`, which the person never
      installed and was told they would not need.
- [x] **Severity to trust:** medium. Nothing is damaged, but the first thing tried does not work.

## 5. Root cause

- `src/Stemma.Cli/HostProcess.cs` started the host with `new ProcessStartInfo("dotnet")` and the dll
  as its argument, in every layout.
- `src/Stemma.Cli/OpenCommand.cs` looked only for the `stemma-desktop` executable.

## 6. Fix

- **Approach:** start a program shipped beside the CLI the way the CLI itself was shipped.
  - **Framework-dependent** (a source build, the tool package): run the dll on the runtime the CLI
    is running on, found from its own runtime directory, not from PATH.
  - **Self-contained** (the tarball): there is no muxer, so start the program's own executable,
    which has the runtime beside it.
  - **Neither:** fall back to `dotnet` on PATH, so the error names what is missing.
- **Affected files:**
  - `src/Stemma.Cli/SiblingProgram.cs` (new)
  - `src/Stemma.Cli/HostProcess.cs`
  - `src/Stemma.Cli/OpenCommand.cs`
- [x] Fix implemented
- [x] Inviolable rules respected
- [x] No new data store / boundary intact

## 7. Regression test (required)

- [x] **Test location:** `tests/Stemma.Cli.Tests/SiblingProgramTests.cs`
- **What it asserts:**
  - On a shared runtime the program runs on that runtime's muxer, not on whatever PATH finds.
  - Self-contained, it starts from its own executable.
  - With neither, it falls back to PATH.
  - A directory that only looks like a runtime's is not taken for one.
  - The test run itself finds its own muxer.
- [x] **The tarball itself:** `scripts/package/smoke-test.sh` unpacks it, hides `dotnet` and runs
      `validate` and `render`. The release workflow runs it before anything is published.

## 8. Verification

- [x] `dotnet test` green
- [x] Manually verified: from a clean unpack with no `dotnet` on PATH, `render` writes the PNG and
      `validate` reports the workspace
- [x] Docs updated: the bug board; the tarball's README says what `render` needs (Google Chrome)
