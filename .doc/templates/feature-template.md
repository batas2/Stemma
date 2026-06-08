<!--
Copy this file to `.doc/features/<id>-<slug>.md` (e.g. `F-014-edge-bundling.md`).
Fill every section. A feature that can't articulate its Product / Architecture / UX / UI impact
is not ready to build. Delete the guidance comments as you go.
-->

# Feature: <Title>

| Field | Value |
|---|---|
| **ID** | F-XXX |
| **Status** | `Draft` · `Ready` · `In progress` · `Shipped` · `Cut` |
| **Owner** | <name / agent> |
| **Persona served** | <which persona from `../product/users-and-personas.md`> |
| **Roadmap horizon** | `Now` · `Next` · `Later` |
| **Created / Updated** | YYYY-MM-DD / YYYY-MM-DD |

## 1. Product — why

- **Problem:** <the user pain, concretely>
- **Why now:** <what makes this worth doing>
- **Value:** <the outcome; tie to a value prop in `../product/value-proposition.md`>
- **Out of scope:** <what this explicitly does not do>

## 2. User story & acceptance criteria

> As a **<persona>**, I want **<capability>** so that **<outcome>**.

- [ ] AC1 — <observable, testable behavior>
- [ ] AC2 —
- [ ] AC3 —

## 3. Architecture impact

- [ ] **Model or presentation?** <which side of the boundary; if both, what goes where>
- [ ] **New/changed operations:** <list; each needs ≥3 fidelity fixtures>
- [ ] **Fidelity:** <does it touch source rewrites? confirm the inviolable rules hold>
- [ ] **Engine purity:** <no web/LLM creep into the engine>
- [ ] **Sidecar:** <new `verso.layout.json` section/field? schema?>
- [ ] **ADR needed?** <link or "no">
- **Affected files/areas:** <`path` list>

## 4. UX impact

- [ ] **Journey(s) touched:** <ref `../ux/user-journeys.md`; what changes in each step>
- [ ] **States defined:** empty / loading / error / optimistic / conflict / selected (only the ones that apply)
- [ ] **Interactions:** <new gestures, keyboard paths, feedback/toasts>
- [ ] **Accessibility:** <keyboard, reduced-motion, contrast, hit-targets>

## 5. UI impact

- [ ] **Components touched/added:** <ref `../ui/components.md`>
- [ ] **Tokens:** <reuses existing tokens; any new token added to `styles.css` + documented>
- [ ] **Both themes:** dark + light verified
- [ ] **Layout/rail behavior:** <where it lives; disabled-not-hidden where relevant>

## 6. Technical prerequisites & dependencies

- [ ] <library / API / data the feature needs>
- [ ] <other features/records this depends on or blocks>
- [ ] <migration or sample updates required>

## 7. Test plan

- [ ] Backend fidelity fixtures (minimal / realistic / pathological) for new ops
- [ ] Frontend unit tests for new pure logic
- [ ] Regression/state tests for the journeys touched
- [ ] Sample workspace updated to exercise it (if applicable)

## 8. Definition of Done

- [ ] All ACs met and demoed
- [ ] States handled; accessibility bar met
- [ ] `dotnet test` green · `tsc` clean · `vite build` clean · `vitest` green
- [ ] Model/presentation boundary respected; no new data store
- [ ] Docs updated in the same PR (which `.doc/` files?)
- [ ] Reviewed against all four pillars

## 9. Notes / open questions

- <decisions deferred, risks, links>
