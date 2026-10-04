# PatelRep — Agent Instructions (Codex compatibility entry point)

`CLAUDE.md` in the repository root is the **canonical** PatelRep project context:
commands, directory structure, domain map, conventions, database gotchas, cron jobs,
infrastructure URLs, and verification policy. Read it in full and follow it before doing
any work. Do not copy its contents here — this file intentionally holds no infrastructure
facts, so there is exactly one source of truth to keep current.

Also follow `.wolf/OPENWOLF.md` (imported by `CLAUDE.md`).

## Codex-specific notes

- Where `CLAUDE.md` mentions Claude-only tooling (skills, `/gsd:*` commands, MCP tools,
  `.claude/` settings), use the equivalent shell commands, or skip it if none exists.
- Autonomous CI-repair behavior is defined in `docs/AUTONOMOUS_RELEASE_ENGINEER.md`.
