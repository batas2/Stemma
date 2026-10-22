# ADR-0030: Agents reach Stemma through the CLI, packaged as a Claude Code plugin; MCP is deferred

| Field | Value |
|---|---|
| **Status** | `Proposed` |
| **Date** | 2026-10-22 |
| **Deciders** | Bartosz |

## Context

An agent works on a Stemma workspace by editing files and running `stemma validate` / `stemma render`.
What it lacks is knowledge — the format, the loop, the checks — and a nudge when an edit broke something
([F-026](../../features/F-026-stemma-for-claude-code.md)). The two packaging options are an MCP server
exposing Stemma's operations as tools, and a Claude Code plugin: a skill that teaches the CLI, commands
that start the common jobs, and a hook that validates after edits.

## Decision

1. **The CLI is the interface.** Every capability an agent needs is a `stemma` command with text and
   `--json` output; the agent edits the C# and the sidecar with its own file tools, which already make
   surgical edits, and `validate` is the gate.
2. **It is packaged as a Claude Code plugin in this repository** (`integrations/claude-code/`, with a
   marketplace manifest at the root): the `architecture` skill, `new` / `review` / `from-code` skills
   invocable as commands, and a `PostToolUse` hook that calls `stemma hook post-edit`.
3. **The hook's logic lives in the CLI, not in a shell script**, so it needs neither `jq` nor a POSIX
   shell and behaves the same on every platform the CLI ships for.
4. **MCP is deferred, not rejected.** It becomes right when a client that cannot run a shell (a chat
   client, a hosted agent) needs Stemma, or when a rendered image must come back as a tool result rather
   than a file the agent reads. The CLI's `--json` outputs are shaped so a thin MCP wrapper can expose
   them unchanged.

## Consequences

- **Positive:** one interface for people, scripts, CI and agents; nothing to run in the background; the
  skill is plain Markdown any agent can be pointed at.
- **Negative / trade-offs:** the agent must have `stemma` on its `PATH`; agents without a shell cannot
  use Stemma until the MCP wrapper exists.
- **Neutral:** the operations protocol (`POST /api/workspace/ops`) stays the canvas's; agents do not
  need it.

## Alternatives considered

- **MCP server first** — duplicates the CLI behind another protocol, needs a long-running process, and
  costs context for tool definitions in every session; Claude Code's own guidance calls CLI tools the
  most context-efficient interface.
- **Operations over HTTP for agents** — would let an agent edit through the engine's fidelity-checked
  operations, but needs a running host and a session; agents edit files well, and `validate` catches
  what they get wrong.

## Relationship to the inviolable rules

Packaging only. `stemma hook post-edit` reads and validates; nothing is written; no store is added.

## References

- [F-026](../../features/F-026-stemma-for-claude-code.md)
- [Claude Code plugins](https://code.claude.com/docs/en/plugins/create), [hooks](https://code.claude.com/docs/en/hooks)
