<!--
Copy this file to `.doc/bugs/<id>-<slug>.md` (e.g. `B-031-drag-snaps-back.md`).
A bug is not "understood" until root cause is identified and a regression test is named.
-->

# Bug: <Title>

| Field | Value |
|---|---|
| **ID** | B-XXX |
| **Status** | `New` · `Triaged` · `In progress` · `Fixed` · `Won't fix` |
| **Severity** | `S1 blocker` · `S2 major` · `S3 minor` · `S4 cosmetic` |
| **Area** | `engine` · `web` · `canvas` · `inspector` · `layout` · `editor` · `sidecar` · `docs` |
| **Reported by / Date** | <name> / YYYY-MM-DD |
| **Affected version / commit** | <sha or version> |

## 1. Summary

<One or two sentences: what's wrong, who it hurts.>

## 2. Steps to reproduce

1. <step>
2. <step>
3. <step>

- **Expected:** <what should happen>
- **Actual:** <what happens>
- **Frequency:** always · intermittent (~X%) · once
- **Environment:** <browser / OS / theme / which view / sample or real workspace>
- **Evidence:** <screenshot / video / exact error text — quote errors verbatim>

## 3. Triage

- [ ] **Severity & priority agreed**
- [ ] **Reproduced** by someone other than the reporter (or noted why not)
- [ ] **Regression?** <when did it last work? suspected commit>
- [ ] **Pillar(s) affected:** Product / Architecture / UX / UI

## 4. UX / UI impact

- [ ] **State involved:** empty / loading / error / optimistic / conflict / selected
- [ ] **User-visible symptom:** <jump-back, flicker, lost work, wrong render, …>
- [ ] **Severity to trust:** <does it make edits feel unsafe? — that's high severity by definition>

## 5. Root cause

<The actual cause, not the symptom. Cite `path:line`. Common Stemma pitfalls to check:>

- [ ] Sidecar **re-fetched mid-session** (clobbers unflushed edits)?
- [ ] Node objects **rebuilt mid-drag** / `selected` not preserved across rebuilds?
- [ ] Model vs presentation **boundary** crossed?
- [ ] A fidelity rule violated (NormalizeWhitespace, string-rebuild, …)?
- [ ] Stale store **selector** returning a fresh object each snapshot?

## 6. Fix

- **Approach:** <what changes and why it addresses the root cause>
- **Affected files:** <`path` list>
- [ ] Fix implemented
- [ ] Inviolable rules respected
- [ ] No new data store / boundary intact

## 7. Regression test (required)

- [ ] A test that **fails before** the fix and **passes after**
- **Test location:** <`path`>
- **What it asserts:** <the specific invariant that was broken>

## 8. Verification

- [ ] `dotnet test` green · `tsc` clean · `vite build` clean · `vitest` green
- [ ] Manually verified across the relevant states
- [ ] Docs updated if the bug revealed a wrong/missing contract
