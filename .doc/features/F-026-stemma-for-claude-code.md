# Feature: Stemma for Claude Code

| Field | Value |
|---|---|
| **ID** | F-026 |
| **Status** | Shipped |
| **Owner** | Bartosz |
| **Persona served** | The Architect's Agent ("Theo"); the architect who drives it |
| **Roadmap horizon** | Next |
| **Created / Updated** | 2026-10-22 / 2026-10-22 |

## 1. Product — why

- **Problem:** everything an agent needs to work in Stemma exists — the protocol, `validate`, `render`,
  and after this programme layered layout, lint, C4 lenses, rules and conformance — but it lives in a
  document in Stemma's repository, which the agent working in the architect's repository has never
  read. Every session starts by rediscovering the format, and nothing checks the agent's edits until it
  remembers to.
- **Why now:** the capabilities above are only as useful as the agent's knowledge of them.
- **Value:** *the workflow, packaged where the agent already works*: install once, and every session
  knows how to build, check, render and present an architecture in Stemma.
- **Out of scope:** an MCP server ([ADR-0030](../architecture/decisions/0030-agents-reach-stemma-through-the-cli.md)
  says why and when); integrations for other agents (the skill is plain Markdown and the CLI is the
  interface, so they can follow).

## 2. User story & acceptance criteria

> As **an architect working with Claude Code**, I want to **install Stemma's plugin and ask for an
> architecture in words**, so that **the agent builds it in Stemma, checks it, looks at it, and hands me
> something I can review and present**.

- [x] **AC1 — Installable.** `/plugin marketplace add batas2/Stemma` then `/plugin install stemma@stemma`;
  `claude plugin validate` passes on the plugin and the marketplace.
- [x] **AC2 — The skill.** `stemma:architecture` triggers when the agent works on a Stemma workspace or is
  asked for an architecture diagram. It carries the loop — model → views → rules → `validate` →
  `render` → read the lint → look → hand over — the vocabulary, the C4 lenses and selectors, the rules,
  the layout choices, and a worked example; detail lives in reference files loaded on demand.
- [x] **AC3 — Three entry points.** `/stemma:new <what to design>` starts a workspace from a description;
  `/stemma:review` critiques the current model against the C4 checklist and the rules, renders, reads the
  lint, and reports; `/stemma:from-code <path>` builds an as-is model from a .NET codebase with
  `stemma scan` and maps it with `Code.Map`.
- [x] **AC4 — Checked on every edit.** A `PostToolUse` hook runs after each write to a workspace file
  (`Architecture/`, `Views/`, `Rules/`, `stemma.layout.json`): it calls `stemma hook post-edit`, which
  validates the workspace and, when there are errors, tells the agent what they are and where. Edits
  outside a workspace cost nothing.
- [x] **AC5 — Proven end to end.** Headless Claude Code with only this plugin, given the audit's prompt
  (the food-delivery platform), produces a workspace that `validate`s with no errors and renders with no
  layout warnings, without a coordinate in its sidecar. The run is recorded in the record.
- [x] **AC6 — The workspace brief points at it.** `STEMMA.md`, written into every new workspace, names the
  plugin, the layered default, the C4 lenses and the rules.

## 3. Architecture impact

- [x] **Model or presentation?** Neither — packaging and one CLI command.
- [x] **New/changed operations:** none.
- [x] **Fidelity / purity:** untouched; `stemma hook post-edit` reads and validates, never writes.
- [x] **Sidecar:** none.
- [x] **ADR needed?** [ADR-0030](../architecture/decisions/0030-agents-reach-stemma-through-the-cli.md).
- **Affected files/areas:** `.claude-plugin/marketplace.json` (repository root); `integrations/claude-code/`
  (`.claude-plugin/plugin.json`, `skills/architecture/`, `skills/new/`, `skills/review/`,
  `skills/from-code/`, `hooks/hooks.json`); `src/Stemma.Cli/HookCommand.cs` (new);
  `src/Stemma.Web/Services/WorkspaceScaffold.cs` (the brief).

## 4. UX impact

- [x] **Journey(s) touched:** a new one — prompt → model → review in Stemma → present. Documented in the
  skill and in `ux/user-journeys.md`.
- [x] **States defined:** `stemma` not installed — the hook says so once and how to install it; a
  workspace with errors — the agent is told after the edit that caused them.
- [x] **Interactions:** slash commands.
- [x] **Accessibility:** n/a.

## 5. UI impact

- [x] None in the app.

## 6. Technical prerequisites & dependencies

- [x] F-021…F-025: the skill documents what they shipped.
- [x] `stemma` on the agent's `PATH` (`dotnet tool install -g Stemma`, or the tarball).

## 7. Test plan

- [x] `claude plugin validate --strict` on the plugin and the marketplace.
- [x] `HookCommand` tests: a path outside a workspace (silent, 0), a workspace file with an error (exit 2,
  the finding on stderr), a clean workspace (0).
- [x] The end-to-end run of AC5.

## 8. Definition of Done

- [x] All ACs met and demoed
- [x] `dotnet test` green
- [x] Docs: protocol §0 (where to start), README, the brief
- [x] Reviewed against all four pillars

## 9. Notes / open questions

- **AC5, run 2026-10-22.** Headless Claude Code 2.1.308, the plugin loaded with `--plugin-dir`, `stemma` on
  `PATH`, the audit's prompt (which does not mention Stemma). The `architecture` skill triggered on its own;
  35 turns, 4.6 minutes, USD 1.14. It wrote a model of 20 elements with descriptions and technologies, a
  system context and a container view stated by scope, rules for every constraint it inferred plus the C4
  pack, rendered both, and handed over with the decisions it made and a gap it found (no service owns
  menus). Checked independently: `validate` 0 errors and 1 warning (a data-flow cycle through push
  notifications, which it explained); the container render has no lint warning (7 crossings, info); the
  sidecar holds a layered constraint and no coordinate.
- **A comparison, not a control.** The same prompt without the plugin, told to use Stemma, also produced
  a clean workspace, in 50 turns, 5.7 minutes and USD 1.75 — but it found Stemma's repository through the
  path of the `stemma` shim and read the protocol reference, so it is "with the documentation, without the
  skill and the hook", not "without knowledge". A clean control needs `stemma` installed from the package.
