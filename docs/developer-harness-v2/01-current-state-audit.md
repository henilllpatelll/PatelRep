# Developer Harness V2 — 01 Current-State Audit

| Field | Value |
|---|---|
| Repository | `henilllpatelll/PatelRep` |
| Audited `main` SHA | `218a882b15ed8f928f9a8b7d82b6ea8bb1ed0d37` (matches the expected baseline; no drift at audit time) |
| Audit date | 2026-11-21 |
| Method | Read-only inspection of source files at the SHA above, plus read-only `gh api` queries of live rulesets, environments and repository variables. No workflow was dispatched, no permission/hook/secret changed. |
| Scope | Developer infrastructure only (how agents help engineers change the repo). The customer-facing Agent Harness (H1–H7) is out of scope except as an external constraint. |

**Legend.** **[OBSERVED]** = verified directly in a file or live API response (path/line cited).
**[INFERRED]** = a risk reasoned from observed facts; not demonstrated or exploited. Line numbers refer to the
audited SHA.

---

## 1. Infrastructure inventory

### 1.1 Claude Code instructions and hierarchy

| Layer | Path | Observation |
|---|---|---|
| User-global (outside repo) | `~/.claude/CLAUDE.md`, `~/CLAUDE.md` | Not repository-controlled. The home-directory file mandates multi-agent swarm spawning and `npx @claude-flow/cli@latest` calls before tasks. **[OBSERVED in session context]** This conflicts with the repo's single-session default and V2's "no persistent swarm" contract. |
| Project | `CLAUDE.md` (312 lines) | Canonical project rules: authority boundaries (L8–53), scope (L55–66), non-regression (L68–78), self-verification (L80–92), conventions, infrastructure. |
| Codex entry point | `AGENTS.md` | Points to `CLAUDE.md`; holds no facts by design. |
| Web | `apps/web/CLAUDE.md` → `@AGENTS.md` → `apps/web/AGENTS.md` | Next.js agent block that `next dev` regenerates automatically. |
| OpenWolf | `.wolf/OPENWOLF.md` (imported by `CLAUDE.md` L96) + `.claude/rules/openwolf.md` (glob `**/*`) | Requires mandatory per-turn bookkeeping (anatomy check, memory append, cerebrum/buglog updates). |
| Skills | `.claude/skills/{patelrep-api,patelrep-mobile,patelrep-web,ui-ux-pro-max}` | Three domain skills plus one generic design skill. |
| Subagent definitions | `.claude/agents/` | **Does not exist. [OBSERVED]** The repo defines no developer roles (planner, reviewer, security reviewer…). |

### 1.2 Claude Code permissions (`.claude/settings.json` L5–36)

**[OBSERVED]** An allow-list only, with no `deny` and no `ask` entries. Broad or high-impact entries:

| Entry | Line | Why it matters |
|---|---|---|
| `Bash(npx supabase*)` | L15 | Covers `supabase db push`, `supabase migration repair`, `supabase link` and remote commands. `CLAUDE.md` L17 forbids `migration repair`, but nothing in the harness enforces that. The repo's `supabase link` target is **production** (per the maintainer's memory record `reference_staging_backup_restore`; not re-verified in this audit). |
| `Bash(eas build*)`, `Bash(eas update*)`, `Bash(cd apps/mobile && eas*)` | L21–23 | `eas update` publishes OTA updates to real devices. That is a production-equivalent action with no gate. |
| `Bash(npm install*)`, `Bash(npm ci)` | L12–13 | Dependency installation runs lifecycle scripts (root `postinstall: npx patch-package || true`). This is supply-chain surface. |
| `Bash(git push)` | L29 | Bare `git push` pushes the current branch's upstream. The client-side `.githooks/pre-push` blocks `main`, but only when `core.hooksPath` is configured. It is configured in the maintainer's primary checkout, which is opt-in per clone. |
| `Bash(git stash*)` | L31 | The maintainer's own feedback records "never git stash". The allow-list contradicts it. |
| `Bash(cd apps/api && python*)` | L16 | Arbitrary Python with the local `.env`. The maintainer's memory records that it points at the production Supabase project. |

**[INFERRED]** Prefix allow-lists are not a security boundary. Any allowed interpreter (`node`, `python`, `npx`)
can execute any other command. In addition, Claude Code "bypass permissions" mode, which is in use in the
maintainer's sessions, skips the list entirely. The local list is a convenience layer, not enforcement.

### 1.3 Claude Code hooks (`.claude/settings.json` L37–119, `.claude/hooks/local-hook.mjs`)

| Event | Action | Observation |
|---|---|---|
| SessionStart | `wolf session-start` (5 s) | Appends a header to `.wolf/memory.md`, parses and rewrites the 20 MB `token-ledger.json`, and deletes stray `.tmp` files. |
| SessionStart (async) | `dev-servers` | Starts `npm run dev:web` (port 3000) and `dev:api` when ports **3000/8000** are free (`local-hook.mjs` L34–37). **[OBSERVED]** `package.json` `dev:api` binds **8003**, so the port-8000 probe never sees a running API and every session starts a new API process. **[INFERRED]** That process loads `apps/api/.env` (production Supabase per memory), which means sessions silently start a production-connected server. |
| PreToolUse Read / Write | `wolf pre-read`, `wolf pre-write` | Advisory warnings only. Every OpenWolf hook ends `process.exit(0)` and has `catch(() => process.exit(0))`. |
| PostToolUse Read / Write | `wolf post-read`, `wolf post-write` (10 s) | Updates anatomy, memory and the token estimate. |
| Stop | `wolf stop` (10 s); async `graphify-update` (120 s) | Writes the session ledger and re-extracts the code graph in `.venv` Python on every stop. |

**[OBSERVED]** `isCI()` (L12) makes every hook a no-op in GitHub Actions. That is correct.
**[OBSERVED]** All hooks **fail open**: no hook can block a tool call (none returns exit code 2). They provide
bookkeeping, not policy.
**[INFERRED]** The hooks execute repository-tracked JavaScript and Python (`.wolf/hooks/*.js`,
`graphify-out/auto_update.py`) on the developer's machine at every session start, tool call and stop. A
branch that modifies those files runs its code locally as soon as a developer opens Claude Code on that branch
(see §4 S-3).

### 1.4 OpenWolf and graphify (`.wolf/`, `graphify-out/`)

| Artifact | Size (tracked) | Observation |
|---|---|---|
| `.wolf/token-ledger.json` | 20.6 MB, 552,140 lines | **[OBSERVED]** All counts are character-ratio *estimates* (`shared.js` L590–593: chars ÷ 3.5/3.75/4.0). They are not model billing. `lifetime.total_sessions` = 727 while `sessions[]` has 1,998 entries and `memory.md` has 2,148 session headers, so the counters are internally inconsistent. `repeated_reads_blocked` (32,540) counts warnings; nothing is blocked. `estimated_savings_vs_bare_cli` is a modelled figure, not a measurement. |
| `.wolf/memory.md` | 1.5 MB, 15,942 lines | Append-only action log, never consolidated (config `consolidation_after_days: 7` is not acted on). |
| `.wolf/buglog.json` | 1.4 MB, 788 bugs | Useful history, but too large to read in full. |
| `.wolf/cerebrum.md` | 392 KB (≈100k tokens) | Config `cerebrum.max_tokens: 2000` is exceeded by ~50×. Three separate `## Key Learnings` sections (L32, L555, L592) plus per-phase sections. This is the highest-value curated memory, but it is unbounded. |
| `.wolf/anatomy.md` | 83 KB, 188 entries | Header says "Last scanned 2026-10-08 … Files: 72 tracked". The repository has 4,740 non-generated tracked files, so coverage is about 4%. The first section is `../../.claude/` (a path outside the repo). The protocol's "check anatomy before every read" therefore misses ~70% of the time (ledger: 13,752 hits / 31,507 misses). |
| `.wolf/runtime-logs/` (20 files, 1.2 MB) + `.wolf/supervisor_ui.xml` | — | Android UI-hierarchy dumps and screenshots from device sessions (last change 2026-06-16). Pattern scan found no credential-like strings (all 1,200 `password` hits are UI-automator attributes). **[INFERRED]** Screenshots and UI dumps of live screens may contain hotel operational data. They do not belong in version control. |
| `graphify-out/` | 19 MB, 188 tracked files | `GRAPH_REPORT.md` dated 2026-07-29 and dominated by Android Gradle build artifacts. 180 files under `graphify-out/cache/` are tracked even though `.gitignore` L122–123 ignores that path (they were tracked before the ignore rule). The working tree shows `cache/stat-index.json` modified after sessions. |
| Root `C:UsersHenilprojectsPatelRep.wolfmemory.md` | 316 B | **[OBSERVED]** A tracked file whose name is a mangled Windows path. It comes from a path-normalization bug in a past hook write. |
| `.wolf/config.json` | — | Enables an OpenWolf cron, daemon (port 18790), dashboard (18791) and `use_claude_p: true`. No evidence that these run in this checkout. It is configuration surface that can launch paid `claude -p` work. |

**Assessment.** The useful capabilities are curated learnings (cerebrum Do-Not-Repeat) and the bug history.
The noisy or harmful parts are per-turn mandatory bookkeeping, the tracked 20 MB estimate ledger, the stale
anatomy, the tracked graph caches, tracked device dumps, and hooks that rewrite tracked files every session,
which leaves permanent dirty-tree noise (visible in the maintainer's main checkout). Phase 3 owns the cleanup.
Phase 1 changes none of it.

### 1.5 Developer automation (GitHub)

| Workflow | Trigger | Write credential | Can merge? | Can request release? |
|---|---|---|---|---|
| `claude-feature-orchestrator.yml` | `workflow_dispatch` (human) | `actions: write` (GITHUB_TOKEN) to dispatch the builder only (L31–33) | No | No |
| `autonomous-feature-builder.yml` | dispatch from orchestrator | Agent job read-only (`persist-credentials: false`, L71); **publish** job holds the PatelRep App token (L166–171) | No | No |
| `claude-release-engineer.yml` | `workflow_run` failure or dispatch | Agent job read-only; **publish** job holds the App token (L211–217) | No | No |
| `claude-release-engineer-auto-merge.yml` | `workflow_run` of a successful Staging Candidate | **merge** job: App token with `contents: write, pull-requests: write` (L90–95) | **Yes**, for `claude/recovery-*` PRs only | No |
| `claude-release-engineer-production-request.yml` | `workflow_run` after auto-merge | App token, `actions: write` only (L102–106) | No | **Yes** (dispatches Production Release, patch only) |
| `dependency-orchestrator.yml` | scheduled/dispatch | Agent (L137) + App-token jobs (L229/238/300) | Not audited in depth | — |

**Agent tool restrictions.** The builder (L126–128) and Release Engineer (L172–174) pass `--allowedTools` /
`--disallowedTools` lists. **[INFERRED]** Those lists are not the boundary. Both allow `node`, `npm`, `npx` and
`python`, which can run anything. The real boundary is that the agent job holds only a read-only
`GITHUB_TOKEN`, checks out code without persisted credentials (builder L71, Release Engineer L120), and never receives the App key. That design is
sound. V2 should rely on the same principle, not on command patterns.

**Trusted publishers.** `scripts/publish-feature-builder-change.mjs` L14–18 blocks
`.github/workflows/**`, a named list of `scripts/` prefixes, five control-plane docs, and any non-add change
to `supabase/migrations/` (L43). **[OBSERVED gap]** The list does **not** block other `.github/` files, other
`scripts/` safety tools (`check-migrations.mjs`, `destructive-db-guard.mjs`,
`migration-security-classifier.mjs`, `merge-release-engineer-repair.mjs`, `db-contracts.mjs`), `.claude/`,
`.githooks/`, `.wolf/hooks/` or `graphify-out/auto_update.py`. `publish-release-engineer-repair.mjs` has **no**
path block-list. It relies on the downstream auto-merge classifier and human review.

**Auto-merge risk classifier** (`scripts/release-engineer-auto-merge-policy.mjs` L53–73). **[OBSERVED]**
Calling the exported `classifyChangedFile` returns low risk (`null`) for `.githooks/pre-push`,
`.wolf/hooks/stop.js`, `.wolf/hooks/shared.js`, `AGENTS.md`, `apps/web/AGENTS.md` and
`graphify-out/auto_update.py`. It returns high risk for `.claude/settings.json` and `CLAUDE.md`. See §4 S-2.

### 1.6 CI, Staging and repository controls

**Live `main` ruleset 17358515 [OBSERVED via `gh api`]:** required status checks `CI Gate` and `Staging Gate`
with strict up-to-date; PR required with **0 required approvals**, thread resolution required; deletion and
non-fast-forward blocked; **no bypass actors**. Classic branch protection is not used (404). Other rulesets:
`claude-recovery-branches` (`refs/heads/claude/recovery-*`, writable only by one App integration) and
`release-tags` (`refs/tags/v*`, one App integration).

**Environments [OBSERVED]:**

| Environment | Protection |
|---|---|
| `Production` (workflows use `production`; names are case-insensitive) | Protected-branches deployment policy only. **No required reviewers.** Admin bypass allowed. |
| `staging` | **No protection rules and no branch policy.** |
| `staging-migration-approval` | Required reviewers, protected branches, admin bypass **disabled**. |
| `release-recording` | Custom branch policy. |

**Repository variables [OBSERVED]:** `PRODUCTION_AUTO_RELEASE_ENABLED=true` (updated 2026-10-06),
`PRODUCTION_AUTO_ROLLBACK_ENABLED` present.

**CI Gate** (`ci.yml` L519–609) aggregates 18 jobs: API lint and tests, web lint/type-check/build/unit/smoke,
Database Migration Gate, Security Scan, Feature Flag Registry, Frozen-File Guard, contrast, i18n parity,
Room-Board hermetic and live pixel-diff, Release Workflow Contract (≈70 Node contract-test files, L388),
Supabase CLI Apply Contract, and Actions Runtime Contract produce/consume. Only one conditional skip is
accepted: the live Room-Board job, and only for Dependabot-authored PRs (L583–588). **Mobile CI**
(`mobile-ci.yml`) runs on every PR but is **not** part of CI Gate and **not** a required check.
**Staging Candidate** triggers on CI `workflow_run` success. It applies forward-only migrations to the shared
staging DB, deploys exact API and web candidates, verifies them, and reports `Staging Gate`. A pending
security-sensitive migration requires the reviewed preview path (`staging-reviewed-migration-preview.yml`,
gated by `staging-migration-approval`).

**Client-side:** `.githooks/pre-push` blocks pushes to `main`/`master` when `core.hooksPath` is set
(`npm run setup:hooks`). It is bypassable with `--no-verify` and absent on fresh clones.

**Local test cost [OBSERVED this session]:** the 14 developer/workflow contract files (feature builder,
orchestrator, release engineer, auto-merge, production request, staging candidate, mobile CI, security scan,
database safety) ran **275 tests, 275 passed, 0 failed in ≈1.4 s** with Node 24 and no network or Docker.
Database suites (`db:rebuild`, `db:contracts`, API integration) need Docker/Supabase and are expensive on the
16 GB development machine (maintainer feedback: one stack at a time).

---

## 2. Confirmed strengths

1. **Credential separation in CI agents.** Agents run read-only; only small trusted jobs at a frozen
   control-plane SHA hold the App token. Publishers check out with `persist-credentials: false`
   (builder L185, Release Engineer L234; agent jobs L71 and L120).
2. **Exact-SHA provenance everywhere.** Builder base proof (L80–82), repair checkout proof, publisher head
   checks (`publish-release-engineer-repair.mjs` L78–83), and the production release tree-identity check.
3. **Main has no bypass actors** and requires both gates with strict up-to-date status.
4. **Forward-only migration discipline** is enforced in the builder publisher (L43) and backed by an
   extensive Database Migration Gate and reviewed-preview path with real required reviewers.
5. **Fast, credential-free contract tests** already pin workflow invariants (≈70 files in CI Gate).
6. **Hooks are inert in CI** (`isCI()`).

## 3. Verified gaps and inconsistencies

| # | Gap | Evidence |
|---|---|---|
| G-1 | Committed `CLAUDE.md` says "Active surface: web app only" (L57). The maintainer's 2026-10-08 decision (mobile is the active surface) exists only as an uncommitted local edit. | `CLAUDE.md` L57; local diff in primary checkout |
| G-2 | `CLAUDE.md` says the API runs on `:8000` (L84, L157). `package.json` uses `8003`, and the hook probes `8000`. | `package.json` `dev:api`; `local-hook.mjs` L36 |
| G-3 | `CLAUDE.md` says "Next.js 14" (L219, L311). The skill and app use Next.js 16. | `CLAUDE.md`; `.claude/skills/patelrep-web/SKILL.md` |
| G-4 | `CLAUDE.md` L305 references `REMAINING_WORK.md`, which does not exist. | file absent |
| G-5 | No developer subagent definitions, no deny-list, no policy hook. | `.claude/` listing |
| G-6 | OpenWolf mandates per-turn bookkeeping against a 4%-coverage anatomy and an over-budget cerebrum. | §1.4 |
| G-7 | Token "usage" is estimated, not billed. No real cost data exists in the repo. | `shared.js` L590 |
| G-8 | Mobile CI is not required by the ruleset or CI Gate. | ruleset; `ci.yml` L523–541 |
| G-9 | Release Engineer repair publisher has no protected-path block-list (the builder publisher does). | §1.5 |
| G-10 | Generated, tracked-but-ignored and personal artifacts in the repo (graph cache, device dumps, mangled-path file). | §1.4 |
| G-11 | User-global instructions (swarm-first) conflict with the project default (single session). | §1.1 |

## 4. Security-sensitive findings

| ID | Finding | Type |
|---|---|---|
| S-1 | **The Release Engineer recovery chain can reach production without a GitHub-enforced human approval.** Repair → App auto-merge (0 approvals required by ruleset) → production-request (App, `actions: write`) → Production Release in an environment with **no required reviewers**, with `PRODUCTION_AUTO_RELEASE_ENABLED=true`. `production-release.yml` L15–20 documents this as intentional, and each step re-verifies provenance and fails closed. This is the **preserved exception**. V2 neither changes nor extends it. | OBSERVED (config); design is intentional |
| S-2 | The auto-merge classifier treats locally executed developer tooling (`.githooks/`, `.wolf/hooks/`, `graphify-out/auto_update.py`) and `AGENTS.md` as low risk. A recovery PR touching only those paths would not be held for human review. Exploitation also requires a CI failure, an agent patch that touches those files, and green gates. | OBSERVED (classifier output); impact INFERRED |
| S-3 | Repository-tracked code runs automatically on developer machines through Claude Code hooks (`.wolf/hooks/*.js`, `graphify-out/auto_update.py`). Checking out any branch that modifies them runs that code at the next session start. | OBSERVED (hook wiring); impact INFERRED |
| S-4 | The `staging` environment has no protection and no branch policy. **[INFERRED]** A workflow on any same-repo branch that declares `environment: staging` could receive staging secrets. A developer agent that can push branches can therefore reach staging credentials indirectly. That is why V2 forbids agents from modifying `.github/**` and treats branch pushes as task-authorized. | OBSERVED (env config); path INFERRED |
| S-5 | The local allow-list permits remote Supabase CLI, EAS OTA publishing and dependency installation without prompts. Bypass mode skips it entirely. | OBSERVED |
| S-6 | A session-start hook starts a local API with the developer's `.env` (production Supabase per maintainer memory). | OBSERVED (hook) / INFERRED (target) |
| S-7 | Required status checks are matched by name with no integration pin. **[INFERRED]** Any actor able to create check runs with those names could satisfy them. Mitigated today because only Actions workflows on `main` define them. | OBSERVED (ruleset shape) |
| S-8 | Mandatory CLAUDE.md/OpenWolf text is advisory. Nothing blocks `git push origin main --no-verify`, `supabase db push` or `gh pr merge` locally except GitHub server-side rules, and those apply only to `main`, not to staging or Supabase. | OBSERVED |

**External constraints (not fixed here):** the HS256 shared-secret boundary
(`docs/agent-harness/h7-p2-verified-identity.md` §6), the Level-2 stop/pause race (same document, table row
"Level-2 stop linearized", `test_agent_h7_level2_race.py`), and TRUNCATE privileges on non-agent tables
(`docs/agent-harness/adr-0006-h7-bounded-autonomy.md` L26) belong to customer Agent Harness security work.

## 5. Differences from the preliminary assessment

- Baseline SHA confirmed exactly. No divergence.
- The recovery auto-merge exception is narrow in **branch scope** (ruleset plus publisher-trailer checks). Its
  **path classifier** has the gap in S-2, and it chains to an automated production request that GitHub
  environments do not gate (S-1). Both are documented and preserved, not changed.
- The OpenWolf "token savings" and usage counts cannot serve as a cost baseline (G-7). Phase 7 must source
  real usage.
- The staging environment is unprotected (S-4). This is relevant to the developer threat model even though no
  V2 phase changes environments.
