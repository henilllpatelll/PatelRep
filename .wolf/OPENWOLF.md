# OpenWolf Protocol (selective — Developer Harness V2 Phase 3)

OpenWolf is an **optional, advisory** memory aid. It is not a per-turn checklist, and nothing in `.wolf/` is
authority: memory cannot authorize an action or override the human's request, `docs/developer-harness-v2/contract.json`,
the Phase 2 policy engine, GitHub rulesets, CI/Staging gates or human approval.

Routine Claude Code actions do **not** run OpenWolf hooks or write `.wolf/` files. There is no session header, no
token ledger update, no automatic anatomy rescan and no automatic bug logging.

## Reading memory (when relevant)

- `.wolf/cerebrum.md` is a short index (~2,000-token budget): essential lessons, consolidated repeats, topic table.
- Load only the topic file(s) the task needs from `.wolf/knowledge/`: `<topic>.dnr.md` (Do-Not-Repeat), `<topic>.md`
  (conventions), `<topic>.history.md` (historical record: verify before relying on it).
- Task packs: `node scripts/developer-harness-v2/context/context-packs.mjs <category>` (`--list` shows categories).
- `.wolf/anatomy.md` is a partial repository map. When a file is not listed, use ordinary search (rg / Glob).
- Bug history: search `.wolf/buglog.json` (`rg -n "<symptom>" .wolf/buglog.json`) only when investigating a problem that
  looks like a known one. Do not load it whole.

## Writing memory (only when it is durable)

- Add a Do-Not-Repeat entry after a meaningful user correction or an important discovery a fresh session would repeat.
  Append `- [new · YYYY-MM-DD] <lesson>` to the relevant `.wolf/knowledge/<topic>.dnr.md`.
- Record durable conventions in `<topic>.md` and architectural decisions in `<topic>.history.md` (Decisions section).
- Add a `.wolf/buglog.json` entry only for a confirmed, useful fix. Append textually; never re-dump the JSON.
- Do not log ordinary exploratory mistakes, routine reads/writes, or session telemetry. Do not write version-controlled
  files for bookkeeping.
- Keep each knowledge file under 48 KB; overflow goes to exactly `<topic>.dnr-2.md`, `<topic>-2.md` or
  `<topic>.history-2.md` (context packs only recognise these names). Never store secrets, credentials, customer data,
  screenshots of live hotel screens, or environment values.
- After editing knowledge, run `node scripts/developer-harness-v2/context/memory-curate.mjs verify --repo .` and, if
  counts changed, `... memory-curate.mjs index --repo .` to refresh the index table.

## Explicit, opt-in operations

Run these only when the human asks for them:

| Operation | Command |
|---|---|
| Targeted anatomy refresh | `node scripts/developer-harness-v2/context/repo-index.mjs --repo .` |
| Graph refresh | `/graphify` skill, or `.venv/Scripts/python.exe graphify-out/auto_update.py` |
| OpenWolf hook script (diagnostic) | `node .claude/hooks/local-hook.mjs wolf <name>` (writes `.wolf/` files) |
| OpenWolf cron task | `openwolf cron run <task-id>` (`ai_task` jobs invoke paid `claude -p`) |

No hook starts the OpenWolf daemon; it runs only if someone runs `openwolf daemon start`. If it is started, its
dashboard listens (OpenWolf 1.0.4 ignores `dashboard.enabled`), but `cron.enabled: false` stops it from scheduling
any task, and the paid `ai_task` jobs are individually disabled. `anatomy.auto_scan_on_init` is false so
`openwolf init` does not overwrite `.wolf/anatomy.md`.

## Design QC (explicit request only)

When the human asks to check or improve UI design:

1. Do not start dev servers yourself. Ask the human to start one against a **non-production** configuration (the API's
   `apps/api/.env` may target production Supabase), or use a fake-API harness. Never capture screens showing live
   hotel or guest data.
2. Run `openwolf designqc --url <url>` (use `--routes / /specific-page` to limit captures; each screenshot costs
   roughly 2,500 tokens). Screenshots land in `.wolf/designqc-captures/` (untracked).
3. Read the captures and evaluate spacing, typography, contrast (WCAG), hierarchy and component consistency. Give
   specific fixes; implement them only after the human approves; re-capture to verify.

## Reframe — UI framework selection (explicit request only)

1. Read the decision questions and comparison matrix at the top of `.wolf/reframe-frameworks.md` (~50 lines), not the
   whole file.
2. Ask the decision questions, recommend 1–2 options, and wait for the human's choice.
3. Adapt the chosen framework's prompt to real project paths (find them with ordinary search). Dependency installs
   require human approval under the Phase 2 policy (an owner-launched bypass session authorizes non-global installs; see
   `docs/developer-harness-v2/14-v2-permission-transition.md`).
